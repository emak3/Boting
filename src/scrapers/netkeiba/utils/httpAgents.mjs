import http from 'node:http';
import https from 'node:https';

/** netkeiba 向け axios で TCP を再利用（連続リクエストのレイテンシ低減） */
export const httpKeepAliveAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 50,
});

export const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
});

/** axios の get/post にそのまま渡す */
export const axiosKeepAlive = {
  httpAgent: httpKeepAliveAgent,
  httpsAgent: httpsKeepAliveAgent,
};
