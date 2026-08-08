import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { openSqliteDatabase } from './sqliteAsync.mjs';

const DEFAULT_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const MIN_REFRESH_INTERVAL_MS = 15 * 1000;
const MAX_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

function resolveScheduleCachePath() {
  const p = process.env.NETKEIBA_SCHEDULE_CACHE_SQLITE_PATH;
  if (p) return isAbsolute(p) ? p : resolve(process.cwd(), p);
  return resolve(process.cwd(), 'data', 'cache', 'netkeibaSchedule.sqlite');
}

const storagePath = resolveScheduleCachePath();
mkdirSync(dirname(storagePath), { recursive: true });

const db = openSqliteDatabase(storagePath);
let initPromise = null;

function nowIso() {
  return new Date().toISOString();
}

function clampRefreshIntervalMs(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_REFRESH_INTERVAL_MS;
  return Math.min(MAX_REFRESH_INTERVAL_MS, Math.max(MIN_REFRESH_INTERVAL_MS, n));
}

async function ensureScheduleCacheDatabase() {
  if (!initPromise) {
    initPromise = (async () => {
      await db.run('PRAGMA journal_mode = WAL');
      await db.run('PRAGMA busy_timeout = 5000');
      await db.run(`
        CREATE TABLE IF NOT EXISTS cacheSettings (
          key TEXT PRIMARY KEY,
          valueJson TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        )
      `);
      await db.run(`
        CREATE TABLE IF NOT EXISTS scheduleSnapshots (
          cacheKey TEXT PRIMARY KEY,
          dataType TEXT NOT NULL,
          source TEXT NOT NULL,
          kaisaiDateYmd TEXT,
          currentGroup TEXT,
          kaisaiId TEXT,
          payloadJson TEXT NOT NULL,
          fetchedAt TEXT NOT NULL,
          expiresAt INTEGER NOT NULL
        )
      `);
      await db.run(`
        CREATE INDEX IF NOT EXISTS idxScheduleSnapshotsLookup
        ON scheduleSnapshots(source, dataType, kaisaiDateYmd, currentGroup, kaisaiId)
      `);
    })();
  }
  return initPromise;
}

async function readSetting(key) {
  await ensureScheduleCacheDatabase();
  const row = await db.get('SELECT valueJson FROM cacheSettings WHERE key = ?', [key]);
  if (!row) return null;
  try {
    return JSON.parse(row.valueJson);
  } catch {
    return null;
  }
}

async function writeSetting(key, value) {
  await ensureScheduleCacheDatabase();
  await db.run(
    `
      INSERT INTO cacheSettings (key, valueJson, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        valueJson = excluded.valueJson,
        updatedAt = excluded.updatedAt
    `,
    [key, JSON.stringify(value), nowIso()],
  );
}

export async function getScheduleCacheConfig() {
  const saved = await readSetting('scheduleCacheConfig');
  return {
    refreshIntervalMs: clampRefreshIntervalMs(
      saved?.refreshIntervalMs ?? process.env.NETKEIBA_SCHEDULE_REFRESH_MS,
    ),
  };
}

export async function setScheduleCacheRefreshIntervalMs(refreshIntervalMs) {
  const next = {
    refreshIntervalMs: clampRefreshIntervalMs(refreshIntervalMs),
  };
  await writeSetting('scheduleCacheConfig', next);
  return next;
}

export function formatScheduleCacheRefreshInterval(refreshIntervalMs) {
  const ms = clampRefreshIntervalMs(refreshIntervalMs);
  if (ms % 60_000 === 0) return `${ms / 60_000}分`;
  if (ms % 1000 === 0) return `${ms / 1000}秒`;
  return `${ms}ms`;
}

export async function readScheduleSnapshot(cacheKey) {
  await ensureScheduleCacheDatabase();
  const row = await db.get(
    'SELECT payloadJson, fetchedAt, expiresAt FROM scheduleSnapshots WHERE cacheKey = ?',
    [cacheKey],
  );
  if (!row || Number(row.expiresAt) <= Date.now()) return null;
  try {
    return {
      payload: JSON.parse(row.payloadJson),
      fetchedAt: row.fetchedAt,
      expiresAt: Number(row.expiresAt),
    };
  } catch {
    return null;
  }
}

export async function writeScheduleSnapshot({
  cacheKey,
  dataType,
  source,
  kaisaiDateYmd = null,
  currentGroup = null,
  kaisaiId = null,
  payload,
  refreshIntervalMs,
}) {
  await ensureScheduleCacheDatabase();
  const fetchedAt = nowIso();
  const expiresAt = Date.now() + clampRefreshIntervalMs(refreshIntervalMs);
  await db.run(
    `
      INSERT INTO scheduleSnapshots (
        cacheKey,
        dataType,
        source,
        kaisaiDateYmd,
        currentGroup,
        kaisaiId,
        payloadJson,
        fetchedAt,
        expiresAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cacheKey) DO UPDATE SET
        dataType = excluded.dataType,
        source = excluded.source,
        kaisaiDateYmd = excluded.kaisaiDateYmd,
        currentGroup = excluded.currentGroup,
        kaisaiId = excluded.kaisaiId,
        payloadJson = excluded.payloadJson,
        fetchedAt = excluded.fetchedAt,
        expiresAt = excluded.expiresAt
    `,
    [
      cacheKey,
      dataType,
      source,
      kaisaiDateYmd,
      currentGroup,
      kaisaiId,
      JSON.stringify(payload),
      fetchedAt,
      expiresAt,
    ],
  );
}

export async function readThroughScheduleCache(meta, factory) {
  const config = await getScheduleCacheConfig();
  const hit = await readScheduleSnapshot(meta.cacheKey);
  if (hit) return hit.payload;
  const payload = await factory();
  await writeScheduleSnapshot({
    ...meta,
    payload,
    refreshIntervalMs: config.refreshIntervalMs,
  });
  return payload;
}
