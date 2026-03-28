/**
 * 出馬表（shutuba）の DOM セレクタ。Cheerio / Puppeteer で共通利用。
 */

/** 馬行のみ（予想ラップ等の別テーブルの HorseList は除外） */
export const shutubaHorseRowSelector =
  '.Shutuba_Table.ShutubaTable:not(.PredictRap_Table) tr.HorseList, .Shutuba_Table.RaceTable01.ShutubaTable:not(.PredictRap_Table) tr[id^="tr_"], table.RaceTable01.ShutubaTable:not(.PredictRap_Table) tr.HorseList, table.RaceTable01.ShutubaTable:not(.PredictRap_Table) tr[id^="tr_"], table.Shutuba_Table.RaceTable01:not(.PredictRap_Table) tr.HorseList, table.Shutuba_Table.RaceTable01:not(.PredictRap_Table) tr[id^="tr_"]';

/** shutuba_past.html（5走表示）のメインテーブル行 */
export const shutubaPast5HorseRowSelector =
  'table.Shutuba_Table.Shutuba_Past5_Table:not(.PredictRap_Table) tr.HorseList, table.Shutuba_Table.Shutuba_Past5_Table:not(.PredictRap_Table) tr[id^="tr_"]';

/**
 * `.Horse06` 内の休み・間隔（例: 中8週）。
 * NAR は `<div class="Type Type03"><span>差</span></div>` のように脚質が入るため除く。
 * 脚質の span.kyakusitu・画像も除く。
 * @param {*} $row cheerio の行要素
 * @param {*} $ 未使用（呼び出し元と extract 系の署名揃え）
 */
export function extractHorseIntervalRestText($row, $) {
  const $h06 = $row.find('.Horse06').first();
  if (!$h06.length) return '';
  const $clone = $h06.clone();
  $clone.find('img').remove();
  $clone.find('span.kyakusitu').remove();
  $clone.find('.Type').remove();
  return $clone.text().replace(/\s+/g, ' ').trim();
}
