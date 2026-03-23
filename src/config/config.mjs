const config = {
  // Discord設定
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
};

/**
 * @returns {typeof config}
 */
export function getConfig() {
  return config;
}

/**
 * ログ用（トークンを含まない）
 * @returns {{ clientId: string | undefined, tokenConfigured: boolean }}
 */
export function getConfigLogSummary() {
  return {
    clientId: config.clientId,
    tokenConfigured: Boolean(config.token),
  };
}