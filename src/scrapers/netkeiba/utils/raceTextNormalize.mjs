/**
 * Cheerio の .text() が要素境界で入れる改行・連続空白を、Discord 表示向けに1行へ整える。
 */
export function normalizeRaceScrapedText(s) {
  if (s == null) return '';
  const t = String(s).replace(/\u00a0/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * RaceData02 などで「本賞金:」以降が続く場合、コース行と賞金行に分ける。
 * @returns {{ course: string, prizeMoney: string | null }} prizeMoney は「本賞金:金額…」形式
 */
export function splitCourseAndPrize(courseNormalized) {
  const s = typeof courseNormalized === 'string' ? courseNormalized.trim() : '';
  if (!s) return { course: 'N/A', prizeMoney: null };
  const re = /本賞金[:：]\s*/;
  const m = s.match(re);
  if (!m || m.index == null) return { course: s, prizeMoney: null };
  const course = s.slice(0, m.index).trim();
  const after = s.slice(m.index + m[0].length).trim();
  if (!after) return { course: s, prizeMoney: null };
  return {
    course: course || 'N/A',
    prizeMoney: `本賞金:${after}`,
  };
}

/**
 * 出馬表 HTML から発走（表示）時刻を抜く。JRA オッズ API が無い・NAR でも DB の oddsOfficialTime に載せる。
 * @param {import('cheerio').CheerioAPI} $
 * @returns {string | null} `H:MM` / `HH:MM`（履歴側の HH:MM パース用）
 */
function compactHmFromMatch(m) {
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return `${m[1]}:${m[2]}`;
}

/**
 * @param {string} text
 * @param {{ timeBeforeSlash?: boolean }} [opts] RaceData01 専用: 文字コードが化けても `16:45…/` を拾う（NAR）
 * @returns {string | null}
 */
function postTimeFromRaceDataText(text, opts = {}) {
  const s = normalizeRaceScrapedText(text);
  if (!s) return null;
  /** 地方（NAR）: `16:45発走 /ダ1400m` */
  let m = s.match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*発走/);
  let out = compactHmFromMatch(m);
  if (out) return out;
  /** 中央（JRA）: `発走 15:40` など */
  m = s.match(/発走\s*[:：]?\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
  out = compactHmFromMatch(m);
  if (out) return out;
  /**
   * NAR の RaceData01 は SJIS 等のとき「発走」が化ける。`16:45` とコース区切りの `/` の間に時刻以外が少ない。
   */
  if (opts.timeBeforeSlash) {
    m = s.match(/(\d{1,2})\s*[:：]\s*(\d{2})(?=[^\n/／]{0,48}[/／])/);
    out = compactHmFromMatch(m);
    if (out) return out;
  }
  return null;
}

export function extractShutubaPostTimeText($) {
  const rd01 = $('.RaceData01').first().text();
  const from01 = postTimeFromRaceDataText(rd01, { timeBeforeSlash: true });
  if (from01) return from01;

  const chunks = [];
  const selectors = [
    '[class*="RaceData"]',
    '.DisplayRace_Info',
    '.RaceList_Itemtime',
    '.race_time',
  ];
  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const t = normalizeRaceScrapedText($(el).text());
      if (t && t !== 'N/A') chunks.push(t);
    });
  }
  const hay = chunks.join(' ');
  const fromHay = postTimeFromRaceDataText(hay);
  if (fromHay) return fromHay;

  const item = $('.RaceList_Itemtime').first().text();
  const itemNorm = normalizeRaceScrapedText(item);
  const fromItem = itemNorm.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  const itemHm = compactHmFromMatch(fromItem);
  if (itemHm) return itemHm;

  const loose = hay.match(/(?:^|[\s(（])(\d{1,2})\s*[:：]\s*(\d{2})(?=[\s)）/／]|$)/);
  if (loose) {
    const h = parseInt(loose[1], 10);
    const mi = parseInt(loose[2], 10);
    if (h >= 6 && h <= 22 && mi >= 0 && mi <= 59) {
      return `${loose[1]}:${loose[2]}`;
    }
  }
  return null;
}