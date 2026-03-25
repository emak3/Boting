import {
  extractShutubaPostTimeText,
  normalizeRaceScrapedText,
  splitCourseAndPrize,
} from './raceTextNormalize.mjs';
import { shutubaHorseRowSelector } from './shutubaDom.mjs';
import { withPuppeteerPage } from './puppeteerBrowserPool.mjs';

/**
 * 出馬表 DOM が解決したか（networkidle2 に依存しない）
 * @returns {boolean}
 */
function shutubaDomReadyInPage() {
  if (document.querySelectorAll('tr.HorseList').length > 0) return true;
  return !!document.querySelector(
    [
      'table.RaceTable01.ShutubaTable',
      'table.Shutuba_Table.ShutubaTable',
      'table.Shutuba_Table.RaceTable01',
      '.Shutuba_Table.ShutubaTable',
      '.ShutubaTable',
      'table.Shutuba_Table.RaceTable01',
      '.RaceTable01',
      '.Shutuba_Table',
      'table',
    ].join(', '),
  );
}

/**
 * Puppeteerを使用した高信頼性スクレイピング（ブラウザはプールで再利用）
 */
export async function scrapWithPuppeteer(url) {
  try {
    return await withPuppeteerPage(async (page) => {
      const origin = new URL(url).origin;
      await page.setViewport({ width: 1280, height: 900 });
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
        Referer: `${origin}/top/`,
      });

      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      );

      await page.goto(url, {
        waitUntil: 'load',
        timeout: 45000,
      });

      try {
        await page.waitForFunction(shutubaDomReadyInPage, {
          timeout: 30000,
          polling: 250,
        });
      } catch (e) {
        console.warn(
          'Puppeteer: shutuba DOM wait timed out, parsing HTML anyway:',
          e?.message ?? e,
        );
      }

      await new Promise((r) => setTimeout(r, 800));

      const charset = await page.evaluate(() => {
        return document.characterSet || document.charset;
      });
      console.log(`Page charset: ${charset}`);

      const html = await page.content();
      const $ = (await import('cheerio')).load(html);

      return parseHorseDataFromHtml($);
    });
  } catch (error) {
    console.error('Puppeteer scraping failed:', error);
    throw error;
  }
}

/**
 * HTMLからの馬データ解析（Puppeteer用）
 */
function parseHorseDataFromHtml($) {
  const horses = [];
  const raceInfo = extractRaceInfo($);

  $(shutubaHorseRowSelector).each((index, element) => {
    const $row = $(element);

    if ($row.find('th').length > 0) return;

    const $horseName = $row.find(
      '.HorseName a, .HorseInfo .HorseName a, td a[href*="/horse/"]',
    ).first();

    if (!$horseName.length) return;

    const rowClass = $row.attr('class') || '';
    const rowText = $row.text();
    const excluded =
      /\bCancel\b/.test(rowClass) ||
      /\bJogai\b/.test(rowClass) ||
      rowText.includes('除外');

    const horse = {
      frameNumber: extractFrameNumber($row),
      horseNumber: extractHorseNumber($row),
      name: $horseName.text().trim(),
      url: $horseName.attr('href'),
      horseId: extractHorseId($horseName.attr('href')),
      age: extractAge($row, $),
      weight: extractWeight($row, $),
      odds: extractOdds($row, $),
      placeOddsMin: null,
      popularity: extractPopularity($row, $),
      jockey: extractJockey($row),
      trainer: extractTrainer($row),
      excluded,
    };

    if (horse.name && horse.name !== '') {
      horses.push(horse);
    }
  });

  const postTime = extractShutubaPostTimeText($);
  return {
    raceInfo,
    horses,
    totalHorses: horses.length,
    scrapedAt: new Date().toISOString(),
    method: 'puppeteer',
    ...(postTime ? { oddsOfficialTime: postTime } : {}),
  };
}

/**
 * レース情報の抽出
 */
function extractRaceInfo($) {
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
function extractFrameNumber($row) {
  const frameElement = $row.find('[class*="Waku"], td.waku').first();
  if (frameElement.length) {
    return frameElement.text().trim();
  }

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
function extractHorseNumber($row) {
  const horseNumElement = $row.find('[class*="Umaban"], td.umaban').first();
  if (horseNumElement.length) {
    return horseNumElement.text().trim();
  }

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
function extractAge($row, $) {
  const ageElement = $row.find('.Barei, td.barei').first();
  if (ageElement.length) {
    return ageElement.text().trim();
  }

  const ageTd = $row.find('td').filter((i, el) => {
    const text = $(el).text().trim();
    return /^[牡牝セ][0-9]+$/.test(text);
  }).first();

  return ageTd.text().trim() || 'N/A';
}

/**
 * 斤量の抽出
 */
function extractWeight($row, $) {
  const weightElement = $row.find('.Futan, td.futan').first();
  if (weightElement.length) {
    return weightElement.text().trim();
  }

  const weightTd = $row.find('td').filter((i, el) => {
    const text = $(el).text().trim();
    return /^\d+(\.\d+)?$/.test(text) && parseFloat(text) >= 48 && parseFloat(text) <= 65;
  }).first();

  return weightTd.text().trim() || 'N/A';
}

/**
 * オッズの抽出
 */
function extractOdds($row, $) {
  const oddsElement = $row.find(
    'span[id^="odds-1_"], td.Txt_R.Popular span[id^="odds-"]',
  ).first();
  let oddsText = oddsElement.text().trim();
  if (!oddsText || oddsText === '---.-' || oddsText === '**') {
    oddsText = $row.find('td.Popular.Txt_R').first().text().trim();
  }
  return oddsText && oddsText !== '---.-' && oddsText !== '**' && oddsText !== ''
    ? oddsText
    : 'N/A';
}

/**
 * 人気の抽出
 */
function extractPopularity($row, $) {
  const popularityElement = $row.find(
    'span[id^="ninki-1_"], [id^="ninki-"], .Popular_Ninki span, td.ninki',
  ).first();
  let popularityText = popularityElement.text().trim().replace(/^\(|\)$/g, '');
  if (!popularityText || popularityText === '**') {
    popularityText = $row.find('td.Popular.Txt_C').first().text().trim();
  }
  return popularityText && popularityText !== '**' && popularityText !== ''
    ? popularityText
    : 'N/A';
}

/**
 * 騎手情報の抽出
 */
function extractJockey($row) {
  const jockeyElement = $row.find(
    '.Jockey a, td.jockey a, a[href*="/jockey/"]',
  ).first();
  return jockeyElement.text().trim() || 'N/A';
}

/**
 * 調教師情報の抽出
 */
function extractTrainer($row) {
  const trainerElement = $row.find(
    '.Trainer a, td.trainer a, a[href*="/trainer/"]',
  ).first();
  return trainerElement.text().trim() || 'N/A';
}

/**
 * 馬IDの抽出
 */
function extractHorseId(url) {
  if (!url) return null;
  const match = url.match(/horse\/(\d+)/);
  return match ? match[1] : null;
}
