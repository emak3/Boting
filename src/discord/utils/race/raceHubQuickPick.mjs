import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import {
  getRaceSalesStatus,
  getRaceBettingCloseDeadlineMs,
} from '../../../scrapers/netkeiba/netkeibaSchedule.mjs';
import { normalizeScheduleVenueDisplayName } from '../netkeiba/netkeibaJraVenueCode.mjs';
import { t } from '../../../i18n/index.mjs';

export const RACE_MENU_HUB_QUICK_ID = 'race_menu_hub_quick';

/** 開催場選択 Container に付ける案内（クイックメニューがあるときだけ） */
export function venueQuickPickBodySuffix(locale = null) {
  return `\n\n${t('race_schedule.lines.venue_quick_pick_hint', null, locale)}`;
}

const QUICK_PICK_LIMIT = 6;

/**
 * @param {string} raw
 * @returns {{ raceId: string, isResult: boolean, venue: { source: 'jra'|'nar', kaisaiDate: string, currentGroup: string | null, kaisaiId: string } } | null}
 */
export function parseHubQuickSelectValue(raw) {
  const parts = String(raw || '').split('|');
  if (parts.length !== 7 || parts[0] !== 'hq') return null;
  const [, raceId, isRes, source, kaisaiDate, cg, kaisaiId] = parts;
  if (!/^\d{12}$/.test(raceId)) return null;
  if (isRes !== '0' && isRes !== '1') return null;
  if (source !== 'jra' && source !== 'nar') return null;
  if (!/^\d{8}$/.test(kaisaiDate)) return null;
  if (!kaisaiId || !/^\d+$/.test(kaisaiId)) return null;
  if (source === 'jra') {
    if (!cg || cg === '_') return null;
    return {
      raceId,
      isResult: isRes === '1',
      venue: { source: 'jra', kaisaiDate, currentGroup: cg, kaisaiId },
    };
  }
  if (cg !== '_') return null;
  return {
    raceId,
    isResult: isRes === '1',
    venue: { source: 'nar', kaisaiDate, currentGroup: null, kaisaiId },
  };
}

function encodeQuickPickValue(item) {
  const cg = item.source === 'nar' ? '_' : String(item.currentGroup ?? '');
  return `hq|${item.race.raceId}|${item.race.isResult ? 1 : 0}|${item.source}|${item.kaisaiDateYmd}|${cg}|${item.kaisaiId}`;
}

/**
 * 既に取得済みの開催場一覧から、発売中のみ・締切が近い順に最大6件（JRA または NAR のどちらか一方）。
 * @param {{
 *   venuesDay: Array<{ title?: string, kaisaiId: string, races: object[] }>,
 *   kaisaiDateYmd: string,
 *   source: 'jra'|'nar',
 *   currentGroup: string | null,
 *   now?: Date,
 * }} opts
 */
export function buildQuickPickItemsFromScheduleVenues(opts) {
  const {
    venuesDay,
    kaisaiDateYmd,
    source,
    currentGroup,
    now = new Date(),
  } = opts;

  /** @type {Array<{ race: object, kaisaiDateYmd: string, source: 'jra'|'nar', currentGroup: string | null, kaisaiId: string, venueTitle: string, sortKey: number }>} */
  const items = [];

  for (const v of venuesDay || []) {
    const venueTitle = normalizeScheduleVenueDisplayName(
      (v.title || '').replace(/\s+/g, ' ').trim(),
    );
    for (const r of v.races || []) {
      const st = getRaceSalesStatus(r, kaisaiDateYmd, now);
      if (st.closed) continue;
      const closeMs = getRaceBettingCloseDeadlineMs(r, kaisaiDateYmd);
      items.push({
        race: r,
        kaisaiDateYmd,
        source,
        currentGroup: source === 'jra' ? currentGroup : null,
        kaisaiId: v.kaisaiId,
        venueTitle,
        sortKey: closeMs ?? Number.MAX_SAFE_INTEGER,
      });
    }
  }

  items.sort((a, b) => a.sortKey - b.sortKey);
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (seen.has(it.race.raceId)) continue;
    seen.add(it.race.raceId);
    out.push(it);
    if (out.length >= QUICK_PICK_LIMIT) break;
  }
  return out;
}

/**
 * @param {ReturnType<typeof buildQuickPickItemsFromScheduleVenues>} items
 * @returns {import('discord.js').ActionRowBuilder | null}
 */
export function buildHubQuickRacesSelectRow(items) {
  if (!items?.length) return null;
  const nowMs = Date.now();
  const menu = new StringSelectMenuBuilder()
    .setCustomId(RACE_MENU_HUB_QUICK_ID)
    .setPlaceholder('締切が近い発売中レースを選んで出馬表へ')
    .addOptions(
      items.map((it) => {
        const vshort = (it.venueTitle || '場').replace(/\s+/g, ' ').trim().slice(0, 14);
        const label = `${vshort} ${it.race.roundLabel} ${it.race.timeText}`
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100);
        let desc = it.race.title.replace(/\s+/g, ' ').trim().slice(0, 80);
        const closeMs = getRaceBettingCloseDeadlineMs(it.race, it.kaisaiDateYmd);
        if (closeMs != null && closeMs > nowMs) {
          const min = Math.max(1, Math.ceil((closeMs - nowMs) / 60_000));
          const tail = ` · 締切まで約${min}分`;
          desc = (desc + tail).slice(0, 100);
        }
        return new StringSelectMenuOptionBuilder()
          .setLabel(label || it.race.raceId)
          .setValue(encodeQuickPickValue(it))
          .setDescription(desc || '—');
      }),
    );
  return new ActionRowBuilder().addComponents(menu);
}
