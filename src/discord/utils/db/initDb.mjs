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
}

/**
 * 起動時に SQLite のテーブルを作成（存在しなければ）
 */
export async function initDatabase() {
  await sequelize.authenticate();
  await sequelize.sync();
  await ensureRaceBetJraColumns();
}
