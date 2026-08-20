import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { openSqliteDatabase } from './sqliteAsync.mjs';

const DEFAULT_RACE_CARD_TTL_MS = 45_000;
const DEFAULT_RACE_RESULT_TTL_MS = 35_000;

function resolveRaceDataCachePath() {
  const p = process.env.NETKEIBA_RACE_DATA_CACHE_SQLITE_PATH;
  if (p) return isAbsolute(p) ? p : resolve(process.cwd(), p);
  return resolve(process.cwd(), 'data', 'cache', 'netkeibaRaceData.sqlite');
}

const storagePath = resolveRaceDataCachePath();
mkdirSync(dirname(storagePath), { recursive: true });

const db = openSqliteDatabase(storagePath);
let initPromise = null;

function nowIso() {
  return new Date().toISOString();
}

async function ensureRaceDataCacheDatabase() {
  if (!initPromise) {
    initPromise = (async () => {
      await db.run('PRAGMA journal_mode = WAL');
      await db.run('PRAGMA busy_timeout = 5000');
      await db.run(`
        CREATE TABLE IF NOT EXISTS raceScrapeSnapshots (
          cacheKey TEXT PRIMARY KEY,
          dataType TEXT NOT NULL,
          source TEXT,
          raceId TEXT NOT NULL,
          payloadJson TEXT NOT NULL,
          fetchedAt TEXT NOT NULL,
          expiresAt INTEGER NOT NULL
        )
      `);
      await db.run(`
        CREATE INDEX IF NOT EXISTS idxRaceScrapeSnapshotsLookup
        ON raceScrapeSnapshots(dataType, raceId, source)
      `);
    })();
  }
  return initPromise;
}

function ttlForDataType(dataType, ttlMs) {
  if (Number.isFinite(Number(ttlMs))) return Math.max(0, Math.trunc(Number(ttlMs)));
  return dataType === 'raceResult' ? DEFAULT_RACE_RESULT_TTL_MS : DEFAULT_RACE_CARD_TTL_MS;
}

export function raceDataCacheKey(dataType, raceId, variant = '') {
  return `${dataType}:${raceId}:${variant}`;
}

export async function readRaceScrapeSnapshot(cacheKey) {
  await ensureRaceDataCacheDatabase();
  const row = await db.get(
    'SELECT payloadJson, fetchedAt, expiresAt FROM raceScrapeSnapshots WHERE cacheKey = ?',
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

export async function writeRaceScrapeSnapshot({
  cacheKey,
  dataType,
  source = null,
  raceId,
  payload,
  ttlMs,
}) {
  await ensureRaceDataCacheDatabase();
  const fetchedAt = nowIso();
  const expiresAt = Date.now() + ttlForDataType(dataType, ttlMs);
  await db.run(
    `
      INSERT INTO raceScrapeSnapshots (
        cacheKey,
        dataType,
        source,
        raceId,
        payloadJson,
        fetchedAt,
        expiresAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cacheKey) DO UPDATE SET
        dataType = excluded.dataType,
        source = excluded.source,
        raceId = excluded.raceId,
        payloadJson = excluded.payloadJson,
        fetchedAt = excluded.fetchedAt,
        expiresAt = excluded.expiresAt
    `,
    [
      cacheKey,
      dataType,
      source,
      String(raceId),
      JSON.stringify(payload),
      fetchedAt,
      expiresAt,
    ],
  );
  return readRaceScrapeSnapshot(cacheKey);
}

export async function readThroughRaceDataCache(meta, factory) {
  const hit = await readRaceScrapeSnapshot(meta.cacheKey);
  if (hit) return hit.payload;

  const payload = await factory();
  const stored = await writeRaceScrapeSnapshot({
    ...meta,
    source: payload?.netkeibaOrigin ?? meta.source ?? null,
    payload,
  });
  return stored?.payload ?? payload;
}
