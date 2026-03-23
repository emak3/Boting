/**
 * gRPC 等の RESOURCE_EXHAUSTED（code 8）を判定する
 * @param {unknown} e
 */
export function isGrpcResourceExhaustedError(e) {
  const code = e?.code ?? e?.rawError?.code;
  if (code === 8) return true;
  const details = String(e?.details ?? '');
  const msg = String(e?.message ?? '');
  return /Quota exceeded|RESOURCE_EXHAUSTED/i.test(details + msg);
}

/**
 * クォータ超過または SQLite のディスク不足など、DB 側の容量・上限エラー
 * @param {unknown} e
 */
export function isDatabaseCapacityError(e) {
  if (isGrpcResourceExhaustedError(e)) return true;
  const msg = String(e?.message ?? '');
  return /SQLITE_FULL|database or disk is full/i.test(msg);
}
