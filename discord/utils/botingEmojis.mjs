import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMOJI_FILE = join(__dirname, '../../emoji.txt');

const REQUIRED_KEYS = [
  'cart',
  'daily',
  'history',
  'home',
  'modoru',
  'ranking',
  'susumu',
  'syushi',
  'ken',
  'mae',
  'tsugi',
  'henko',
  'hyouji',
  'plus',
  'delete',
  'profile',
  'kakunin',
  'kakutei',
];

function loadBotingEmojiMap() {
  const text = readFileSync(EMOJI_FILE, 'utf8');
  /** @type {Record<string, { id: string; name: string }>} */
  const map = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^boting_(\w+)\s+<:(\w+):(\d+)>/);
    if (m) map[m[1]] = { id: m[3], name: m[2] };
  }
  for (const k of REQUIRED_KEYS) {
    if (!map[k]) {
      throw new Error(
        `emoji.txt: missing line "boting_${k} <:name:id>" (see botingEmojis.mjs)`,
      );
    }
  }
  return map;
}

/** @type {Record<string, { id: string; name: string }>} */
export const BOTING_EMOJI = loadBotingEmojiMap();

/**
 * Discord ボタン用カスタム絵文字（`ButtonBuilder#setEmoji`）
 * @param {keyof typeof BOTING_EMOJI} key
 * @returns {{ id: string; name: string }}
 */
export function botingEmoji(key) {
  const e = BOTING_EMOJI[key];
  if (!e) throw new Error(`Unknown boting emoji key: ${key}`);
  return { id: e.id, name: e.name };
}
