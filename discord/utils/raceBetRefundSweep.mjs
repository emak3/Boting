import { settlePendingOpenRaceBetsForUser } from './raceBetRecords.mjs';
import NetkeibaScraper from '../../cheerio/netkeibaScraper.mjs';

/**
 * 未精算の競馬購入を netkeiba 結果に基づき精算（ボタン・履歴UI・スラッシュ共通）
 * @param {string} userId
 */
export async function runPendingRaceRefundsForUser(userId) {
  try {
    const scraper = new NetkeibaScraper();
    await settlePendingOpenRaceBetsForUser(userId, (raceId) =>
      scraper.scrapeRaceResult(raceId),
    );
  } catch (e) {
    console.warn('runPendingRaceRefundsForUser', e);
  }
}
