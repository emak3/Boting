import { settlePendingOpenRaceBetsForUser } from './raceBetRecords.mjs';
import NetkeibaScraper from '../../../scrapers/netkeiba/netkeibaScraper.mjs';

/** @type {Map<string, Promise<void>>} */
const refundSweepTailByUserId = new Map();

/**
 * 未精算の競馬購入を netkeiba 結果に基づき精算（ボタン・履歴UI・スラッシュ共通）
 * 精算済み行は DB 上の買い目と結果の差分があれば refundBp・残高を調整する。
 * 同一 userId の呼び出しは直列化し、並行実行による二重計上を防ぐ。
 * @param {string} userId
 */
export async function runPendingRaceRefundsForUser(userId) {
  const uid = String(userId || '');
  if (!uid) return;

  const prev = refundSweepTailByUserId.get(uid) ?? Promise.resolve();
  const run = async () => {
    try {
      const scraper = new NetkeibaScraper();
      await settlePendingOpenRaceBetsForUser(uid, (raceId) =>
        scraper.scrapeRaceResult(raceId),
      );
    } catch (e) {
      console.warn('runPendingRaceRefundsForUser', e);
    }
  };
  const next = prev.catch(() => {}).then(() => run());
  refundSweepTailByUserId.set(uid, next);
  try {
    await next;
  } finally {
    if (refundSweepTailByUserId.get(uid) === next) {
      refundSweepTailByUserId.delete(uid);
    }
  }
}
