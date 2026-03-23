import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMOJIS_JSON = join(__dirname, '../../../assets/emojis.json');

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
  'textdelete',
  'check',
];

function loadBotingEmojiMap() {
  const raw = readFileSync(EMOJIS_JSON, 'utf8');
  const data = JSON.parse(raw);
  /** @type {Record<string, { id: string; name: string }>} */
  const map = { ...(data?.boting || {}) };
  for (const k of Object.keys(map)) {
    const e = map[k];
    if (e?.id != null && e?.name != null) {
      map[k] = { id: String(e.id), name: String(e.name) };
    }
  }
  for (const k of REQUIRED_KEYS) {
    if (!map[k]?.id || !map[k]?.name) {
      throw new Error(
        `src/assets/emojis.json: missing or invalid boting.${k} (see botingEmojis.mjs)`,
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
