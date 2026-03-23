/**
 * 同一キーへの同時リクエストを 1 本にまとめ、短時間はメモリに保持する。
 * netkeibaSchedule の memoSchedule と同じパターン（共通化）。
 */
export function createTtlMemo() {
  /** @type {Map<string, { expires: number, value: unknown }>} */
  const memo = new Map();
  /** @type {Map<string, Promise<unknown>>} */
  const inflight = new Map();

  /**
   * @template T
   * @param {string} key
   * @param {number} ttlMs
   * @param {() => Promise<T>} factory
   * @returns {Promise<T>}
   */
  return async function memoTtl(key, ttlMs, factory) {
    const now = Date.now();
    const hit = memo.get(key);
    if (hit && hit.expires > now) return /** @type {Promise<T>} */ (Promise.resolve(hit.value));
    if (inflight.has(key)) return /** @type {Promise<T>} */ (inflight.get(key));
    const p = factory()
      .then((value) => {
        memo.set(key, { expires: Date.now() + ttlMs, value });
        inflight.delete(key);
        return value;
      })
      .catch((e) => {
        inflight.delete(key);
        throw e;
      });
    inflight.set(key, p);
    return /** @type {Promise<T>} */ (p);
  };
}
