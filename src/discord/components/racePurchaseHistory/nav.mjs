import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { t } from '../../../i18n/index.mjs';
import { botingEmoji } from '../../utils/boting/botingEmojis.mjs';
import {
  historyCtxSuffix,
  RACE_HISTORY_DAY_PREFIX,
  RACE_HISTORY_MEETING_PREFIX,
  RACE_HISTORY_PAGE_PREFIX,
} from './ids.mjs';

/** すべて + 開催は最大 25 オプション（Discord String Select の上限） */
const HISTORY_MEETING_SELECT_MAX_VENUES = 24;

/**
 * セレクト用に開催一覧を切り詰めつつ、現在の絞り込みキーは必ず含める
 * @param {{ key: string, label: string }[]} meetings
 * @param {string} filterKey
 */
function meetingsForHistorySelect(meetings, filterKey) {
  if (meetings.length <= HISTORY_MEETING_SELECT_MAX_VENUES) return meetings;
  const out = [];
  const seen = new Set();
  if (filterKey !== 'all') {
    const cur = meetings.find((m) => m.key === filterKey);
    if (cur) {
      out.push(cur);
      seen.add(cur.key);
    }
  }
  for (const m of meetings) {
    if (out.length >= HISTORY_MEETING_SELECT_MAX_VENUES) break;
    if (seen.has(m.key)) continue;
    out.push(m);
    seen.add(m.key);
  }
  return out;
}

/**
 * 前の日・次の日・前へ・次へを 1 行に並べる（ページが 1 枚だけのときは前へ・次へは出さない）
 * @param {string} periodKey YYYYMMDD
 * @param {string} meetingFilter
 * @param {string | null} prevYmd
 * @param {string | null} nextYmd
 * @param {number} page
 * @param {number} totalPages
 * @param {string | null} [locale] `ja` / `en`（未指定は環境の既定言語）
 */
export function historyDayAndPageNavRow(
  periodKey,
  meetingFilter,
  prevYmd,
  nextYmd,
  page,
  totalPages,
  bpRankProfileUserId = null,
  rankLeaderboardReturn = null,
  locale = null,
) {
  const mf = String(meetingFilter || 'all').trim() || 'all';
  const sfx = historyCtxSuffix(bpRankProfileUserId, rankLeaderboardReturn);
  const dayId = (ymd) =>
    `${RACE_HISTORY_DAY_PREFIX}|${ymd}|0|${mf}${sfx}`;
  /** 無効時も custom_id は行内で一意（Discord は重複を拒否） */
  const disabledPrevId = `${RACE_HISTORY_DAY_PREFIX}|${periodKey}|0|${mf}|_${sfx}`;
  const disabledNextId = `${RACE_HISTORY_DAY_PREFIX}|${periodKey}|0|${mf}|__${sfx}`;

  const navId = (pg) =>
    `${RACE_HISTORY_PAGE_PREFIX}|${periodKey}|${pg}|${mf}${sfx}`;
  const showPageNav = totalPages > 1;
  const safePage = Math.min(Math.max(0, Number(page) || 0), Math.max(0, totalPages - 1));

  const components = [
    new ButtonBuilder()
      .setCustomId(prevYmd ? dayId(prevYmd) : disabledPrevId)
      .setLabel(t('race_purchase_history.nav.prev_day', null, locale))
      .setEmoji(botingEmoji('mae'))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(prevYmd == null),
    new ButtonBuilder()
      .setCustomId(nextYmd ? dayId(nextYmd) : disabledNextId)
      .setLabel(t('race_purchase_history.nav.next_day', null, locale))
      .setEmoji(botingEmoji('tsugi'))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(nextYmd == null),
  ];
  if (showPageNav) {
    components.push(
      new ButtonBuilder()
        .setCustomId(navId(Math.max(0, safePage - 1)))
        .setLabel(t('race_purchase_history.nav.prev_page', null, locale))
        .setEmoji(botingEmoji('mae'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 0),
      new ButtonBuilder()
        .setCustomId(navId(Math.min(totalPages - 1, safePage + 1)))
        .setLabel(t('race_purchase_history.nav.next_page', null, locale))
        .setEmoji(botingEmoji('tsugi'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= totalPages - 1),
    );
  }
  return new ActionRowBuilder().addComponents(...components);
}

/**
 * 開催場フィルタ（1 行の String Select。Action Row 消費を抑え 5 行制限に掛かりにくくする）
 * @param {{ periodKey: string, meetingFilter: string, meetings: { key: string, label: string }[] }} opts
 * @returns {import('discord.js').ActionRowBuilder | null}
 */
export function historyMeetingFilterRow({
  periodKey,
  meetingFilter,
  meetings,
  bpRankProfileUserId = null,
  rankLeaderboardReturn = null,
  locale = null,
}) {
  if (meetings.length < 2) return null;

  const mf = String(meetingFilter || 'all').trim() || 'all';
  const sfx = historyCtxSuffix(bpRankProfileUserId, rankLeaderboardReturn);
  const customId = `${RACE_HISTORY_MEETING_PREFIX}|${periodKey}${sfx}`;

  const listed = meetingsForHistorySelect(meetings, mf);
  const opts = [
    new StringSelectMenuOptionBuilder()
      .setLabel(t('race_purchase_history.select.all_meetings', null, locale))
      .setValue('all')
      .setDefault(mf === 'all'),
  ];
  for (const m of listed) {
    opts.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(m.label || m.key)
        .setValue(m.key)
        .setDefault(mf === m.key),
    );
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(t('race_purchase_history.select.meeting_placeholder', null, locale))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(opts);

  return new ActionRowBuilder().addComponents(menu);
}

/** 開催場メニューに載せる最大件数（Discord 上限に合わせた定数）。本文脚注などと揃える用 */
export function historyMeetingSelectMaxVenues() {
  return HISTORY_MEETING_SELECT_MAX_VENUES;
}
