import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {Map<string, { id: string, name: string }> | null} */
let wakuUmaMap = null;
/** @type {{ id: string, name: string } | null} */
let jogaiEmojiCache = null;

function loadEmojiTxt() {
  if (wakuUmaMap) return;
  wakuUmaMap = new Map();
  const path = join(__dirname, '../../emoji.txt');
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const jogaiLine = trimmed.match(/^除外\s+<:(\w+):(\d+)>/);
    if (jogaiLine) {
      jogaiEmojiCache = { name: jogaiLine[1], id: jogaiLine[2] };
      continue;
    }

    const combo = trimmed.match(/^(\d+)枠(\d+)番\s+<:(\w+):(\d+)>/);
    if (combo) {
      const w = parseInt(combo[1], 10);
      const u = parseInt(combo[2], 10);
      wakuUmaMap.set(`${w}|${u}`, { name: combo[3], id: combo[4] });
    }
  }
}

/**
 * String Select の .setEmoji() 用（[discord.js guide](https://discordjs.guide/legacy/interactive-components/select-menus)）
 * @param {string | number | undefined} frameNumber
 * @param {string | number | undefined} horseNumber
 * @returns {{ id: string, name: string } | null}
 */
/**
 * String Select の .setEmoji() 用（除外馬）
 * @returns {{ id: string, name: string } | null}
 */
export function jogaiEmojiResolvable() {
  loadEmojiTxt();
  return jogaiEmojiCache;
}

/** @returns {string | null} `<:jogai:id>` */
export function jogaiEmoji() {
  const r = jogaiEmojiResolvable();
  return r ? `<:${r.name}:${r.id}>` : null;
}

export function wakuUmaEmojiResolvable(frameNumber, horseNumber) {
  loadEmojiTxt();
  if (!wakuUmaMap?.size) return null;
  const w = parseInt(String(frameNumber).replace(/\D/g, ''), 10);
  const u = parseInt(String(horseNumber).replace(/\D/g, ''), 10);
  if (!Number.isFinite(w) || !Number.isFinite(u)) return null;
  const e = wakuUmaMap.get(`${w}|${u}`);
  return e ? { id: e.id, name: e.name } : null;
}

/**
 * @param {string | number | undefined} frameNumber
 * @param {string | number | undefined} horseNumber
 * @returns {string | null} メッセージ・Embed 用 `<:name:id>`
 */
export function wakuUmaEmoji(frameNumber, horseNumber) {
  const r = wakuUmaEmojiResolvable(frameNumber, horseNumber);
  return r ? `<:${r.name}:${r.id}>` : null;
}

/**
 * 馬番だけの並び（払戻など）を、出馬表から枠を引いて絵文字化
 * @param {string[]} nums
 * @param {string} joiner
 * @param {Map<string, string>} horseNumToFrame 馬番文字列 → 枠番文字列
 */
function normalizeUmaKey(n) {
  const d = parseInt(String(n).replace(/\D/g, ''), 10);
  return Number.isFinite(d) ? String(d) : String(n);
}

export function formatNumsWithWakuUmaEmoji(nums, joiner, horseNumToFrame) {
  if (!nums?.length) return '—';
  const sep = joiner === '>' ? ' > ' : ' - ';
  const parts = nums.map((n) => {
    const key = normalizeUmaKey(n);
    const frame = horseNumToFrame.get(key);
    const em = frame != null ? wakuUmaEmoji(frame, n) : null;
    return em ?? String(n);
  });
  return parts.join(sep);
}

/**
 * 枠連の払戻（数字は枠番）。各 n について n枠n番の絵文字を使う（例: 4-5 → 4枠4番 + 5枠5番）
 * @param {string[]} nums
 * @param {string} joiner
 */
export function formatWakurenNumsWithEmoji(nums, joiner) {
  if (!nums?.length) return '—';
  const sep = joiner === '>' ? ' > ' : ' - ';
  const parts = nums.map((n) => {
    const w = parseInt(String(n).replace(/\D/g, ''), 10);
    if (!Number.isFinite(w)) return String(n);
    return wakuUmaEmoji(w, w) ?? String(n);
  });
  return parts.join(sep);
}

/**
 * 枠連の並びをカンマ区切り（買い目一覧用）
 * @param {string[]} nums 枠番
 */
export function formatWakurenNumsCommaEmoji(nums) {
  if (!nums?.length) return '—';
  const parts = nums.map((n) => {
    const w = parseInt(String(n).replace(/\D/g, ''), 10);
    if (!Number.isFinite(w)) return String(n);
    return wakuUmaEmoji(w, w) ?? String(n);
  });
  return parts.join(', ');
}

/**
 * 馬番の並びをカンマ区切り（買い目一覧用）
 * @param {string[]} nums
 * @param {Record<string, string>|Map<string, string>} horseNumToFrame
 */
export function formatHorseNumsCommaEmoji(nums, horseNumToFrame) {
  if (!nums?.length) return '—';
  const map =
    horseNumToFrame instanceof Map
      ? horseNumToFrame
      : new Map(Object.entries(horseNumToFrame || {}));
  const parts = nums.map((n) => {
    const key = normalizeUmaKey(n);
    const frame = map.get(key);
    const em = frame != null ? wakuUmaEmoji(frame, n) : null;
    return em ?? String(n);
  });
  return parts.join(', ');
}

/** Discord String Select の option.label 上限 */
export const DISCORD_SELECT_OPTION_LABEL_MAX = 100;

/** raceSchedule の buildSelectionRow が後から付ける「（選択中）」用の余白 */
export const DISCORD_SELECT_OPTION_LABEL_RESERVE_POST_SELECTION =
  DISCORD_SELECT_OPTION_LABEL_MAX - '（選択中）'.length;

/**
 * 馬選択メニュー用ラベル（絵文字は .setEmoji に任せ、ここはテキストのみ）
 * @param {{ frameNumber?: string|number, horseNumber?: string|number, name?: string }} horse
 * @param {string} [suffix] 例: '（選択中）'（betFlow はここに含める）
 * @param {number} [maxTotal] 既定100。後から選択中が付くオプションは {@link DISCORD_SELECT_OPTION_LABEL_RESERVE_POST_SELECTION}
 */
export function selectHorseLabel(horse, suffix = '', maxTotal = DISCORD_SELECT_OPTION_LABEL_MAX) {
  const suf = suffix || '';
  const num = String(horse.horseNumber ?? '');
  const name = String(horse.name || '');
  const hasEmoji = !!wakuUmaEmojiResolvable(horse.frameNumber, horse.horseNumber);
  const prefix = hasEmoji ? '' : `${num}. `;
  const budget = maxTotal - prefix.length - suf.length;
  if (budget < 1) return `${prefix}${suf}`.slice(0, maxTotal);
  let shownName = name || (hasEmoji ? '—' : '不明');
  if (shownName.length > budget) shownName = `${shownName.slice(0, Math.max(0, budget - 1))}…`;
  return `${prefix}${shownName}${suf}`;
}

/**
 * 枠選択メニュー用ラベル（絵文字は .setEmoji に任せる）
 * @param {string|number} frame
 * @param {string} [suffix]
 * @param {number} [maxTotal]
 */
export function selectFrameLabel(frame, suffix = '', maxTotal = DISCORD_SELECT_OPTION_LABEL_MAX) {
  const suf = suffix || '';
  const base = `枠${frame}`;
  const out = `${base}${suf}`;
  if (out.length <= maxTotal) return out;
  return `${base}${suf}`.slice(0, maxTotal);
}
