import sqlite3 from 'sqlite3';

export function openSqliteDatabase(filename) {
  const db = new sqlite3.Database(filename);
  return {
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
          if (err) {
            reject(err);
            return;
          }
          resolve({ lastId: this.lastID, changes: this.changes });
        });
      });
    },
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row ?? null);
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        db.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    },
  };
}
