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