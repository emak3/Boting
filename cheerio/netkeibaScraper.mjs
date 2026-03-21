import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { handleEncoding } from './utils/encoding.mjs';
import { scrapWithPuppeteer } from './utils/puppeteerFallback.mjs';

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
    '.Shutuba_Table.ShutubaTable:not(.PredictRap_Table) tr.HorseList, .Shutuba_Table.RaceTable01.ShutubaTable:not(.PredictRap_Table) tr[id^="tr_"]';

  /**
   * メインの出馬表データ取得メソッド
   */
  async scrapeRaceCard(raceId) {
    const url = `${this.baseUrl}/race/shutuba.html?race_id=${raceId}`;
    
    try {
      // まずCheerioでの取得を試行
      const result = await this.scrapeWithCheerio(url);
      if (result && result.horses.length > 0) {
        await this.mergeJraOddsFromApi(raceId, result);
        return result;
      }
      
      // Cheerioで失敗した場合はPuppeteerを使用
      console.log('Cheerio approach failed, falling back to Puppeteer...');
      const puppetResult = await this.scrapeWithPuppeteer(url);
      await this.mergeJraOddsFromApi(raceId, puppetResult);
      return puppetResult;
      
    } catch (error) {
      console.error('Error scraping race card:', error);
      throw new Error(`Failed to scrape race data: ${error.message}`);
    }
  }

  /**
   * Cheerioを使用したスクレイピング
   */
  async scrapeWithCheerio(url) {
    try {
      const response = await axios.get(url, {
        headers: this.headers,
        responseType: 'arraybuffer',
        timeout: 10000,
        maxRedirects: 5,
      });

      // レスポンスオブジェクトも渡してエンコーディングを適切に処理
      const decodedData = handleEncoding(response.data, response);
      const $ = cheerio.load(decodedData);

      // メインテーブルの確認
      const mainTable = $('.ShutubaTable, .RaceTable01, .Shutuba_Table').first();
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
      title: $('.RaceName, .race_name, h1.raceTitle').first().text().trim() || 'レース情報',
      date: $('.RaceData01, .race_date, .raceData01').first().text().trim() || 'N/A',
      course: $('.RaceData02, .course_info, .raceData02').first().text().trim() || 'N/A',
      class: $('.RaceData03, .race_class, .raceData03').first().text().trim() || 'N/A',
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
    const oddsText = oddsElement.text().trim();
    return oddsText && oddsText !== '---.-' && oddsText !== '**' && oddsText !== '' ? oddsText : 'N/A';
  }

  /**
   * 人気の抽出
   */
  extractPopularity($row, $) {
    const popularityElement = $row.find('span[id^="ninki-1_"], [id^="ninki-"], .Popular_Ninki span, td.ninki').first();
    let popularityText = popularityElement.text().trim().replace(/^\(|\)$/g, '');
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