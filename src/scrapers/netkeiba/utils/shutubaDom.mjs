/**
 * 出馬表（shutuba）の DOM セレクタ。Cheerio / Puppeteer で共通利用。
 */

/** 馬行のみ（予想ラップ等の別テーブルの HorseList は除外） */
export const shutubaHorseRowSelector =
  '.Shutuba_Table.ShutubaTable:not(.PredictRap_Table) tr.HorseList, .Shutuba_Table.RaceTable01.ShutubaTable:not(.PredictRap_Table) tr[id^="tr_"], table.RaceTable01.ShutubaTable:not(.PredictRap_Table) tr.HorseList, table.RaceTable01.ShutubaTable:not(.PredictRap_Table) tr[id^="tr_"], table.Shutuba_Table.RaceTable01:not(.PredictRap_Table) tr.HorseList, table.Shutuba_Table.RaceTable01:not(.PredictRap_Table) tr[id^="tr_"]';
