import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const LANG_DIR = join(REPO_ROOT, 'lang');

/** フォールバック言語（翻訳欠損時・未対応コード時） */
export const DEFAULT_LOCALE = 'ja';

const SUPPORTED = new Set(['ja', 'en']);

const bundleCache = new Map();

/**
 * @param {string | null | undefined} code
 * @returns {'ja' | 'en'}
 */
export function normalizeLocale(code) {
  const raw = String(code || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (!raw) return DEFAULT_LOCALE;
  if (raw === 'ja' || raw.startsWith('ja-')) return 'ja';
  if (raw === 'en' || raw.startsWith('en-')) return 'en';
  return DEFAULT_LOCALE;
}

/**
 * `BOT_LOCALE` があれば全員その言語。未設定なら Discord クライアントの言語（`interaction.locale`）。
 * @param {import('discord.js').BaseInteraction | null | undefined} interaction
 * @returns {'ja' | 'en'}
 */
export function resolveLocaleFromInteraction(interaction) {
  const forced = process.env.BOT_LOCALE?.trim();
  if (forced) return normalizeLocale(forced);
  return normalizeLocale(interaction?.locale);
}

/**
 * 環境だけ参照（インタラクションが無い箇所用）。`BOT_LOCALE` が無ければ `ja`。
 * @returns {'ja' | 'en'}
 */
export function getDefaultLocale() {
  return normalizeLocale(process.env.BOT_LOCALE);
}

/**
 * @param {'ja' | 'en'} locale
 * @returns {Record<string, Record<string, unknown>>}
 */
function readBundle(locale) {
  const dir = join(LANG_DIR, locale);
  if (!existsSync(dir)) {
    if (locale !== DEFAULT_LOCALE) return readBundle(DEFAULT_LOCALE);
    return {};
  }
  const merged = {};
  for (const name of readdirSync(dir)) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const ns = name.replace(/\.ya?ml$/i, '');
    const path = join(dir, name);
    try {
      const text = readFileSync(path, 'utf8');
      const parsed = YAML.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        merged[ns] = parsed;
      }
    } catch (e) {
      console.error(`[i18n] skip broken locale file ${path}:`, e?.message ?? e);
    }
  }
  return merged;
}

/**
 * @param {'ja' | 'en'} locale
 */
export function loadLocaleBundle(locale) {
  const loc = normalizeLocale(locale);
  if (bundleCache.has(loc)) return bundleCache.get(loc);
  const data = readBundle(loc);
  bundleCache.set(loc, data);
  return data;
}

export function clearLocaleBundleCache() {
  bundleCache.clear();
}

/**
 * @param {Record<string, Record<string, unknown>>} bundle
 * @param {string} dotted path under namespace e.g. "nav.prev_day"
 */
function getNested(bundle, dotted) {
  const parts = dotted.split('.').filter(Boolean);
  let cur = bundle;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * `foo.bar.baz` のようにドットを含む名前空間（例: `bp_rank.profile_detail.yml`）に対応する。
 * 束内に存在する最長のプレフィックスを名前空間として採用する。
 * @param {Record<string, Record<string, unknown>>} root
 * @param {string} fullKey `ns.path.in.yaml`
 */
function resolveInBundle(root, fullKey) {
  const parts = fullKey.split('.').filter(Boolean);
  if (parts.length < 2) return undefined;
  for (let i = parts.length - 1; i >= 1; i--) {
    const ns = parts.slice(0, i).join('.');
    const path = parts.slice(i).join('.');
    if (!path || root[ns] == null) continue;
    const raw = getNested(root[ns], path);
    if (raw !== undefined) return raw;
  }
  return undefined;
}

/**
 * @param {string} key `YAMLファイル名（拡張子なし・ドット可）.キー` 例: `common.menu_back`, `bp_rank.profile_detail.detail.title`
 * @param {Record<string, string | number | null | undefined> | null} [vars] `{{name}}` 置換
 * @param {string | null} [locale] `null` なら `getDefaultLocale()`
 */
export function t(key, vars = null, locale = null) {
  const loc = locale != null ? normalizeLocale(locale) : getDefaultLocale();
  if (!key.includes('.')) return key;
  const bundle = loadLocaleBundle(loc);
  let raw = resolveInBundle(bundle, key);
  if (raw === undefined && loc !== DEFAULT_LOCALE) {
    const fb = loadLocaleBundle(DEFAULT_LOCALE);
    raw = resolveInBundle(fb, key);
  }
  let str =
    raw === undefined || raw === null
      ? key
      : typeof raw === 'string'
        ? raw
        : String(raw);
  if (vars && typeof vars === 'object') {
    str = str.replace(/\{\{(\w+)\}\}/g, (_, name) => {
      const v = vars[name];
      return v === undefined || v === null ? `{{${name}}}` : String(v);
    });
  }
  return str;
}
