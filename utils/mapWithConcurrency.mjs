/**
 * 入力順を保ちつつ、同時実行数だけプールする。
 * @template T, R
 * @param {readonly T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} mapper
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, concurrency, mapper) {
  const n = Math.max(1, Math.floor(concurrency) || 1);
  if (!items.length) return [];
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    for (;;) {
      const i = index++;
      if (i >= items.length) return;
      results[i] = await mapper(items[i], i);
    }
  }

  const pool = Math.min(n, items.length);
  await Promise.all(Array.from({ length: pool }, () => worker()));
  return results;
}
