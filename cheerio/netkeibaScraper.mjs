import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { handleEncoding } from './utils/encoding.mjs';
import { scrapWithPuppeteer } from './utils/puppeteerFallback.mjs';
import {
  normalizeRaceScrapedText,
  splitCourseAndPrize,
} from './utils/raceTextNormalize.mjs';

const NAR_BASE_URL = 'https://nar.netkeiba.com';

class NetkeibaScraper {
  constructor() {
    this.baseUrl = 'https://race.netkeiba.com';
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://race.netkeiba.com/top/',
    };
  }

  /** 出馬表の馬行のみ（予想ラップ等の別テーブルの HorseList を除外） */
  static shutubaHorseRowSelector =
    '.Shutuba_Table.ShutubaTable:not(.PredictRap_Table) tr.HorseList, .Shutuba_Table.RaceTable01.ShutubaTable:not(.PredictRap_Table) tr[id^="tr_"], table.RaceTable01.ShutubaTable:not(.PredictRap_Table) tr.HorseList, table.RaceTable01.ShutubaTable:not(.PredictRap_Table) tr[id^="tr_"]';

  requestHeadersForBase(baseUrl) {
    return {
      ...this.headers,
      Referer: `${baseUrl.replace(/\/$/, '')}/top/`,
    };
  }

  /**
   * メインの出馬表データ取得メソッド
   * Cheerio は JRA / NAR を並列に取り、どちらかで馬が取れたら即返す（NAR で JRA 用 Puppeteer が走らないようにする）。
   * Puppeteer は両方の Cheerio が空のときだけ、JRA → NAR の順で試す。
   */
  async scrapeRaceCard(raceId) {
    const jraUrl = `${this.baseUrl}/race/shutuba.html?race_id=${raceId}`;
    const narUrl = `${NAR_BASE_URL}/race/shutuba.html?race_id=${raceId}`;
    const jraHeaders = this.requestHeadersForBase(this.baseUrl);
    const narHeaders = this.requestHeadersForBase(NAR_BASE_URL);

    let lastErr;
    try {
      const [jraCheerio, narCheerio] = await Promise.all([
        this.scrapeWithCheerio(jraUrl, { headers: jraHeaders }),
        this.scrapeWithCheerio(narUrl, { headers: narHeaders }),
      ]);

      if (jraCheerio?.horses?.length) {
        jraCheerio.netkeibaOrigin = 'jra';
        await this.mergeJraOddsFromApi(raceId, jraCheerio);
        return jraCheerio;
      }
      if (narCheerio?.horses?.length) {
        narCheerio.netkeibaOrigin = 'nar';
        return narCheerio;
      }
    } catch (error) {
      lastErr = error;
      console.warn('scrapeRaceCard cheerio parallel:', error.message);
    }

    const puppeteerBases = [
      { origin: 'jra', base: this.baseUrl },
      { origin: 'nar', base: NAR_BASE_URL },
    ];
    for (const { origin, base } of puppeteerBases) {
      const url = `${base}/race/shutuba.html?race_id=${raceId}`;
      try {
        console.log(`Cheerio empty for both sites, Puppeteer: ${origin}...`);
        const result = await this.scrapeWithPuppeteer(url);
        if (result && result.horses.length > 0) {
          result.netkeibaOrigin = origin;
          if (origin === 'jra') await this.mergeJraOddsFromApi(raceId, result);
          return result;
        }
      } catch (error) {
        lastErr = error;
        console.warn(`scrapeRaceCard puppeteer ${origin}:`, error.message);
      }
    }

    console.error('Error scraping race card:', lastErr);
    throw new Error(`Failed to scrape race data: ${lastErr?.message || 'no data'}`);
  }

  /**
   * レース結果・払戻（result.html）
   * @returns {{ confirmed: false } | { confirmed: true, raceId: string, raceInfo: object, horses: object[], payouts: object[] }}
   */
  async scrapeRaceResult(raceId) {
    const bases = [
      { origin: 'jra', base: this.baseUrl },
      { origin: 'nar', base: NAR_BASE_URL },
    ];
    for (const { origin, base } of bases) {
      const url = `${base}/race/result.html?race_id=${raceId}`;
      const headers = this.requestHeadersForBase(base);
      try {
        const response = await axios.get(url, {
          headers,
          responseType: 'arraybuffer',
          timeout: 15000,
          maxRedirects: 5,
        });
        const decodedData = handleEncoding(response.data, response);
        const $ = cheerio.load(decodedData);
        const horses = this.parseResultHorseRows($);
        if (!horses.length) {
          continue;
        }
        const raceInfo = this.extractRaceInfo($);
        const payouts = this.parseResultPayouts($);
        return {
          confirmed: true,
          raceId: String(raceId),
          raceInfo,
          horses,
          payouts,
          scrapedAt: new Date().toISOString(),
          netkeibaOrigin: origin,
        };
      } catch (e) {
        console.warn(`scrapeRaceResult ${origin}:`, e.message);
      }
    }
    return { confirmed: false };
  }

  parseResultHorseRows($) {
    const horses = [];
    /** 同一行が複数セレクタで拾われないよう (着順+馬番) で除く。同着は馬番が異なるため残る */
    const seenHorseKey = new Set();

    const addFromRow = ($row) => {
      const finishRank = $row.find('.Result_Num .Rank').first().text().trim();
      if (!finishRank || !/^\d+$/.test(finishRank)) return;

      let frameNumber = 'N/A';
      let horseNumber = 'N/A';
      const $numTds = $row.find('> td.Num');
      if ($numTds.length >= 2) {
        frameNumber =
          $numTds.eq(0).find('div').first().text().trim() ||
          $numTds.eq(0).text().replace(/\s+/g, ' ').trim() ||
          'N/A';
        horseNumber =
          $numTds.eq(1).find('div').first().text().trim() ||
          $numTds.eq(1).text().replace(/\s+/g, ' ').trim() ||
          'N/A';
      }
      if (horseNumber === 'N/A' || !/^\d+$/.test(String(horseNumber).replace(/\D/g, ''))) {
        const $wakuTd = $row.find('td.Num[class*="Waku"]').first();
        const wakuClass = $wakuTd.attr('class') || '';
        const wm = wakuClass.match(/Waku(\d)/);
        frameNumber = wm ? wm[1] : $wakuTd.find('div').first().text().trim() || frameNumber;
        horseNumber =
          $row.find('td.Num.Txt_C').first().find('div').first().text().trim() ||
          $row.find('td.Num.Txt_C').first().text().trim() ||
          horseNumber;
      }

      const name =
        $row.find('.HorseNameSpan').first().text().trim() ||
        $row.find('.Horse_Name a').first().text().trim() ||
        $row.find('.Horse_Name').first().text().trim() ||
        'N/A';

      const $timeTds = $row.find('td.Time');
      let time = $timeTds.eq(0).find('.RaceTime').first().text().trim();
      if (!time) time = $timeTds.eq(0).text().replace(/\s+/g, ' ').trim() || 'N/A';
      let margin = $timeTds.eq(1).find('.RaceTime').first().text().trim();
      if (!margin) margin = $timeTds.eq(1).text().replace(/\s+/g, ' ').trim();

      const jockey =
        $row.find('.JockeyNameSpan').first().text().trim() ||
        $row.find('td.Jockey').first().text().trim() ||
        'N/A';

      let popularity = $row.find('td.Odds .OddsPeople').first().text().trim();
      if (!popularity) popularity = $row.find('td.Odds.Txt_C').first().text().trim();
      if (!popularity) popularity = 'N/A';

      let odds = $row.find('span.Odds_Ninki').first().text().trim();
      if (!odds) odds = $row.find('td.Odds.Txt_R').first().text().trim();
      if (!odds) odds = 'N/A';

      const hnNorm = String(horseNumber).replace(/\D/g, '');
      const dedupeKey =
        hnNorm && /^\d+$/.test(hnNorm) ? `${finishRank}|${hnNorm}` : null;
      if (dedupeKey && seenHorseKey.has(dedupeKey)) return;
      if (dedupeKey) seenHorseKey.add(dedupeKey);

      horses.push({
        finishRank,
        frameNumber,
        horseNumber,
        name,
        jockey,
        time,
        margin,
        popularity,
        odds,
      });
    };

    $('#All_Result_Table tbody tr').each((_, el) => addFromRow($(el)));
    $('#All_Result_Table tr.HorseList').each((_, el) => addFromRow($(el)));
    $('table.ResultRefund tr.HorseList').each((_, el) => addFromRow($(el)));

    horses.sort((a, b) => Number(a.finishRank) - Number(b.finishRank));
    return horses;
  }

  /** tr.Result 内の span から数字だけ拾う（空は除外） */
  static extractNumSpans($, $root) {
    const out = [];
    $root.find('span').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t && /^\d+$/.test(t)) out.push(t);
    });
    return out;
  }

  parseResultPayouts($) {
    const ORDERED = new Set(['Umatan', 'Tan3']);
    const payouts = [];

    $('table.Payout_Detail_Table').each((_, table) => {
      $(table)
        .find('tbody tr')
        .each((__, tr) => {
          const $tr = $(tr);
          const label = $tr.find('th').first().text().replace(/\s+/g, ' ').trim();
          if (!label) return;

          const cls = $tr.attr('class') || '';
          const kindMatch = cls.match(
            /\b(Tansho|Fukusho|Wakuren|Umaren|Wide|Umatan|Fuku3|Tan3)\b/,
          );
          const kind = kindMatch ? kindMatch[1] : null;

          const $result = $tr.find('td.Result').first();
          const resultText = $result
            .text()
            .replace(/\s+/g, ' ')
            .trim();

          const payoutParts = [];
          $tr.find('td.Payout span').each((_, s) => {
            const raw = $(s).html() || '';
            const pieces = String(raw)
              .split(/<br\s*\/?>/gi)
              .map((chunk) =>
                chunk
                  .replace(/<[^>]+>/g, '')
                  .replace(/\s+/g, ' ')
                  .trim(),
              )
              .filter(Boolean);
            if (pieces.length) payoutParts.push(...pieces);
            else {
              const t = $(s).text().replace(/\s+/g, ' ').trim();
              if (t) payoutParts.push(t);
            }
          });

          const $ninkiCell = $tr.find('td.Ninki').first();
          const ninkiList = $ninkiCell
            .find('span')
            .map((_, s) => $(s).text().replace(/\s+/g, ' ').trim())
            .get()
            .filter(Boolean);
          const ninkiFallback = $ninkiCell.text().replace(/\s+/g, ' ').trim();

          const pushEntry = (nums, payout, ninki) => {
            const joiner = ORDERED.has(kind) ? '>' : '-';
            if (!nums.length && !resultText && (!payout || payout === '—')) return;
            payouts.push({
              label,
              kind,
              nums: nums.length ? nums : NetkeibaScraper.fallbackNumsFromText(resultText),
              joiner,
              payout: payout || '—',
              ninki: ninki || '',
              result: resultText || '—',
            });
          };

          if (kind === 'Wide') {
            const $uls = $result.find('ul');
            if ($uls.length) {
              $uls.each((i, ul) => {
                const nums = NetkeibaScraper.extractNumSpans($, $(ul));
                const payout = payoutParts[i] ?? payoutParts[0] ?? '—';
                const nk = ninkiList[i] ?? ninkiList.join(' ') ?? ninkiFallback;
                pushEntry(nums, payout, nk);
              });
              return;
            }
          }

          if (kind === 'Wakuren' || kind === 'Umaren') {
            const $uls = $result.find('ul');
            if ($uls.length > 1) {
              $uls.each((i, ul) => {
                const raw = NetkeibaScraper.extractNumSpans($, $(ul));
                if (raw.length < 2) return;
                const nums = raw.slice(0, 2);
                const payout = payoutParts[i] ?? payoutParts[0] ?? '—';
                const nk =
                  ninkiList.length > i
                    ? ninkiList[i]
                    : ninkiList.length === 1
                      ? ninkiList[0]
                      : ninkiFallback;
                pushEntry(nums, payout, nk);
              });
              return;
            }
          }

          if (kind === 'Umatan' || kind === 'Tan3' || kind === 'Fuku3') {
            const $uls = $result.find('ul');
            if ($uls.length > 1) {
              const need = kind === 'Umatan' ? 2 : 3;
              $uls.each((i, ul) => {
                const raw = NetkeibaScraper.extractNumSpans($, $(ul));
                if (raw.length < need) return;
                const nums = raw.slice(0, need);
                const payout = payoutParts[i] ?? payoutParts[0] ?? '—';
                const nk =
                  ninkiList.length > i
                    ? ninkiList[i]
                    : ninkiList.length === 1
                      ? ninkiList[0]
                      : ninkiFallback;
                pushEntry(nums, payout, nk);
              });
              return;
            }
          }

          if (kind === 'Tansho') {
            const tn = NetkeibaScraper.extractNumSpans($, $result);
            if (tn.length > 1) {
              let parts = [...payoutParts];
              if (parts.length < tn.length && parts.length === 1) {
                parts = String(parts[0] || '')
                  .split(/\s*\/\s*/)
                  .map((s) => s.trim())
                  .filter(Boolean);
              }
              if (parts.length >= tn.length) {
                for (let i = 0; i < tn.length; i++) {
                  const nk =
                    ninkiList.length >= tn.length
                      ? ninkiList[i]
                      : ninkiList.length === 1
                        ? ninkiList[0]
                        : ninkiFallback;
                  pushEntry([tn[i]], parts[i], nk);
                }
                return;
              }
            }
          }

          if (kind === 'Fukusho') {
            const fkNums = NetkeibaScraper.extractNumSpans($, $result);
            if (
              fkNums.length > 0 &&
              payoutParts.length > 0 &&
              payoutParts.length === fkNums.length
            ) {
              for (let i = 0; i < fkNums.length; i++) {
                let nk = '';
                if (ninkiList.length === fkNums.length) nk = ninkiList[i];
                else if (ninkiList.length === 1) nk = ninkiList[0];
                else nk = ninkiFallback;
                pushEntry([fkNums[i]], payoutParts[i], nk);
              }
              return;
            }
          }

          let nums = [];
          if (kind === 'Tansho' || kind === 'Fukusho') {
            nums = NetkeibaScraper.extractNumSpans($, $result);
          } else if (
            kind === 'Wakuren' ||
            kind === 'Umaren' ||
            kind === 'Umatan' ||
            kind === 'Fuku3' ||
            kind === 'Tan3'
          ) {
            const $ul = $result.find('ul').first();
            nums = NetkeibaScraper.extractNumSpans($, $ul);
          } else {
            nums = NetkeibaScraper.extractNumSpans($, $result);
            if (!nums.length) nums = NetkeibaScraper.fallbackNumsFromText(resultText);
          }

          const payout =
            payoutParts.length > 1 ? payoutParts.join(' / ') : payoutParts[0] || '—';
          const ninki =
            ninkiList.length > 1 ? ninkiList.join(' ') : ninkiList[0] || ninkiFallback;

          if (label && (nums.length || resultText || payout !== '—')) {
            pushEntry(nums, payout, ninki);
          }
        });
    });
    return payouts;
  }

  static fallbackNumsFromText(text) {
    if (!text) return [];
    const m = String(text).match(/\d+/g);
    return m || [];
  }

  /**
   * Cheerioを使用したスクレイピング
   */
  async scrapeWithCheerio(url, options = {}) {
    const headers = options.headers || this.headers;
    try {
      const response = await axios.get(url, {
        headers,
        responseType: 'arraybuffer',
        timeout: 10000,
        maxRedirects: 5,
      });

      // レスポンスオブジェクトも渡してエンコーディングを適切に処理
      const decodedData = handleEncoding(response.data, response);
      const $ = cheerio.load(decodedData);

      // メインテーブルの確認（中央: Shutuba_Table / 地方: RaceTable01 ShutubaTable など）
      const mainTable = $(
        'table.RaceTable01.ShutubaTable, .Shutuba_Table.ShutubaTable, .ShutubaTable, .RaceTable01, .Shutuba_Table',
      )
        .not('.PredictRap_Table')
        .first();
      if (!mainTable.length) {
        console.log('Race table not found, checking alternative selectors...');
        // 代替セレクタもチェック
        const altTable = $('table').filter((i, el) => {
          const text = $(el).text();
          return text.includes('枠') || text.includes('馬番') || text.includes('馬名');
        }).first();
        
        if (!altTable.length) {
          throw new Error('Race table not found');
        }
      }

      return this.parseHorseData($);

    } catch (error) {
      console.error('Cheerio scraping failed:', error);
      return null;
    }
  }

  /**
   * 馬データの解析
   */
  parseHorseData($) {
    const horses = [];
    const raceInfo = this.extractRaceInfo($);

    // 各馬のデータを抽出 - より柔軟なセレクタを使用
    $(NetkeibaScraper.shutubaHorseRowSelector).each((index, element) => {
      const $row = $(element);
      
      // ヘッダー行をスキップ
      if ($row.find('th').length > 0) return;
      
      // 馬名の抽出 - より多くのパターンに対応
      const $horseName = $row.find('.HorseName a, .HorseInfo .HorseName a, td a[href*="/horse/"]').first();
      if (!$horseName.length) return;

      const horse = {
        frameNumber: this.extractFrameNumber($row, $),
        horseNumber: this.extractHorseNumber($row, $),
        name: $horseName.text().trim(),
        url: $horseName.attr('href'),
        horseId: this.extractHorseId($horseName.attr('href')),
        age: this.extractAge($row, $),
        weight: this.extractWeight($row, $),
        odds: this.extractOdds($row, $),
        placeOddsMin: null,
        popularity: this.extractPopularity($row, $),
        jockey: this.extractJockey($row, $),
        trainer: this.extractTrainer($row, $),
      };

      if (horse.name && horse.name !== '') {
        horses.push(horse);
      }
    });

    return {
      raceInfo,
      horses,
      totalHorses: horses.length,
      scrapedAt: new Date().toISOString(),
      method: 'cheerio'
    };
  }

  /**
   * レース情報の抽出
   */
  extractRaceInfo($) {
    return {
      title:
        normalizeRaceScrapedText(
          $('.RaceName, .race_name, h1.raceTitle').first().text(),
        ) || 'レース情報',
      date:
        normalizeRaceScrapedText(
          $('.RaceData01, .race_date, .raceData01').first().text(),
        ) || 'N/A',
      ...(() => {
        const raw = normalizeRaceScrapedText(
          $('.RaceData02, .course_info, .raceData02').first().text(),
        );
        const { course, prizeMoney } = splitCourseAndPrize(raw);
        return { course: course || 'N/A', prizeMoney };
      })(),
      class:
        normalizeRaceScrapedText(
          $('.RaceData03, .race_class, .raceData03').first().text(),
        ) || 'N/A',
    };
  }

  /**
   * 枠番の抽出
   */
  extractFrameNumber($row, $) {
    // 複数のクラス名パターンに対応
    const frameElement = $row.find('[class*="Waku"], td.waku').first();
    if (frameElement.length) {
      return frameElement.text().trim();
    }
    
    // td要素から直接取得を試みる（通常1番目）
    const firstTd = $row.find('td').eq(0);
    const text = firstTd.text().trim();
    if (text && /^\d+$/.test(text)) {
      return text;
    }
    
    return 'N/A';
  }

  /**
   * 馬番の抽出
   */
  extractHorseNumber($row, $) {
    const horseNumElement = $row.find('[class*="Umaban"], td.umaban').first();
    if (horseNumElement.length) {
      return horseNumElement.text().trim();
    }
    
    // td要素から直接取得を試みる（通常2番目）
    const secondTd = $row.find('td').eq(1);
    const text = secondTd.text().trim();
    if (text && /^\d+$/.test(text)) {
      return text;
    }
    
    return 'N/A';
  }

  /**
   * 年齢の抽出
   */
  extractAge($row, $) {
    const ageElement = $row.find('.Barei, td.barei').first();
    if (ageElement.length) {
      return ageElement.text().trim();
    }
    
    // 性齢の情報を含むtdを探す
    const ageTd = $row.find('td').filter((i, el) => {
      const text = $(el).text().trim();
      return /^[牡牝セ][0-9]+$/.test(text);
    }).first();
    
    return ageTd.text().trim() || 'N/A';
  }

  /**
   * 斤量の抽出
   */
  extractWeight($row, $) {
    const weightElement = $row.find('.Futan, td.futan').first();
    if (weightElement.length) {
      return weightElement.text().trim();
    }
    
    // 数値のみのtdで斤量らしきものを探す
    const weightTd = $row.find('td').filter((i, el) => {
      const text = $(el).text().trim();
      return /^\d+(\.\d+)?$/.test(text) && parseFloat(text) >= 48 && parseFloat(text) <= 65;
    }).first();
    
    return weightTd.text().trim() || 'N/A';
  }

  /**
   * オッズの抽出（動的コンテンツのため初期値は取得困難）
   */
  extractOdds($row, $) {
    const oddsElement = $row.find('span[id^="odds-1_"], td.Txt_R.Popular span[id^="odds-"]').first();
    let oddsText = oddsElement.text().trim();
    if (!oddsText || oddsText === '---.-' || oddsText === '**') {
      oddsText = $row.find('td.Popular.Txt_R').first().text().trim();
    }
    return oddsText && oddsText !== '---.-' && oddsText !== '**' && oddsText !== '' ? oddsText : 'N/A';
  }

  /**
   * 人気の抽出
   */
  extractPopularity($row, $) {
    const popularityElement = $row.find('span[id^="ninki-1_"], [id^="ninki-"], .Popular_Ninki span, td.ninki').first();
    let popularityText = popularityElement.text().trim().replace(/^\(|\)$/g, '');
    if (!popularityText || popularityText === '**') {
      popularityText = $row.find('td.Popular.Txt_C').first().text().trim();
    }
    return popularityText && popularityText !== '**' && popularityText !== '' ? popularityText : 'N/A';
  }

  /**
   * 騎手情報の抽出
   */
  extractJockey($row, $) {
    const jockeyElement = $row.find('.Jockey a, td.jockey a, a[href*="/jockey/"]').first();
    return jockeyElement.text().trim() || 'N/A';
  }

  /**
   * 調教師情報の抽出
   */
  extractTrainer($row, $) {
    const trainerElement = $row.find('.Trainer a, td.trainer a, a[href*="/trainer/"]').first();
    return trainerElement.text().trim() || 'N/A';
  }

  /**
   * テキスト抽出のヘルパー
   */
  extractText($element) {
    return $element.text().trim() || 'N/A';
  }

  /**
   * 馬IDの抽出
   */
  extractHorseId(url) {
    if (!url) return null;
    const match = url.match(/horse\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * JRA 単勝・複勝オッズ API（ページの jquery.odds_update と同系統）
   * @see https://race.netkeiba.com/api/api_get_jra_odds.html
   */
  async fetchJraOddsPayload(raceId) {
    const params = new URLSearchParams({
      pid: 'api_get_jra_odds',
      input: 'UTF-8',
      output: 'json',
      race_id: String(raceId),
      type: '1',
      action: 'init',
      sort: 'odds',
      compress: '0',
    });
    const apiUrl = `${this.baseUrl}/api/api_get_jra_odds.html?${params.toString()}`;
    const { data } = await axios.get(apiUrl, {
      headers: this.headers,
      timeout: 15000,
    });
    if (data?.status === 'NG' || !data?.data?.odds) {
      return null;
    }
    return data.data;
  }

  /**
   * horses に API の単勝・複勝（下限）・人気を上書きマージ
   */
  async mergeJraOddsFromApi(raceId, result) {
    if (!result?.horses?.length) return;
    let payload;
    try {
      payload = await this.fetchJraOddsPayload(raceId);
    } catch (e) {
      console.warn('JRA odds API failed:', e.message);
      return;
    }
    if (!payload?.odds) return;

    const win = payload.odds['1'] || {};
    const place = payload.odds['2'] || {};
    for (const horse of result.horses) {
      const num = String(horse.horseNumber).replace(/\D/g, '');
      if (!num) continue;
      const key = num.padStart(2, '0');
      const winRow = win[key];
      if (winRow && winRow[0] != null && String(winRow[0]).trim() !== '') {
        horse.odds = String(winRow[0]).trim();
      }
      if (winRow && winRow[2] != null && String(winRow[2]).trim() !== '') {
        horse.popularity = String(winRow[2]).trim();
      }
      const placeRow = place[key];
      if (placeRow && placeRow[0] != null && String(placeRow[0]).trim() !== '') {
        horse.placeOddsMin = String(placeRow[0]).trim();
      }
    }
    result.oddsOfficialTime = payload.official_datetime || null;
  }

  /**
   * Puppeteerフォールバック
   */
  async scrapeWithPuppeteer(url) {
    return await scrapWithPuppeteer(url);
  }
}

export default NetkeibaScraper;