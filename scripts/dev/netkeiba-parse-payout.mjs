/**
 * 結果ページの払戻テーブルを解析する開発用スクリプト
 * 実行: node scripts/dev/netkeiba-parse-payout.mjs [race_id]
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { handleEncoding } from '../../src/scrapers/netkeiba/utils/encoding.mjs';
import NetkeibaScraper from '../../src/scrapers/netkeiba/netkeibaScraper.mjs';

const raceId = process.argv[2] || '202446091009';
const url = `https://nar.netkeiba.com/race/result.html?race_id=${raceId}`;
const res = await axios.get(url, {
  responseType: 'arraybuffer',
  timeout: 30000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    Referer: 'https://nar.netkeiba.com/',
  },
});
const html = handleEncoding(res.data, res, { label: 'parse-payout', url });
const $ = cheerio.load(html);
$('table.Payout_Detail_Table tbody tr').each((_, tr) => {
  const cls = $(tr).attr('class') || '';
  const th = $(tr).find('th').first().text().replace(/\s+/g, ' ').trim();
  console.log('class=', cls, '| th=', JSON.stringify(th));
});
const scraper = new NetkeibaScraper();
const payouts = scraper.parseResultPayouts($);
console.log('--- parsed payouts (label, kind, nums, joiner, payout) ---');
for (const p of payouts) {
  console.log(
    p.label,
    p.kind,
    p.nums,
    p.joiner,
    p.payout,
    p.ninki,
  );
}
