import { DataTypes } from 'sequelize';
import { sequelize } from './models.mjs';

/**
 * `sequelize.sync()` は既存テーブルに列を足さないため、モデル追加後の DB を追従する。
 * @see https://sequelize.org/docs/v6/core-concepts/model-basics/#model-synchronization
 */
async function ensureRaceBetJraColumns() {
  const qi = sequelize.getQueryInterface();
  let desc;
  try {
    desc = await qi.describeTable('race_bets');
  } catch {
    return;
  }
  if (!desc.jraMulti) {
    await qi.addColumn('race_bets', 'jraMulti', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  }
  if (!desc.jraMultiOffered) {
    await qi.addColumn('race_bets', 'jraMultiOffered', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  }
  if (!desc.pickCompact) {
    await qi.addColumn('race_bets', 'pickCompact', {
      type: DataTypes.STRING(512),
      allowNull: false,
      defaultValue: '',
    });
  }
  if (!desc.oddsOfficialTime) {
    await qi.addColumn('race_bets', 'oddsOfficialTime', {
      type: DataTypes.STRING(128),
      allowNull: true,
    });
  }
}

/**
 * 起動時に SQLite のテーブルを作成（存在しなければ）
 */
async function ensureLotteryBetColumns() {
  const qi = sequelize.getQueryInterface();
  let desc;
  try {
    desc = await qi.describeTable('lottery_bets');
  } catch {
    return;
  }
  if (!desc.source) {
    await qi.addColumn('lottery_bets', 'source', {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'toto_winner',
    });
  }
  if (!desc.commodityId) {
    await qi.addColumn('lottery_bets', 'commodityId', {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: '',
    });
  }
  if (!desc.holdCntId) {
    await qi.addColumn('lottery_bets', 'holdCntId', {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: '',
    });
  }
  if (!desc.odds) {
    await qi.addColumn('lottery_bets', 'odds', {
      type: DataTypes.FLOAT,
      allowNull: true,
    });
  }
  if (!desc.stakeCount) {
    await qi.addColumn('lottery_bets', 'stakeCount', {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    });
  }
}

export async function initDatabase() {
  await sequelize.authenticate();
  await sequelize.sync();
  await ensureRaceBetJraColumns();
  await ensureLotteryBetColumns();
}
