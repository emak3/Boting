import axios from 'axios';
import * as cheerio from 'cheerio';
import { handleEncoding } from './utils/encoding.mjs';
import { axiosKeepAlive } from './utils/httpAgents.mjs';
import { createTtlMemo } from '../../utils/cache/ttlMemo.mjs';
import { scrapWithPuppeteer } from './utils/puppeteerFallback.mjs';
import {
  normalizeRaceScrapedText,
  splitCourseAndPrize,
} from './utils/raceTextNormalize.mjs';
import { shutubaHorseRowSelector } from './utils/shutubaDom.mjs';

const NAR_BASE_URL = 'https://nar.netkeiba.com';

/** 出馬表・結果・オッズ API の短時間キャッシュ（連打・同一レースの再取得を抑える） */
const RACE_CARD_CACHE_TTL_MS = 45_000;
/** 未確定の結果が出た直後に再取得しやすいよう、一覧ほど長くしすぎない */
const RACE_RESULT_CACHE_TTL_MS = 35_000;
const JRA_ODDS_CACHE_TTL_MS = 25_000;

const memoRaceCard = createTtlMemo();
const memoRaceResult = createTtlMemo();
const memoJraOdds = createTtlMemo();

/**
 * スケジュールから JRA/NAR が分かっているとき、先方だけで十分な品質ならもう片方の HTML を取りに行かない。
 * （馬数が多くタイトル等も取れている = 誤ページでない可能性が高い）
 */
const SHUTUBA_SKIP_SECOND_FETCH_MIN_SCORE = 120_000;

/** JRA 結果ページでこれを満たせば NAR を取らない（払戻あり＋十分な頭数） */
const RESULT_JRA_STRONG_MIN_HORSES = 8;
const RESULT_JRA_STRONG_MIN_PAYOUT_ROWS = 1;

