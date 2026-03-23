import { sequelize } from './models.mjs';

/**
 * 起動時に SQLite のテーブルを作成（存在しなければ）
 */
export async function initDatabase() {
  await sequelize.authenticate();
  await sequelize.sync();
}
