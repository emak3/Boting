import log4js from 'log4js';

let loggerInstance = null;

/**
 * ロガーを初期化する
 * @returns {Logger} ロガーインスタンス
 */
export function initLogger() {
  if (loggerInstance) {
    return loggerInstance;
  }
  log4js.configure({
    appenders: {
      stdout: { type: 'stdout' },
      app: { type: 'file', filename: 'application.log' }
    },
    categories: {
      default: { appenders: ['stdout'], level: "info" },
      release: { appenders: ['stdout', 'app'], level: "info" },
      develop: { appenders: ['stdout'], level: "debug" }
    }
  });
  loggerInstance = log4js.getLogger(process.env.PROFILE || 'default');
  return loggerInstance;
}

/**
 * ファイル appender のバッファを flush してから終了処理に使う
 * @returns {Promise<void>}
 */
export function shutdownLogger() {
  return new Promise((resolve) => {
    log4js.shutdown(() => resolve());
  });
}