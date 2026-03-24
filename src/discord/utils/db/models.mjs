import { Sequelize, DataTypes } from 'sequelize';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';

function resolveSqlitePath() {
  const p = process.env.SQLITE_PATH;
  if (p) return isAbsolute(p) ? p : resolve(process.cwd(), p);
  return resolve(process.cwd(), 'data', 'boting.sqlite');
}

const storage = resolveSqlitePath();
mkdirSync(dirname(storage), { recursive: true });

/**
 * discord.js ガイドの Sequelize 例に沿い、まず SQLite ファイルで永続化する。
 * @see https://discordjs.guide/legacy/sequelize
 */
export const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage,
  logging: process.env.SQL_DEBUG === '1' ? console.log : false,
});

export const UserPoint = sequelize.define(
  'UserPoint',
  {
    userId: { type: DataTypes.STRING(32), primaryKey: true },
    balance: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    firstDailyDone: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    lastDailyPeriodKey: { type: DataTypes.STRING(16), allowNull: true },
    dailyStreakDay: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    tableName: 'user_points',
    timestamps: false,
  },
);

export const LedgerEntry = sequelize.define(
  'LedgerEntry',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.STRING(32), allowNull: false },
    delta: { type: DataTypes.INTEGER, allowNull: false },
    balanceAfter: { type: DataTypes.INTEGER, allowNull: false },
    kind: { type: DataTypes.STRING(32), allowNull: false },
    period: { type: DataTypes.STRING(16), allowNull: false },
    streakDay: { type: DataTypes.INTEGER, allowNull: true },
    at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    tableName: 'ledger_entries',
    timestamps: false,
    indexes: [{ fields: ['userId', 'at'] }],
  },
);

export const RaceBet = sequelize.define(
  'RaceBet',
  {
    id: { type: DataTypes.STRING(40), primaryKey: true },
    userId: { type: DataTypes.STRING(32), allowNull: false },
    raceId: { type: DataTypes.STRING(16), allowNull: false },
    raceTitle: { type: DataTypes.STRING(256), allowNull: false, defaultValue: '' },
    venueTitle: { type: DataTypes.STRING(64), allowNull: false, defaultValue: '' },
    betType: { type: DataTypes.STRING(64), allowNull: false, defaultValue: '' },
    selectionLine: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    points: { type: DataTypes.INTEGER, allowNull: false },
    unitYen: { type: DataTypes.INTEGER, allowNull: false },
    costBp: { type: DataTypes.INTEGER, allowNull: false },
    tickets: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    horseNumToFrame: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    trifukuFormation: { type: DataTypes.JSON, allowNull: true },
    /** JRA マルチ投票 ON で購入したか（履歴の簡易表示用） */
    jraMulti: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    /** 馬単・3連単のマルチ切替があった券種（履歴で マルチON/OFF 行を出す） */
    jraMultiOffered: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    /** マルチ展開なしの1行買い目（例: 1>2 または 4>5,6） */
    pickCompact: { type: DataTypes.STRING(512), allowNull: false, defaultValue: '' },
    netkeibaOrigin: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'jra' },
    /** 購入時点のオッズ確定時刻（netkeiba official_datetime）。発走時刻表示に利用 */
    oddsOfficialTime: { type: DataTypes.STRING(128), allowNull: true },
    raceHoldYmd: { type: DataTypes.STRING(8), allowNull: true },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'open' },
    refundBp: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    purchasedAt: { type: DataTypes.DATE, allowNull: false },
    settledAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: 'race_bets',
    timestamps: false,
    indexes: [
      { fields: ['userId', 'status'] },
      { fields: ['userId', 'purchasedAt'] },
      { fields: ['userId', 'raceHoldYmd'] },
      { fields: ['userId', 'raceId'] },
      { fields: ['userId', 'netkeibaOrigin', 'raceId'] },
    ],
  },
);

/** デバッグコマンド許可ユーザー（1 行 1 userId） */
export const DebugAuthorizedUser = sequelize.define(
  'DebugAuthorizedUser',
  {
    userId: { type: DataTypes.STRING(32), primaryKey: true },
  },
  {
    tableName: 'debug_authorized_users',
    timestamps: false,
  },
);