/** JRA / NAR で同一 race_id が別コンテンツになる。先に取れた方が誤ページだと馬数が少なく払戻も空になりがち */
function scoreScrapedRaceQuality(parsed) {
  const horses = parsed?.horses?.length ?? 0;
  const payouts = parsed?.payouts?.length ?? 0;
  const ri = parsed?.raceInfo || {};
  let score = horses * 10000 + payouts * 100;
  if (ri.title && ri.title !== 'レース情報') score += 500;
  if (ri.date && ri.date !== 'N/A') score += 200;
  if (ri.course && ri.course !== 'N/A') score += 200;
  if (ri.prizeMoney) score += 50;
  return score;
}

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

  static shutubaHorseRowSelector = shutubaHorseRowSelector;

  requestHeadersForBase(baseUrl) {
    return {
      ...this.headers,
      Referer: `${baseUrl.replace(/\/$/, '')}/top/`,
    };
  }

  /**
   * メインの出馬表データ取得メソッド
   * Cheerio: スケジュールで origin が分かるときはそのサイト優先で取得し、十分な品質ならもう片方へ行かない。
   * 不明なときは従来どおり JRA / NAR 並列。
   * Puppeteer は両方の Cheerio が空のときだけ、JRA → NAR の順で試す。
   * @param {string} raceId
   * @param {{ preferredOrigin?: 'jra' | 'nar' | null }} [options]
   */
  async scrapeRaceCard(raceId, options = {}) {
    const { preferredOrigin = null } = options;
    return memoRaceCard(`rc:${raceId}`, RACE_CARD_CACHE_TTL_MS, () =>
      this.scrapeRaceCardUncached(raceId, preferredOrigin),
    );
  }

  /**
   * @param {string} raceId
   * @param {'jra' | 'nar' | null} preferredOrigin
   */
  async scrapeRaceCardUncached(raceId, preferredOrigin) {
    const jraUrl = `${this.baseUrl}/race/shutuba.html?race_id=${raceId}`;
    const narUrl = `${NAR_BASE_URL}/race/shutuba.html?race_id=${raceId}`;
    const jraHeaders = this.requestHeadersForBase(this.baseUrl);
    const narHeaders = this.requestHeadersForBase(NAR_BASE_URL);

    let lastErr;
    try {
      let jraCheerio;
      let narCheerio;

      if (preferredOrigin === null) {
        [jraCheerio, narCheerio] = await Promise.all([
          this.scrapeWithCheerio(jraUrl, { headers: jraHeaders }),
          this.scrapeWithCheerio(narUrl, { headers: narHeaders }),
        ]);
      } else if (preferredOrigin === 'jra') {
        jraCheerio = await this.scrapeWithCheerio(jraUrl, { headers: jraHeaders });
        const jraOkEarly = jraCheerio?.horses?.length ? jraCheerio : null;
        if (
          jraOkEarly &&
          scoreScrapedRaceQuality(jraOkEarly) >= SHUTUBA_SKIP_SECOND_FETCH_MIN_SCORE
        ) {
          jraOkEarly.netkeibaOrigin = 'jra';
          await this.mergeJraOddsFromApi(raceId, jraOkEarly);
          return jraOkEarly;
        }
        narCheerio = await this.scrapeWithCheerio(narUrl, { headers: narHeaders });
      } else {
        narCheerio = await this.scrapeWithCheerio(narUrl, { headers: narHeaders });
        const narOkEarly = narCheerio?.horses?.length ? narCheerio : null;
        if (
          narOkEarly &&
          scoreScrapedRaceQuality(narOkEarly) >= SHUTUBA_SKIP_SECOND_FETCH_MIN_SCORE
        ) {
          narOkEarly.netkeibaOrigin = 'nar';
          return narOkEarly;
        }
        jraCheerio = await this.scrapeWithCheerio(jraUrl, { headers: jraHeaders });
      }

      const jraOk = jraCheerio?.horses?.length ? jraCheerio : null;
      const narOk = narCheerio?.horses?.length ? narCheerio : null;

      if (jraOk && narOk) {
        const pickJra = scoreScrapedRaceQuality(jraOk) >= scoreScrapedRaceQuality(narOk);
        const picked = pickJra ? jraOk : narOk;
        picked.netkeibaOrigin = pickJra ? 'jra' : 'nar';
        if (pickJra) await this.mergeJraOddsFromApi(raceId, picked);
        return picked;
      }
      if (jraOk) {
        jraOk.netkeibaOrigin = 'jra';
        await this.mergeJraOddsFromApi(raceId, jraOk);
        return jraOk;
      }
      if (narOk) {
        narOk.netkeibaOrigin = 'nar';
        return narOk;
      }
    } catch (error) {
      lastErr = error;
      console.warn('scrapeRaceCard cheerio:', error.message);
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
   * JRA で払戻行があり十分な頭数が取れた場合は NAR を取らない（同一 race_id の二重取得を避ける）。
   * @returns {{ confirmed: false } | { confirmed: true, raceId: string, raceInfo: object, horses: object[], payouts: object[] }}
   */
  async scrapeRaceResult(raceId) {
    return memoRaceResult(`rr:${raceId}`, RACE_RESULT_CACHE_TTL_MS, () =>
      this.scrapeRaceResultUncached(raceId),
    );
  }

  async scrapeRaceResultUncached(raceId) {
    const bases = [
      { origin: 'jra', base: this.baseUrl },
      { origin: 'nar', base: NAR_BASE_URL },
    ];
    let best = null;
    let bestScore = -1;
    for (const { origin, base } of bases) {
      const url = `${base}/race/result.html?race_id=${raceId}`;
      const headers = this.requestHeadersForBase(base);
      try {
        const response = await axios.get(url, {
          headers,
          responseType: 'arraybuffer',
          timeout: 30000,
          maxRedirects: 5,
          ...axiosKeepAlive,
        });
        const decodedData = handleEncoding(response.data, response, {
          label: 'scrapeRaceResult',
          url,
        });
        const $ = cheerio.load(decodedData);
        const horses = this.parseResultHorseRows($);
        if (!horses.length) {
          continue;
        }
        const excludedBlock = this.parseExcludedResultHorseRows($);
        const raceInfo = this.extractRaceInfo($);
        const payouts = this.parseResultPayouts($);
        const candidate = {
          confirmed: true,
          raceId: String(raceId),
          raceInfo,
          horses: [...horses, ...excludedBlock.horses],
          excludedHorseNumbers: excludedBlock.excludedHorseNumbers,
          excludedFrames: excludedBlock.excludedFrames,
          payouts,
          scrapedAt: new Date().toISOString(),
          netkeibaOrigin: origin,
        };
        const sc = scoreScrapedRaceQuality(candidate);
        if (sc > bestScore) {
          bestScore = sc;
          best = candidate;
        }
        if (
          origin === 'jra' &&
          horses.length >= RESULT_JRA_STRONG_MIN_HORSES &&
          payouts.length >= RESULT_JRA_STRONG_MIN_PAYOUT_ROWS
        ) {
          return candidate;
        }
      } catch (e) {
        console.warn(`scrapeRaceResult ${origin}:`, e.message);
      }
    }
    if (best) return best;
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

  /**
   * 結果テーブルの除外・取消行（着順が数字でない HorseList）
   * @returns {{ horses: object[], excludedHorseNumbers: string[], excludedFrames: string[] }}
   */
  parseExcludedResultHorseRows($) {
    const horses = [];
    const nums = [];
    const frames = [];

    const pushExcluded = ($row, rankLabel) => {
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

      const jockey =
        $row.find('.JockeyNameSpan').first().text().trim() ||
        $row.find('td.Jockey').first().text().trim() ||
        'N/A';

      const hnNorm = String(horseNumber).replace(/\D/g, '');
      if (!hnNorm || !/^\d+$/.test(hnNorm)) return;

      const fnNorm = String(frameNumber).replace(/\D/g, '');

      horses.push({
        finishRank: rankLabel || '除外',
        frameNumber,
        horseNumber: hnNorm,
        name,
        jockey,
        time: 'N/A',
        margin: '',
        popularity: 'N/A',
        odds: 'N/A',
        excluded: true,
      });
      nums.push(hnNorm);
      if (fnNorm && /^\d+$/.test(fnNorm)) frames.push(fnNorm);
    };

    $('tr.HorseList').each((_, el) => {
      const $row = $(el);
      const rank = $row.find('.Result_Num .Rank').first().text().trim();
      const cls = $row.attr('class') || '';
      const isExcluded =
        rank === '除外' ||
        rank === '取' ||
        rank === '取消' ||
        /\bTorikeshi\b/.test(cls);
      if (!isExcluded) return;
      pushExcluded($row, rank || '除外');
    });

    return {
      horses,
      excludedHorseNumbers: [...new Set(nums)],
      excludedFrames: [...new Set(frames)],
    };
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

  /**
   * JRA: 各 li に1頭ずつ（空 li あり）。NAR: 1 li に need 頭以上の span があるときは null（従来の li 単位処理へ）。
   * @param {2|3} need
   * @returns {string[]|null}
   */
  static extractNumsFromJraStyleUl($, $ul, need) {
    const $lis = $ul.children('li');
    if ($lis.length <= 1) return null;
    let anyLiHasEnough = false;
    $lis.each((__, li) => {
      if (NetkeibaScraper.extractNumSpans($, $(li)).length >= need) {
        anyLiHasEnough = true;
        return false;
      }
    });
    if (anyLiHasEnough) return null;
    const raw = NetkeibaScraper.extractNumSpans($, $ul);
    return raw.length >= need ? raw.slice(0, need) : null;
  }

  /**
   * 人気欄が「5人気1人気2人気」のように連結されているとき行ごとに分割（地方 NAR で多い）
   * @param {string[]} ninkiList td.Ninki 内の span テキスト一覧
   * @param {string} ninkiFallback td.Ninki のプレーンテキスト
   * @param {number} lineCount 払戻行数
   */
  static splitNinkiParts(ninkiList, ninkiFallback, lineCount) {
    const list = (ninkiList || []).filter(Boolean);
    if (lineCount <= 0) return [];
    if (list.length >= lineCount) return list.slice(0, lineCount);
    const blob = String(list[0] || ninkiFallback || '').trim();
    if (!blob) return Array(lineCount).fill('');
    const tokens = [...blob.matchAll(/\d+人気/g)].map((m) => m[0]);
    if (tokens.length >= lineCount) return tokens.slice(0, lineCount);
    const parts = blob.split(/\s+/).filter(Boolean);
    if (parts.length >= lineCount) return parts.slice(0, lineCount);
    return Array.from({ length: lineCount }, (_, i) => list[i] || blob);
  }

  /**
   * 3連複: td.Result 内の1つの ul から、的中組（馬番3つ）の配列を取る。
   * - 1組が <li>×3（各1頭）のパターンと、<li>×1（3頭ぶんspan）や <li>×複数（組が複数行）の両方に対応。
   * 従来は ul 直下の span を全部つなげており、組が複数あると6個以上になり照合不能になっていた。
   */
  static extractFuku3CombosFromUl($, $ul) {
    const $lis = $ul.children('li');
    if (!$lis.length) {
      const nums = NetkeibaScraper.extractNumSpans($, $ul);
      return nums.length >= 3 ? [nums.slice(0, 3)] : [];
    }
    const triplesFromWideLi = [];
    $lis.each((_, li) => {
      const nums = NetkeibaScraper.extractNumSpans($, $(li));
      if (nums.length >= 3) triplesFromWideLi.push(nums.slice(0, 3));
    });
    if (triplesFromWideLi.length) return triplesFromWideLi;

    if ($lis.length === 3) {
      const acc = [];
      $lis.each((_, li) => {
        const nums = NetkeibaScraper.extractNumSpans($, $(li));
        if (nums.length >= 1) acc.push(nums[0]);
      });
      if (acc.length === 3) return [acc];
    }

    const all = NetkeibaScraper.extractNumSpans($, $ul);
    if (all.length >= 3) return [all.slice(0, 3)];
    return [];
  }

  parseResultPayouts($) {
    /** 地方の枠単（Wakutan）は馬単と同様の順序（>） */
    const ORDERED = new Set(['Umatan', 'Tan3', 'Wakutan']);
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
            /\b(Tansho|Fukusho|Wakuren|Umaren|Wide|Wakutan|Umatan|Fuku3|Tan3)\b/,
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
              /** JRA は各 li に1頭＋空 li。NAR は li 内に複数頭ぶんの span のことがある */
              const rowRoots = [];
              $uls.each((_, ul) => {
                const $u = $(ul);
                const $lil = $u.children('li');
                const jraPair = NetkeibaScraper.extractNumsFromJraStyleUl($, $u, 2);
                if (jraPair) {
                  rowRoots.push($u);
                } else if ($lil.length > 1) {
                  $lil.each((__, li) => rowRoots.push($(li)));
                } else {
                  rowRoots.push($u);
                }
              });
              const nkWide = NetkeibaScraper.splitNinkiParts(
                ninkiList,
                ninkiFallback,
                rowRoots.length,
              );
              rowRoots.forEach((root, i) => {
                const nums = NetkeibaScraper.extractNumSpans($, root);
                if (nums.length < 2) return;
                const payout = payoutParts[i] ?? payoutParts[0] ?? '—';
                pushEntry(nums, payout, nkWide[i] ?? '');
              });
              return;
            }
          }

          if (kind === 'Wakuren' || kind === 'Umaren') {
            const $uls = $result.find('ul');
            if ($uls.length > 1) {
              const nkWU = NetkeibaScraper.splitNinkiParts(
                ninkiList,
                ninkiFallback,
                $uls.length,
              );
              $uls.each((i, ul) => {
                const raw = NetkeibaScraper.extractNumSpans($, $(ul));
                if (raw.length < 2) return;
                const nums = raw.slice(0, 2);
                const payout = payoutParts[i] ?? payoutParts[0] ?? '—';
                const nk = nkWU[i] ?? '';
                pushEntry(nums, payout, nk);
              });
              return;
            }
            if ($uls.length === 1) {
              const $lis = $uls.first().children('li');
              if ($lis.length > 1) {
                const jraPair = NetkeibaScraper.extractNumsFromJraStyleUl(
                  $,
                  $uls.first(),
                  2,
                );
                if (jraPair) {
                  pushEntry(
                    jraPair,
                    payoutParts[0] ?? '—',
                    NetkeibaScraper.splitNinkiParts(
                      ninkiList,
                      ninkiFallback,
                      1,
                    )[0] ?? '',
                  );
                  return;
                }
                const nkWU = NetkeibaScraper.splitNinkiParts(
                  ninkiList,
                  ninkiFallback,
                  $lis.length,
                );
                $lis.each((i, li) => {
                  const raw = NetkeibaScraper.extractNumSpans($, $(li));
                  if (raw.length < 2) return;
                  const nums = raw.slice(0, 2);
                  const payout = payoutParts[i] ?? payoutParts[0] ?? '—';
                  pushEntry(nums, payout, nkWU[i] ?? '');
                });
                return;
              }
            }
          }

          if (kind === 'Fuku3') {
            const combos = [];
            $result.find('ul').each((_, ul) => {
              for (const c of NetkeibaScraper.extractFuku3CombosFromUl($, $(ul))) {
                combos.push(c);
              }
            });
            if (combos.length === 0) {
              const ft = NetkeibaScraper.fallbackNumsFromText(resultText);
              if (ft.length >= 3) combos.push(ft.slice(0, 3));
            }
            if (combos.length > 0) {
              const nkF3 = NetkeibaScraper.splitNinkiParts(
                ninkiList,
                ninkiFallback,
                combos.length,
              );
              for (let i = 0; i < combos.length; i++) {
                const payout = payoutParts[i] ?? payoutParts[0] ?? '—';
                const nk = nkF3[i] ?? '';
                pushEntry(combos[i], payout, nk);
              }
            }
            return;
          }

          if (kind === 'Umatan' || kind === 'Tan3' || kind === 'Wakutan') {
            const $uls = $result.find('ul');
            const need = kind === 'Tan3' ? 3 : 2;
            if ($uls.length > 1) {
              const nkUT = NetkeibaScraper.splitNinkiParts(
                ninkiList,
                ninkiFallback,
                $uls.length,
              );
              $uls.each((i, ul) => {
                const raw = NetkeibaScraper.extractNumSpans($, $(ul));
                if (raw.length < need) return;
                const nums = raw.slice(0, need);
                const payout = payoutParts[i] ?? payoutParts[0] ?? '—';
                const nk = nkUT[i] ?? '';
                pushEntry(nums, payout, nk);
              });
              return;
            }
            if ($uls.length === 1) {
              const $lis = $uls.first().children('li');
              if ($lis.length > 1) {
                const jraN = NetkeibaScraper.extractNumsFromJraStyleUl(
                  $,
                  $uls.first(),
                  need,
                );
                if (jraN) {
                  pushEntry(
                    jraN,
                    payoutParts[0] ?? '—',
                    NetkeibaScraper.splitNinkiParts(
                      ninkiList,
                      ninkiFallback,
                      1,
                    )[0] ?? '',
                  );
                  return;
                }
                const nkUT = NetkeibaScraper.splitNinkiParts(
                  ninkiList,
                  ninkiFallback,
                  $lis.length,
                );
                $lis.each((i, li) => {
                  const raw = NetkeibaScraper.extractNumSpans($, $(li));
                  if (raw.length < need) return;
                  const nums = raw.slice(0, need);
                  const payout = payoutParts[i] ?? payoutParts[0] ?? '—';
                  pushEntry(nums, payout, nkUT[i] ?? '');
                });
                return;
              }
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
                const nkTs = NetkeibaScraper.splitNinkiParts(
                  ninkiList,
                  ninkiFallback,
                  tn.length,
                );
                for (let i = 0; i < tn.length; i++) {
                  pushEntry([tn[i]], parts[i], nkTs[i] || '');
                }
                return;
              }
            }
          }

          if (kind === 'Fukusho') {
            const $fukuUls = $result.find('ul');
            if ($fukuUls.length > 1) {
              const nkFu = NetkeibaScraper.splitNinkiParts(
                ninkiList,
                ninkiFallback,
                $fukuUls.length,
              );
              $fukuUls.each((i, ul) => {
                const nums = NetkeibaScraper.extractNumSpans($, $(ul));
                if (!nums.length) return;
                const payout = payoutParts[i] ?? payoutParts[0] ?? '—';
                pushEntry([nums[0]], payout, nkFu[i] || '');
              });
              return;
            }
            const fkNums = NetkeibaScraper.extractNumSpans($, $result);
            if (
              fkNums.length > 0 &&
              payoutParts.length > 0 &&
              payoutParts.length === fkNums.length
            ) {
              const nkFk = NetkeibaScraper.splitNinkiParts(
                ninkiList,
                ninkiFallback,
                fkNums.length,
              );
              for (let i = 0; i < fkNums.length; i++) {
                pushEntry([fkNums[i]], payoutParts[i], nkFk[i] || '');
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
            kind === 'Wakutan' ||
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
        ...axiosKeepAlive,
      });

      // レスポンスオブジェクトも渡してエンコーディングを適切に処理
      const decodedData = handleEncoding(response.data, response, {
        label: 'scrapeWithCheerio',
        url,
      });
      const $ = cheerio.load(decodedData);

      // メインテーブルの確認（中央: Shutuba_Table / 地方: RaceTable01 ShutubaTable など）
      // 予測ラップ等は PredictRap_Table 側にも HorseList があるため table 単位で除外する
      const mainTable = $(
        'table.RaceTable01.ShutubaTable, table.Shutuba_Table.ShutubaTable, table.Shutuba_Table.RaceTable01, .Shutuba_Table.ShutubaTable, .ShutubaTable, .RaceTable01, .Shutuba_Table',
      )
        .not('.PredictRap_Table')
        .filter((i, el) => (el.tagName || '').toLowerCase() === 'table')
        .first();
      const horseRowsOutsidePredict =
        $('tr.HorseList').filter(
          (i, el) => $(el).closest('.PredictRap_Table').length === 0,
        ).length > 0;
      const hasHorseRows =
        $('table:not(.PredictRap_Table) tr.HorseList').length > 0 ||
        $('table:not(.PredictRap_Table) tr[id^="tr_"]').length > 0 ||
        horseRowsOutsidePredict;
      if (!mainTable.length && !hasHorseRows) {
        console.log('Race table not found, checking alternative selectors...');
        const altTable = $('table').filter((i, el) => {
          const $el = $(el);
          if ($el.is('.PredictRap_Table')) return false;
          const text = $el.text();
          const html = $el.html() || '';
          if ($el.find('tr.HorseList').length) return true;
          return (
            text.includes('枠') ||
            text.includes('馬番') ||
            text.includes('馬名') ||
            /HorseList|HorseName|Shutuba_Table|Inner_Shutuba/i.test(html)
          );
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

      const rowClass = $row.attr('class') || '';
      const rowText = $row.text();
      const excluded =
        /\bCancel\b/.test(rowClass) ||
        /\bJogai\b/.test(rowClass) ||
        rowText.includes('除外');

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
        excluded,
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
    return memoJraOdds(`odds:${raceId}`, JRA_ODDS_CACHE_TTL_MS, async () => {
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
        ...axiosKeepAlive,
      });
      if (data?.status === 'NG' || !data?.data?.odds) {
        return null;
      }
      return data.data;
    });
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