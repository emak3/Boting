import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import NetkeibaScraper from '../../../scrapers/netkeiba/netkeibaScraper.mjs';
import {
  fetchRaceListSub,
  parseRaceListSub,
  filterVenueRaces,
  getRaceSalesStatus,
  findRaceMetaForToday,
  fetchNarRaceListSub,
  parseNarRaceListSubToVenue,
  fetchVenuesAndRacesForJstYmd,
  fetchNarVenuesForDate,
  jstYmd,
  filterRacesByInteractionPostDateYmd,
  filterVenuesForInteractionPostDate,
} from '../../../scrapers/netkeiba/netkeibaSchedule.mjs';
import { netkeibaResultUrl, netkeibaOriginFromFlow } from '../../utils/netkeiba/netkeibaUrls.mjs';
import { normalizeScheduleVenueDisplayName } from '../../utils/netkeiba/netkeibaJraVenueCode.mjs';
import {
  buildRaceCardV2Payload,
  buildRaceResultV2Payload,
  buildTextAndRowsV2Payload,
} from '../../utils/race/raceCardDisplay.mjs';
import {
  canBypassSalesClosed,
  isDebugSalesBypassEnabled,
} from '../../utils/debug/raceDebugBypass.mjs';
import {
  selectHorseLabel,
  selectFrameLabel,
  wakuUmaEmoji,
  jogaiEmoji,
  wakuUmaEmojiResolvable,
  DISCORD_SELECT_OPTION_LABEL_RESERVE_POST_SELECTION,
} from '../../utils/race/raceNumberEmoji.mjs';
import {
  raceSalesStatusShortLabel,
  raceSalesStatusDetailLabel,
} from '../../utils/race/raceSalesStatusLabels.mjs';
import { msgRaceBetFlowSessionInvalid } from '../../utils/bet/betFlowSessionCopy.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';
import {
  betTypesLabeled,
  pairModesLabeled,
  umatanModesLabeled,
  trifukuModesLabeled,
  tritanModesLabeled,
  betTypeLabel,
} from '../../utils/bet/betFlowLabels.mjs';
import { getBetFlow, setBetFlow, patchBetFlow, clearBetFlow } from '../../utils/bet/betFlowStore.mjs';
import { getSlipSavedCount } from '../../utils/bet/betSlipStore.mjs';
import {
  BET_SLIP_OPEN_CUSTOM_ID,
  RACE_PURCHASE_HISTORY_CUSTOM_ID,
  betSlipOpenReviewButtonRowForSchedule,
  firstScheduleAnchorRaceIdFromRaces,
  firstScheduleAnchorRaceIdFromVenues,
} from '../../utils/bet/betSlipViewUi.mjs';
import {
  applyJraMultiMarkerToSelectionLine,
  stripJraMultiMarkerFromSelectionLine,
  formatSlipPickDisplayLines,
} from '../../utils/bet/betPurchaseEmbed.mjs';
import { horseNumToFrameFromResult } from '../../utils/bet/betSlipOpenReview.mjs';
import { botingEmoji } from '../../utils/boting/botingEmojis.mjs';
import {
  buildMenuRowFromCustomId,
  buildBetTypeMenuRow,
} from '../button/betFlowButtons.mjs';
import {
  SCHEDULE_KIND_MENU_ID,
  scheduleBackToKindSelectButtonRow,
} from '../../utils/race/scheduleKindUi.mjs';
import {
  filterBetTypesForJraSale,
  isJraBetTypeAllowedForFlow,
  frameAllowsWakurenSamePair,
} from '../../utils/jra/jraBetAvailability.mjs';
import {
  buildPayoutTicketsFromFlow,
  jraMultiEligibleLastMenu,
} from '../../utils/race/raceBetTickets.mjs';
import { settleOpenRaceBetsForUser } from '../../utils/race/raceBetRecords.mjs';
import { buildVenuePickIntroV2Payload } from '../../utils/race/raceCommandHub.mjs';
import {
  raceResultFlagStore,
  venueSelectionStore,
} from '../../utils/race/venueSelectionStore.mjs';
import {
  RACE_MENU_HUB_QUICK_ID,
  parseHubQuickSelectValue,
  buildQuickPickItemsFromScheduleVenues,
  buildHubQuickRacesSelectRow,
  venueQuickPickBodySuffix,
} from '../../utils/race/raceHubQuickPick.mjs';
import { formatBpAmount } from '../../utils/bp/bpFormat.mjs';
import { v2ExtraFlags } from '../../utils/shared/interactionResponse.mjs';

const VENUE_MENU_ID = 'race_menu_venue';
const RACE_MENU_ID = 'race_menu_race';

function raceCardPayload(interaction, opts) {
  const rid = opts.result?.raceId;
  const uid = interaction.user?.id;
  const loc = opts.locale ?? resolveLocaleFromInteraction(interaction);
  const utilityContext =
    uid && rid && /^\d{12}$/.test(String(rid))
      ? { userId: uid, flow: getBetFlow(uid, String(rid)) }
      : null;
  return buildRaceCardV2Payload({
    ...opts,
    locale: loc,
    utilityContext,
  });
}

const BET_TYPE_MENU_PREFIX = 'race_bet_type|'; // raceId is appended after |
const BET_PREFIX = 'race_bet_';
/** 買い目まとめ確認用（betSlipMenu.mjs で処理。ここではベットフロー扱いしない） */
const BET_SLIP_MENU_PREFIX = 'race_bet_slip_';

// ===== Bet points / total estimate =====
// 1点あたりの金額はベットフローごとに編集可能
const DEFAULT_UNIT_YEN = 100;

function formatBetPoints(points, unitYen = DEFAULT_UNIT_YEN, locale = null) {
  const yen = points * unitYen;
  return t(
    'race_schedule.format.bet_points',
    {
      points: formatBpAmount(points),
      yen: formatBpAmount(yen),
      unit: formatBpAmount(unitYen),
    },
    locale,
  );
}

/** @param {string} key `bet_flow.placeholders` のキー */
function ph(key, locale = null) {
  return t(`bet_flow.placeholders.${key}`, null, locale);
}

function uniqValues(arr) {
  return Array.from(new Set((arr || []).map((v) => String(v))));
}

function calcComb2(n) {
  return n >= 2 ? (n * (n - 1)) / 2 : 0;
}

function calcComb3(n) {
  return n >= 3 ? (n * (n - 1) * (n - 2)) / 6 : 0;
}

function distinctCountExcluding(arr, excludeArr) {
  const ex = new Set((excludeArr || []).map((v) => String(v)));
  const s = new Set((arr || []).map((v) => String(v)).filter((v) => !ex.has(v)));
  return s.size;
}

// 枠連/馬連/ワイド(順不同の2頭) : A×B を全組み合わせし、(a,b) を重複なしカウント
function countUniquePairsUnordered(a, b) {
  const A = uniqValues(a);
  const B = uniqValues(b);
  const set = new Set();
  for (const x of A) {
    for (const y of B) {
      if (x === y) continue;
      const [m1, m2] = x < y ? [x, y] : [y, x];
      set.add(`${m1}|${m2}`);
    }
  }
  return set.size;
}

/** 枠連フォーメーション: 同枠同士は当該枠が2頭以上のときのみ1点として数える */
function countFramePairFormationPoints(picksA, picksB, result) {
  const horses = result?.horses || [];
  const A = uniqValues(picksA);
  const B = uniqValues(picksB);
  const set = new Set();
  for (const x of A) {
    for (const y of B) {
      if (x === y) {
        if (frameAllowsWakurenSamePair(horses, x)) set.add(`${x}|${x}`);
        continue;
      }
      const [m1, m2] = x < y ? [x, y] : [y, x];
      set.add(`${m1}|${m2}`);
    }
  }
  return set.size;
}

/** 枠連ボックス: 異枠の組み合わせ + 選択枠ごとに同枠同士が可能なら+1 */
function countFramePairBoxPoints(picks, result) {
  const uniq = uniqValues(picks);
  let n = calcComb2(uniq.length);
  const horses = result?.horses || [];
  for (const f of uniq) {
    if (frameAllowsWakurenSamePair(horses, f)) n += 1;
  }
  return n;
}

/** 枠連ながし: 軸と同じ枠を相手に選んだときは同枠同士が可能な場合のみ1点 */
function countFramePairNagashiPoints(axis, opponents, result) {
  const opp = uniqValues(opponents);
  const horses = result?.horses || [];
  let pts = 0;
  for (const o of opp) {
    if (o === axis) {
      if (frameAllowsWakurenSamePair(horses, o)) pts += 1;
    } else {
      pts += 1;
    }
  }
  return pts;
}

// 馬単(順番ありの2頭) : A(1着)×B(2着) で同一値は除外してカウント
function countCrossDistinctPairs(a, b) {
  const A = uniqValues(a);
  const B = uniqValues(b);
  let count = 0;
  for (const x of A) {
    for (const y of B) {
      if (x === y) continue;
      count += 1;
    }
  }
  return count;
}

// 3連複(順不同の3頭) : A×B×C から重複なしでカウント（同一値を除外）
function countUniqueTriplesUnordered(a, b, c) {
  const A = uniqValues(a);
  const B = uniqValues(b);
  const C = uniqValues(c);
  const set = new Set();
  for (const x of A) {
    for (const y of B) {
      for (const z of C) {
        if (x === y || x === z || y === z) continue;
        const sorted = [x, y, z].slice().sort((p, q) => Number(p) - Number(q));
        set.add(sorted.join('|'));
      }
    }
  }
  return set.size;
}

// 3連単(順番ありの3頭) : A(1着)×B(2着)×C(3着) で同一値を除外してカウント
function countOrderedTriplesDistinct(a, b, c) {
  const A = uniqValues(a);
  const B = uniqValues(b);
  const C = uniqValues(c);
  let count = 0;
  for (const x of A) {
    for (const y of B) {
      for (const z of C) {
        if (x === y || x === z || y === z) continue;
        count += 1;
      }
    }
  }
  return count;
}

function raceSelectRow(kaisaiDateYmd, races, locale = null) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(RACE_MENU_ID)
    .setPlaceholder(t('race_schedule.placeholders.pick_race', null, locale))
    .addOptions(
      races.slice(0, 25).map((r) => {
        const st = getRaceSalesStatus(r, kaisaiDateYmd);
        const label = `${r.roundLabel} ${r.timeText}`.replace(/\s+/g, ' ').trim().slice(0, 100);
        const desc = `${raceSalesStatusShortLabel(st, locale)} · ${r.title}`.slice(0, 100);
        return new StringSelectMenuOptionBuilder()
          .setLabel(label || r.raceId)
          // RACE_MENU_ID 側で「確定/発売前」を判定するため、isResult を一緒に渡す
          .setValue(`${r.raceId}|${r.isResult ? 1 : 0}`)
          .setDescription(desc);
      }),
    );
  return new ActionRowBuilder().addComponents(menu);
}

function scheduleBackToVenueButtonRow(kaisaiDateYmd, currentGroup, scheduleKind = 'jra', locale = null) {
  const pad = scheduleKind === 'nar' ? '_' : currentGroup;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_sched_back_to_venue|${scheduleKind}|${kaisaiDateYmd}|${pad}`)
      .setLabel(t('race_schedule.buttons.to_venue', null, locale))
      .setStyle(ButtonStyle.Secondary),
  );
}

function venueSelectRowFromSchedule(scheduleKind, kaisaiDate, currentGroup, venues, locale = null) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(VENUE_MENU_ID)
    .setPlaceholder(t('race_schedule.placeholders.pick_venue', null, locale))
    .addOptions(
      venues.slice(0, 25).map((v) => {
        const value =
          scheduleKind === 'nar'
            ? `nar|${kaisaiDate}|${v.kaisaiId}`
            : `jra|${kaisaiDate}|${currentGroup}|${v.kaisaiId}`;
        const prefix =
          scheduleKind === 'nar' ? t('race_schedule.venue.nar_prefix', null, locale) : '';
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${prefix}${v.title}`.slice(0, 100))
          .setValue(value)
          .setDescription(
            t('race_schedule.venue.race_count', { n: v.races.length }, locale).slice(0, 100),
          );
      }),
    );
  return new ActionRowBuilder().addComponents(menu);
}

function scheduleBackToRaceListButtonRow(raceId, locale = null) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_sched_back_to_race_list|${raceId}`)
      .setLabel(t('bet_flow.nav.to_race_list', null, locale))
      .setStyle(ButtonStyle.Secondary),
  );
}

/** /race 経由で開催情報があるときだけ、レース一覧に戻る行を付ける（メニューの下に並べる） */
function scheduleRaceListBackIfScheduled(userId, raceId, locale = null) {
  const f = getBetFlow(userId, raceId);
  if (!f?.kaisaiDate || !f?.kaisaiId) return null;
  if (f.source === 'nar') return scheduleBackToRaceListButtonRow(raceId, locale);
  if (f.currentGroup != null && String(f.currentGroup).length > 0) {
    return scheduleBackToRaceListButtonRow(raceId, locale);
  }
  return null;
}

function betTypeSelectRow(raceId, selectedBetTypeId = null, flow = null, locale = null) {
  const types = filterBetTypesForJraSale(betTypesLabeled(locale), {
    source: flow?.source,
    result: flow?.result,
  });
  const selRaw = selectedBetTypeId != null ? String(selectedBetTypeId) : null;
  const sel = selRaw && types.some((x) => x.id === selRaw) ? selRaw : null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${BET_TYPE_MENU_PREFIX}${raceId}`)
    .setPlaceholder(t('bet_flow.placeholders.choose_bet_style', null, locale))
    .addOptions(
      types.map((x) => {
        const o = new StringSelectMenuOptionBuilder()
          .setLabel(x.label)
          .setValue(x.id)
          .setDescription(t('bet_flow.descriptions.after_bet_type', null, locale));
        if (sel && x.id === sel) o.setDefault(true);
        return o;
      }),
    );
  return new ActionRowBuilder().addComponents(menu);
}

function buildSelectionRow({
  customId,
  placeholder,
  options,
  minValues,
  maxValues,
  defaultValues,
  selectedValues,
}) {
  const defaultSet = new Set(
    (defaultValues?.length ? defaultValues : selectedValues || []).map((v) =>
      String(v),
    ),
  );

  const mappedOptions = (options || []).map((opt) => {
    const json = typeof opt?.toJSON === 'function' ? opt.toJSON() : null;
    if (!json) return opt;
    const value = String(json.value);
    const builder = new StringSelectMenuOptionBuilder()
      .setLabel(json.label)
      .setValue(value);
    if (json.description) builder.setDescription(json.description);
    if (json.emoji?.id) builder.setEmoji(json.emoji);
    if (defaultSet.has(value)) builder.setDefault(true);
    return builder;
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(minValues)
    .setMaxValues(maxValues)
    .addOptions(mappedOptions);

  return new ActionRowBuilder().addComponents(menu);
}

/** 購入サマリー下部: 1行目 金額変更・購入予定に追加・購入履歴 / 2行目 購入予定・(マルチ)・購入予定をクリア。その下に戻る・レース一覧 */
function summaryPurchaseButtonRows(raceId, userId, backMenuIndex, flow = null, locale = null) {
  const savedN = getSlipSavedCount(userId);
  const hasCurrent = !!(flow?.purchase?.selectionLine);
  const batchTotal = savedN + (hasCurrent ? 1 : 0);
  const lastMenuId = flow?.purchase?.lastMenuCustomId;
  const jraMultiRow = !!(lastMenuId && jraMultiEligibleLastMenu(lastMenuId));
  const jraMultiOn = flow?.jraMulti === true;

  const cartClearBtn = new ButtonBuilder()
    .setCustomId(`race_bet_cart_clear|${raceId}`)
    .setLabel(t('race_schedule.buttons.clear_cart', null, locale))
    .setEmoji(botingEmoji('delete'))
    .setStyle(ButtonStyle.Danger)
    .setDisabled(savedN === 0);

  const slipOpenBtn = new ButtonBuilder()
    .setCustomId(`${BET_SLIP_OPEN_CUSTOM_ID}|${raceId}`)
    .setLabel(
      batchTotal
        ? t('race_schedule.buttons.cart_with_count', { n: batchTotal }, locale)
        : t('race_schedule.buttons.cart', null, locale),
    )
    .setEmoji(botingEmoji('cart'))
    .setStyle(ButtonStyle.Primary);

  const multiBtn = new ButtonBuilder()
    .setCustomId(`race_bet_jra_multi_toggle|${raceId}`)
    .setLabel(
      jraMultiOn
        ? t('race_schedule.buttons.multi_on', null, locale)
        : t('race_schedule.buttons.multi_off', null, locale),
    )
    .setStyle(jraMultiOn ? ButtonStyle.Success : ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_bet_unit_edit|${raceId}`)
      .setLabel(t('race_schedule.buttons.unit_edit', null, locale))
      .setEmoji(botingEmoji('henko'))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`race_bet_add_to_cart|${raceId}`)
      .setLabel(t('race_schedule.buttons.add_to_cart', null, locale))
      .setEmoji(botingEmoji('plus'))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${RACE_PURCHASE_HISTORY_CUSTOM_ID}|${raceId}`)
      .setLabel(t('race_schedule.buttons.purchase_history', null, locale))
      .setEmoji(botingEmoji('history'))
      .setStyle(ButtonStyle.Secondary),
  );

  const rows = [row1];
  if (jraMultiRow) {
    rows.push(
      new ActionRowBuilder().addComponents(slipOpenBtn, multiBtn, cartClearBtn),
    );
  } else {
    rows.push(new ActionRowBuilder().addComponents(slipOpenBtn, cartClearBtn));
  }
  const br = backButtonRow(raceId, backMenuIndex, locale);
  if (br) rows.push(br);
  const sched = scheduleRaceListBackIfScheduled(userId, raceId, locale);
  if (sched) rows.push(sched);
  return rows;
}

function backButtonRow(raceId, backMenuIndex, locale = null) {
  const idx = Number(backMenuIndex);
  if (!Number.isFinite(idx) || idx < 1) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_bet_back|${raceId}`)
      .setLabel(t('bet_flow.nav.back', null, locale))
      .setEmoji(botingEmoji('modoru'))
      .setStyle(ButtonStyle.Secondary),
  );
}

/** 馬番（枠番）選択段階で race_bet_back が1段戻れるよう backMenuIds を更新 */
function setupHorseStepBack(userId, raceId, betType, lastMenuCustomId) {
  const flow = getBetFlow(userId, raceId) || {};
  const backMenuIds = computeBackMenuIds({
    raceId,
    flow,
    betType,
    lastMenuCustomId,
  });
  const backMenuIndex = backMenuIds.lastIndexOf(lastMenuCustomId);
  patchBetFlow(userId, raceId, {
    backMenuIds,
    backMenuIndex: backMenuIndex >= 0 ? backMenuIndex : backMenuIds.length - 1,
  });
  return backMenuIndex >= 0 ? backMenuIndex : backMenuIds.length - 1;
}

/** 現在表示中のメニューまでの経路に切り詰め（末尾を上書きすると lastIndexOf が壊れるのを防ぐ） */
function finalizeBackMenuIds(ids, lastMenuCustomId) {
  if (!lastMenuCustomId) return ids;
  const i = ids.indexOf(lastMenuCustomId);
  if (i >= 0) return ids.slice(0, i + 1);
  return [...ids, lastMenuCustomId];
}

/** race_bet_* セレクトの customId から raceId（2番目のセグメント）を取る */
function raceIdFromBetFlowSelectCustomId(customId) {
  const parts = String(customId).split('|');
  if (parts.length < 2) return null;
  const rid = parts[1];
  return /^\d{12}$/.test(rid) ? rid : null;
}

function inferTritanModeFromCustomId(lastMenuCustomId) {
  if (!lastMenuCustomId) return null;
  const kind = String(lastMenuCustomId).split('|')[0];
  // 文字列の完全一致が外れるケースがあるため「含む」判定で堅くする
  if (kind.includes('_normal_')) return 'normal';
  if (kind.includes('_nagashi1_')) return 'nagashi1';
  if (kind.includes('_nagashi2_')) return 'nagashi2';
  if (kind.includes('_nagashi3_')) return 'nagashi3';
  if (kind.includes('_n12_')) return 'nagashi12';
  if (kind.includes('_n13_')) return 'nagashi13';
  if (kind.includes('_n23_')) return 'nagashi23';
  if (kind === 'race_bet_tritan_box') return 'box';
  if (kind.includes('_form')) return 'formation';
  return null;
}

function computeBackMenuIds({ raceId, flow, betType, lastMenuCustomId }) {
  const betTypeMenuId = `race_bet_type|${raceId}`;
  const ids = [betTypeMenuId];

  if (betType === 'win' || betType === 'place' || betType === 'win_place') {
    ids.push(`race_bet_single_pick|${raceId}|${betType}`);
    return finalizeBackMenuIds(ids, lastMenuCustomId);
  }

  if (betType === 'frame_pair' || betType === 'horse_pair' || betType === 'wide') {
    const mode = flow?.pairMode;
    ids.push(`race_bet_pair_mode|${raceId}|${betType}`);
    if (mode === 'normal') {
      if (betType === 'frame_pair') {
        ids.push(`race_bet_frame_pair_normal_first|${raceId}`);
        ids.push(`race_bet_frame_pair_normal_second|${raceId}`);
      } else {
        ids.push(`race_bet_pair_normal|${raceId}|${betType}`);
      }
    } else if (mode === 'nagashi') {
      ids.push(`race_bet_pair_nagashi_axis|${raceId}|${betType}`);
      ids.push(`race_bet_pair_nagashi_opponent|${raceId}|${betType}`);
    } else if (mode === 'box') {
      ids.push(`race_bet_pair_box|${raceId}|${betType}`);
    } else if (mode === 'formation') {
      ids.push(`race_bet_pair_formA|${raceId}|${betType}`);
      ids.push(`race_bet_pair_formB|${raceId}|${betType}`);
    }
    return finalizeBackMenuIds(ids, lastMenuCustomId);
  }

  if (betType === 'umatan') {
    const mode = flow?.umatanMode;
    ids.push(`race_bet_umatan_mode|${raceId}`);
    if (mode === 'normal') {
      ids.push(`race_bet_umatan_normal_1|${raceId}`);
      ids.push(`race_bet_umatan_normal_2|${raceId}`);
    } else if (mode === 'nagashi1') {
      ids.push(`race_bet_umatan_nagashi1_axis|${raceId}`);
      ids.push(`race_bet_umatan_nagashi1_opp|${raceId}`);
    } else if (mode === 'nagashi2') {
      ids.push(`race_bet_umatan_nagashi2_axis|${raceId}`);
      ids.push(`race_bet_umatan_nagashi2_opp|${raceId}`);
    } else if (mode === 'box') {
      ids.push(`race_bet_umatan_box|${raceId}`);
    } else if (mode === 'formation') {
      ids.push(`race_bet_umatan_formA|${raceId}`);
      ids.push(`race_bet_umatan_formB|${raceId}`);
    }
    return finalizeBackMenuIds(ids, lastMenuCustomId);
  }

  if (betType === 'trifuku') {
    const mode = flow?.trifukuMode;
    ids.push(`race_bet_trifuku_mode|${raceId}`);
    if (mode === 'normal') {
      ids.push(`race_bet_trifuku_normal|${raceId}`);
    } else if (mode === 'nagashi1') {
      ids.push(`race_bet_trifuku_n1_axis|${raceId}`);
      ids.push(`race_bet_trifuku_n1_opp|${raceId}`);
    } else if (mode === 'nagashi2') {
      ids.push(`race_bet_trifuku_n2_axis|${raceId}`);
      ids.push(`race_bet_trifuku_n2_opp|${raceId}`);
    } else if (mode === 'box') {
      ids.push(`race_bet_trifuku_box|${raceId}`);
    } else if (mode === 'formation') {
      ids.push(`race_bet_trifuku_formA|${raceId}`);
      ids.push(`race_bet_trifuku_formB|${raceId}`);
      ids.push(`race_bet_trifuku_formC|${raceId}`);
    }
    return finalizeBackMenuIds(ids, lastMenuCustomId);
  }

  if (betType === 'tritan') {
    // flow 側のモードがズレることがあるため、lastMenuCustomId から段階を推定する
    const mode =
      inferTritanModeFromCustomId(lastMenuCustomId) ?? flow?.tritanMode;
    ids.push(`race_bet_tritan_mode|${raceId}`);
    if (mode === 'normal') {
      ids.push(`race_bet_tritan_normal_1|${raceId}`);
      ids.push(`race_bet_tritan_normal_2|${raceId}`);
      ids.push(`race_bet_tritan_normal_3|${raceId}`);
    } else if (mode === 'nagashi1') {
      ids.push(`race_bet_tritan_nagashi1_axis|${raceId}`);
      ids.push(`race_bet_tritan_nagashi1_opp|${raceId}`);
    } else if (mode === 'nagashi2') {
      ids.push(`race_bet_tritan_nagashi2_axis|${raceId}`);
      ids.push(`race_bet_tritan_nagashi2_opp|${raceId}`);
    } else if (mode === 'nagashi3') {
      ids.push(`race_bet_tritan_nagashi3_axis|${raceId}`);
      ids.push(`race_bet_tritan_nagashi3_opp|${raceId}`);
    } else if (mode === 'nagashi12') {
      ids.push(`race_bet_tritan_n12_a1|${raceId}`);
      ids.push(`race_bet_tritan_n12_a2|${raceId}`);
      ids.push(`race_bet_tritan_n12_opp3|${raceId}`);
    } else if (mode === 'nagashi13') {
      ids.push(`race_bet_tritan_n13_a1|${raceId}`);
      ids.push(`race_bet_tritan_n13_a3|${raceId}`);
      ids.push(`race_bet_tritan_n13_opp2|${raceId}`);
    } else if (mode === 'nagashi23') {
      ids.push(`race_bet_tritan_n23_a2|${raceId}`);
      ids.push(`race_bet_tritan_n23_a3|${raceId}`);
      ids.push(`race_bet_tritan_n23_opp1|${raceId}`);
    } else if (mode === 'box') {
      ids.push(`race_bet_tritan_box|${raceId}`);
    } else if (mode === 'formation') {
      ids.push(`race_bet_tritan_formA|${raceId}`);
      ids.push(`race_bet_tritan_formB|${raceId}`);
      ids.push(`race_bet_tritan_formC|${raceId}`);
    }
    return finalizeBackMenuIds(ids, lastMenuCustomId);
  }

  // フォールバック
  return finalizeBackMenuIds(ids, lastMenuCustomId);
}

/**
 * 購入サマリー画面を flow から再描画（「進む」で復帰時など）
 */
export async function editReplyPurchaseSummaryFromFlow(interaction, userId, raceId) {
  const loc = resolveLocaleFromInteraction(interaction);
  const flow = getBetFlow(userId, raceId);
  const purch = flow?.purchase;
  if (!purch?.lastMenuCustomId || !flow?.result) {
    await interaction.editReply(
      buildTextAndRowsV2Payload({
        headline: t('race_schedule.errors.summary_replay_failed', null, loc),
        actionRows: [],
        extraFlags: v2ExtraFlags(interaction),
        withBotingMenuBack: true,
        locale: loc,
      }),
    );
    return;
  }

  const result = flow.result;
  const betType = flow.betType;
  const { selectionLine: selIn, lastMenuCustomId } = purch;
  const jraMultiOn = flow.jraMulti === true;
  const selectionLineStored = applyJraMultiMarkerToSelectionLine(
    stripJraMultiMarkerFromSelectionLine(selIn),
    jraMultiOn,
  );
  const ticketsSynced = buildPayoutTicketsFromFlow(flow, raceId);
  const points = ticketsSynced.length;
  patchBetFlow(userId, raceId, {
    purchase: { ...purch, points, tickets: ticketsSynced, selectionLine: selectionLineStored },
  });
  const flowSynced = getBetFlow(userId, raceId) || flow;
  const unitYen = flowSynced.unitYen ?? DEFAULT_UNIT_YEN;
  const selectionLine = flowSynced.purchase?.selectionLine ?? selectionLineStored;

  const backMenuIds = computeBackMenuIds({
    raceId,
    flow: flowSynced,
    betType,
    lastMenuCustomId,
  });
  const backMenuIndex = backMenuIds.lastIndexOf(lastMenuCustomId);

  const isResult = !!result?.isResult;
  const origin = netkeibaOriginFromFlow(flowSynced);
  const resultUrl = isResult ? netkeibaResultUrl(raceId, origin) : null;

  const slipPick = formatSlipPickDisplayLines({
    selectionLine,
    betType: flowSynced.betType ?? betType,
    tickets: flowSynced.purchase?.tickets || [],
    horseNumToFrame: horseNumToFrameFromResult(result),
    jraMulti: flowSynced.jraMulti === true,
  });
  const parts = [];
  if (slipPick) parts.push(slipPick);
  else parts.push(selectionLine);
  const content = `${parts.join('\n')}\n${formatBetPoints(points, unitYen, loc)}${
    resultUrl
      ? t('race_schedule.lines.result_url', { url: resultUrl }, loc)
      : ''
  }`;

  const betTypeMenuId = `race_bet_type|${raceId}`;
  const summaryMenuRows = [];
  for (const menuId of backMenuIds) {
    const row =
      menuId === betTypeMenuId
        ? buildBetTypeMenuRow(raceId, flowSynced, loc)
        : buildMenuRowFromCustomId({
            menuCustomId: menuId,
            flow: flowSynced,
            result,
            locale: loc,
          });
    if (row) summaryMenuRows.push(row);
  }

  await interaction.editReply(
    buildTextAndRowsV2Payload({
      headline: content,
      actionRows: [
        ...summaryMenuRows,
        ...summaryPurchaseButtonRows(raceId, userId, backMenuIndex, flowSynced, loc),
      ].filter(Boolean),
      extraFlags: v2ExtraFlags(interaction),
      withBotingMenuBack: true,
      locale: loc,
    }),
  );
}

/**
 * 最終確定画面（式別〜最後の馬番までのメニューを表示 + 購入・戻る等）
 */
async function renderFinalSelection({
  interaction,
  userId,
  raceId,
  result,
  betType,
  selectionLine,
  points,
  flowUnitYen,
  lastMenu,
}) {
  const loc = resolveLocaleFromInteraction(interaction);
  const currentFlow = getBetFlow(userId, raceId) || {};

  const backMenuIds = computeBackMenuIds({
    raceId,
    flow: currentFlow,
    betType,
    lastMenuCustomId: lastMenu.customId,
  });
  const backMenuIndex = backMenuIds.lastIndexOf(lastMenu.customId);

  const unitYen = flowUnitYen ?? DEFAULT_UNIT_YEN;
  const jraMultiOn = currentFlow.jraMulti === true;
  const selectionLineStored = applyJraMultiMarkerToSelectionLine(
    stripJraMultiMarkerFromSelectionLine(selectionLine),
    jraMultiOn,
  );
  const nextStepSelections = {
    ...(currentFlow.stepSelections || {}),
    [lastMenu.customId]:
      lastMenu.defaultValues && lastMenu.defaultValues.length
        ? lastMenu.defaultValues.map((v) => String(v))
        : [],
  };
  const tickets = buildPayoutTicketsFromFlow(
    {
      ...currentFlow,
      betType,
      unitYen,
      stepSelections: nextStepSelections,
      purchase: {
        selectionLine: selectionLineStored,
        points,
        lastMenuCustomId: lastMenu.customId,
      },
    },
    raceId,
  );
  const pointsResolved = tickets.length;
  patchBetFlow(userId, raceId, {
    betType,
    unitYen,
    purchase: {
      selectionLine: selectionLineStored,
      points: pointsResolved,
      lastMenuCustomId: lastMenu.customId,
      tickets,
    },
    stepSelections: nextStepSelections,
    lastSelectionLine: selectionLineStored,
    backMenuIds,
    backMenuIndex: backMenuIndex >= 0 ? backMenuIndex : backMenuIds.length - 1,
    navViewMenuIndex: null,
    purchaseSnapshot: null,
  });

  const isResult = !!result?.isResult;
  const flowForOrigin = getBetFlow(userId, raceId) || {};
  const origin = netkeibaOriginFromFlow(flowForOrigin);
  const resultUrl = isResult ? netkeibaResultUrl(raceId, origin) : null;

  const flowAfter = getBetFlow(userId, raceId);
  const selStored = flowAfter?.purchase?.selectionLine ?? selectionLineStored;
  const slipPick = formatSlipPickDisplayLines({
    selectionLine: selStored,
    betType: flowAfter?.betType ?? betType,
    tickets: flowAfter?.purchase?.tickets || [],
    horseNumToFrame: horseNumToFrameFromResult(result),
    jraMulti: flowAfter?.jraMulti === true,
  });
  const parts = [];
  if (slipPick) parts.push(slipPick);
  else parts.push(selStored);
  const content = `${parts.join('\n')}\n${formatBetPoints(pointsResolved, unitYen, loc)}${
    resultUrl
      ? t('race_schedule.lines.result_url', { url: resultUrl }, loc)
      : ''
  }`;

  const betTypeMenuId = `race_bet_type|${raceId}`;
  const summaryMenuRows = [];
  for (const menuId of backMenuIds) {
    const row =
      menuId === betTypeMenuId
        ? buildBetTypeMenuRow(raceId, flowAfter, loc)
        : buildMenuRowFromCustomId({
            menuCustomId: menuId,
            flow: flowAfter,
            result,
            locale: loc,
          });
    if (row) summaryMenuRows.push(row);
  }

  await interaction.editReply(
    buildTextAndRowsV2Payload({
      headline: content,
      actionRows: [
        ...summaryMenuRows,
        ...summaryPurchaseButtonRows(raceId, userId, backMenuIndex, flowAfter, loc),
      ].filter(Boolean),
      extraFlags: v2ExtraFlags(interaction),
      withBotingMenuBack: true,
      locale: loc,
    }),
  );
}

function horseOptionsFromResult(result, cap = 25) {
  const unique = new Map(); // horseNumber -> horse
  for (const h of result.horses || []) {
    if (h.excluded) continue;
    unique.set(String(h.horseNumber), h);
  }
  const arr = Array.from(unique.entries())
    .map(([num, horse]) => ({ num, horse }))
    .sort((a, b) => Number(a.num) - Number(b.num))
    .slice(0, cap);
  return arr.map(({ num, horse }) => {
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(selectHorseLabel(horse, '', DISCORD_SELECT_OPTION_LABEL_RESERVE_POST_SELECTION))
      .setValue(num)
      .setDescription(`${horse.jockey}`.slice(0, 70));
    const em = wakuUmaEmojiResolvable(horse.frameNumber, horse.horseNumber);
    if (em) opt.setEmoji({ id: em.id, name: em.name });
    return opt;
  });
}

function frameOptionsFromResult(result, cap = 25, opts = {}, locale = null) {
  const omit = new Set((opts.omitFrames || []).map((x) => String(x)));
  const counts = new Map();
  const frameToHorses = new Map();
  for (const h of result.horses || []) {
    if (h.excluded) continue;
    const f = String(h.frameNumber);
    counts.set(f, (counts.get(f) || 0) + 1);
    if (!frameToHorses.has(f)) frameToHorses.set(f, []);
    frameToHorses.get(f).push(h);
  }
  const arr = Array.from(counts.entries())
    .map(([frame, count]) => ({ frame, count, horses: frameToHorses.get(frame) }))
    .filter(({ frame }) => !omit.has(String(frame)))
    .sort((a, b) => Number(a.frame) - Number(b.frame))
    .slice(0, cap);

  return arr.map(({ frame, count, horses }) => {
    const firstHorseName = horses?.[0]?.name || '';
    const f = parseInt(String(frame).replace(/\D/g, ''), 10);
    const desc = firstHorseName
      ? t(
          'bet_flow.frame_option.with_example',
          { count: String(count), name: firstHorseName },
          locale,
        )
      : t('bet_flow.frame_option.count_only', { count: String(count) }, locale);
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(selectFrameLabel(frame, '', DISCORD_SELECT_OPTION_LABEL_RESERVE_POST_SELECTION))
      .setValue(frame)
      .setDescription(desc.slice(0, 70));
    const em = Number.isFinite(f) ? wakuUmaEmojiResolvable(f, f) : null;
    if (em) opt.setEmoji({ id: em.id, name: em.name });
    return opt;
  });
}

/** 買い目テキスト用: 馬名は付けず枠馬絵文字または番号表記（言語依存） */
function formatNamesByNums(result, nums, locale = null) {
  const byKey = new Map();
  for (const h of result.horses || []) {
    byKey.set(String(h.horseNumber), h);
    const k = parseInt(String(h.horseNumber).replace(/\D/g, ''), 10);
    if (Number.isFinite(k)) byKey.set(String(k), h);
  }
  return nums
    .map((n) => {
      const ns = String(n);
      const kn = parseInt(ns.replace(/\D/g, ''), 10);
      const horse = byKey.get(ns) ?? (Number.isFinite(kn) ? byKey.get(String(kn)) : null);
      const em = horse?.excluded
        ? jogaiEmoji()
        : horse
          ? wakuUmaEmoji(horse.frameNumber, horse.horseNumber)
          : null;
      if (em) return em;
      return Number.isFinite(kn)
        ? t('bet_flow.display.horse_number_fallback', { n: String(kn) }, locale)
        : ns;
    })
    .join(', ');
}

/** 枠連など: 枠番は枠×枠の枠馬絵文字（名前なし）、無ければ言語依存の枠表記 */
function formatFrames(_result, frames, locale = null) {
  return frames
    .map((f) => {
      const w = parseInt(String(f).replace(/\D/g, ''), 10);
      const raw = String(f);
      if (!Number.isFinite(w)) {
        return t('bet_flow.display.frame_token_fallback', { raw }, locale);
      }
      return (
        wakuUmaEmoji(w, w) ??
        t('bet_flow.display.frame_token_fallback', { raw }, locale)
      );
    })
    .join(', ');
}

/**
 * レース一覧メニュー: 一覧キャッシュ・フォールバックから raceId のメタを解決。
 * scrapeRaceResult と Promise.all するため独立した async にしている。
 */
async function resolveScheduleMetaForRaceSelection({
  userId,
  raceId,
  isResultFlag,
  lastVenue,
}) {
  let raceMeta = null;
  let salesStatus = null;
  let metaFallback = null;
  let scheduleVenueTitle = '';
  let isResult =
    raceResultFlagStore.get(`${userId}|${raceId}`) ?? isResultFlag === '1';

  if (
    lastVenue?.kaisaiDate &&
    lastVenue?.kaisaiId &&
    (lastVenue.source === 'nar' || lastVenue.currentGroup != null)
  ) {
    try {
      if (lastVenue.source === 'nar') {
        const html = await fetchNarRaceListSub(
          lastVenue.kaisaiDate,
          lastVenue.kaisaiId,
        );
        const venue = parseNarRaceListSubToVenue(html, lastVenue.kaisaiDate);
        raceMeta = venue?.races.find((x) => x.raceId === raceId) || null;
        scheduleVenueTitle = normalizeScheduleVenueDisplayName(
          (venue?.title || '').replace(/\s+/g, ' ').trim(),
        );
      } else {
        const html = await fetchRaceListSub(
          lastVenue.kaisaiDate,
          lastVenue.currentGroup,
        );
        const { venues } = parseRaceListSub(html, lastVenue.kaisaiDate);
        scheduleVenueTitle = normalizeScheduleVenueDisplayName(
          (
            venues.find((x) => x.kaisaiId === lastVenue.kaisaiId)?.title || ''
          ).replace(/\s+/g, ' ').trim(),
        );
        const races = filterVenueRaces(venues, lastVenue.kaisaiId);
        raceMeta = races.find((x) => x.raceId === raceId) || null;
      }
      if (raceMeta) {
        isResult = !!raceMeta.isResult;
        raceResultFlagStore.set(`${userId}|${raceId}`, isResult);
        salesStatus = getRaceSalesStatus(raceMeta, lastVenue.kaisaiDate);
      }
    } catch (_) {
      /* 一覧取得失敗時は下で扱う */
    }
  }

  if (!raceMeta) {
    const meta = await findRaceMetaForToday(raceId);
    if (meta) {
      raceMeta = meta.race;
      metaFallback = meta;
      isResult = !!raceMeta.isResult;
      salesStatus = getRaceSalesStatus(raceMeta, meta.kaisaiDateYmd);
    }
  }

  return { raceMeta, metaFallback, salesStatus, scheduleVenueTitle, isResult };
}

/**
 * レース一覧メニューと同じ出馬表/結果表示ペイロード（`/debug` のレースID直開き用）
 * @param {import('discord.js').BaseInteraction} interaction
 * @param {{ raceId: string, isResultFlag: string }} opts
 */
export async function buildRaceMenuSelectionPayload(interaction, { raceId, isResultFlag }) {
  const userId = interaction.user?.id;
  const loc = resolveLocaleFromInteraction(interaction);
  const scraper = new NetkeibaScraper();
  const lastVenue = venueSelectionStore.get(userId);

  const [metaBundle, resultSnap] = await Promise.all([
    resolveScheduleMetaForRaceSelection({
      userId,
      raceId,
      isResultFlag,
      lastVenue,
    }),
    scraper.scrapeRaceResult(raceId),
  ]);

  const {
    raceMeta,
    metaFallback,
    salesStatus,
    scheduleVenueTitle,
    isResult,
  } = metaBundle;

  const preferredOrigin =
    metaFallback?.source ||
    (lastVenue?.source === 'jra' || lastVenue?.source === 'nar'
      ? lastVenue.source
      : null);

  const flowCtx = lastVenue?.kaisaiId
    ? {
        kaisaiDate: lastVenue.kaisaiDate,
        currentGroup: lastVenue.currentGroup ?? null,
        kaisaiId: lastVenue.kaisaiId,
        source: lastVenue.source ?? 'jra',
        venueTitle: scheduleVenueTitle || '',
      }
    : metaFallback?.scheduleKaisaiId
      ? {
          kaisaiDate: metaFallback.kaisaiDateYmd,
          currentGroup: metaFallback.currentGroup ?? null,
          kaisaiId: metaFallback.scheduleKaisaiId,
          source: metaFallback.source,
          venueTitle: normalizeScheduleVenueDisplayName(
            (metaFallback.venueTitle || '').replace(/\s+/g, ' ').trim(),
          ),
        }
      : {};

  const salesBypass = canBypassSalesClosed(userId);

  if (
    resultSnap.confirmed &&
    resultSnap.payoutReady === false &&
    !salesBypass
  ) {
    setBetFlow(userId, raceId, {
      ...flowCtx,
      source: flowCtx.source || resultSnap.netkeibaOrigin || 'jra',
    });
    return buildTextAndRowsV2Payload({
      headline: t('race_schedule.headlines.wait_confirm_payout', null, loc),
      actionRows: [
        flowCtx.kaisaiId ? scheduleBackToRaceListButtonRow(raceId, loc) : null,
      ].filter(Boolean),
      extraFlags: v2ExtraFlags(interaction),
      withBotingMenuBack: true,
      locale: loc,
    });
  }

  if (resultSnap.confirmed && resultSnap.payoutReady !== false) {
    let bpFooter = null;
    try {
      const pay = await settleOpenRaceBetsForUser(userId, raceId, resultSnap, {
        reconcileSettledRows: isDebugSalesBypassEnabled(),
      });
      const adj = pay.reconcileBalanceDelta || 0;
      const net = pay.totalRefund + adj;
      if (pay.settled > 0 || adj !== 0) {
        if (net > 0) {
          bpFooter = t(
            'race_schedule.bp_footer.refund_positive',
            { net: formatBpAmount(net), balance: formatBpAmount(pay.balance) },
            loc,
          );
        } else if (net < 0) {
          bpFooter = t(
            'race_schedule.bp_footer.refund_adjust',
            { net: formatBpAmount(net), balance: formatBpAmount(pay.balance) },
            loc,
          );
        } else if (pay.settled > 0) {
          bpFooter = t(
            'race_schedule.bp_footer.refund_none',
            {
              settled: String(pay.settled),
              balance: formatBpAmount(pay.balance),
            },
            loc,
          );
        }
      }
    } catch (e) {
      console.warn('settleOpenRaceBetsForUser', e);
    }
    if (!salesBypass) {
      setBetFlow(userId, raceId, {
        ...flowCtx,
        source: flowCtx.source || resultSnap.netkeibaOrigin || 'jra',
      });
      return buildRaceResultV2Payload({
        parsed: resultSnap,
        bpFooter,
        actionRows: [
          flowCtx.kaisaiId ? scheduleBackToRaceListButtonRow(raceId, loc) : null,
        ].filter(Boolean),
        extraFlags: v2ExtraFlags(interaction),
      });
    }
    // デバッグ発売バイパス ON: 結果確定でも払戻精算だけ行い、出馬表・馬券 UI へ進む
  }

  if (isResult && !salesBypass) {
    setBetFlow(userId, raceId, {
      ...flowCtx,
      source: flowCtx.source || 'jra',
    });
    return buildTextAndRowsV2Payload({
      headline: t('race_schedule.headlines.result_fetch_failed', null, loc),
      actionRows: [
        flowCtx.kaisaiId ? scheduleBackToRaceListButtonRow(raceId, loc) : null,
      ].filter(Boolean),
      extraFlags: v2ExtraFlags(interaction),
      withBotingMenuBack: true,
      locale: loc,
    });
  }

  if (salesStatus?.closed && !salesBypass) {
    setBetFlow(userId, raceId, {
      ...flowCtx,
      source: flowCtx.source || 'jra',
    });
    return buildTextAndRowsV2Payload({
      headline: t('race_schedule.headlines.sales_closed_wait', null, loc),
      actionRows: [
        flowCtx.kaisaiId ? scheduleBackToRaceListButtonRow(raceId, loc) : null,
      ].filter(Boolean),
      extraFlags: v2ExtraFlags(interaction),
      withBotingMenuBack: true,
      locale: loc,
    });
  }

  const result = await scraper.scrapeRaceCard(raceId, { preferredOrigin });
  result.isResult = false;
  result.raceId = raceId;
  setBetFlow(userId, raceId, {
    result,
    ...flowCtx,
    source: flowCtx.source || result.netkeibaOrigin || 'jra',
  });

  const flowAfter = getBetFlow(userId, raceId);
  const betTypeDefault =
    flowAfter?.stepSelections?.[`race_bet_type|${raceId}`]?.[0] ??
    flowAfter?.betType ??
    null;
  return raceCardPayload(interaction, {
    result,
    headline: '',
    actionRows: [
      betTypeSelectRow(raceId, betTypeDefault, flowAfter, loc),
      flowCtx.kaisaiId ? scheduleBackToRaceListButtonRow(raceId, loc) : null,
    ].filter(Boolean),
    extraFlags: v2ExtraFlags(interaction),
    locale: loc,
  });
}

/**
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export default async function raceScheduleMenu(interaction) {
  if (!interaction.isStringSelectMenu()) return;

  const customId = interaction.customId;
  const isScheduleBetSelect =
    customId.startsWith(BET_PREFIX) && !customId.startsWith(BET_SLIP_MENU_PREFIX);
  if (
    customId !== VENUE_MENU_ID &&
    customId !== RACE_MENU_ID &&
    customId !== RACE_MENU_HUB_QUICK_ID &&
    customId !== SCHEDULE_KIND_MENU_ID &&
    !isScheduleBetSelect
  )
    return;

  const userId = interaction.user?.id;
  const loc = resolveLocaleFromInteraction(interaction);

  // 馬券購入トップ: 締切が近い発売中レースから出馬表へ
  if (customId === RACE_MENU_HUB_QUICK_ID) {
    await interaction.deferUpdate();
    const rawVal = interaction.values[0];
    const parsed = parseHubQuickSelectValue(rawVal);
    if (!parsed || !userId) {
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: t('race_schedule.errors.hub_quick_invalid', null, loc),
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
      return;
    }
    venueSelectionStore.set(userId, parsed.venue);
    raceResultFlagStore.set(`${userId}|${parsed.raceId}`, parsed.isResult);
    try {
      const payload = await buildRaceMenuSelectionPayload(interaction, {
        raceId: parsed.raceId,
        isResultFlag: parsed.isResult ? '1' : '0',
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error(e);
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: t('race_schedule.errors.card_fetch_failed', { message: e.message }, loc),
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
    }
    return;
  }

  // 0) /race 直後: 中央 / 地方
  if (customId === SCHEDULE_KIND_MENU_ID) {
    await interaction.deferUpdate();
    const kind = interaction.values[0];
    try {
      const interactionYmd = jstYmd();
      if (kind === 'jra') {
        const jraFetched = await fetchVenuesAndRacesForJstYmd(interactionYmd);
        const { venues, kaisaiDateYmd, currentGroup, noTabForDate } = jraFetched;
        const venuesDay = filterVenuesForInteractionPostDate(
          venues,
          kaisaiDateYmd,
          interactionYmd,
          { source: 'jra' },
        );
        if (!venuesDay.length) {
          await interaction.editReply(
            buildTextAndRowsV2Payload({
              headline: noTabForDate
                ? t('race_schedule.errors.jra_no_meeting_date', { date: interactionYmd }, loc)
                : t('race_schedule.errors.jra_no_races_post_date', null, loc),
              actionRows: [],
              extraFlags: v2ExtraFlags(interaction),
              withBotingMenuBack: true,
              locale: loc,
            }),
          );
          return;
        }
        const jraQuickItems = buildQuickPickItemsFromScheduleVenues({
          venuesDay,
          kaisaiDateYmd,
          source: 'jra',
          currentGroup,
        });
        const jraQuickRow = buildHubQuickRacesSelectRow(jraQuickItems);
        await interaction.editReply(
          await buildVenuePickIntroV2Payload({
            userId,
            extraFlags: v2ExtraFlags(interaction),
            locale: loc,
            introBodySuffix: jraQuickItems.length ? venueQuickPickBodySuffix(loc) : '',
            actionRows: [
              venueSelectRowFromSchedule('jra', kaisaiDateYmd, currentGroup, venuesDay, loc),
              ...(jraQuickRow ? [jraQuickRow] : []),
              scheduleBackToKindSelectButtonRow(loc),
              betSlipOpenReviewButtonRowForSchedule(
                userId,
                firstScheduleAnchorRaceIdFromVenues(venuesDay),
              ),
            ],
          }),
        );
        return;
      }
      if (kind === 'nar') {
        const { venues, kaisaiDateYmd } = await fetchNarVenuesForDate(interactionYmd);
        const venuesDay = filterVenuesForInteractionPostDate(
          venues,
          kaisaiDateYmd,
          interactionYmd,
          { source: 'nar' },
        );
        if (!venuesDay.length) {
          await interaction.editReply(
            buildTextAndRowsV2Payload({
              headline: t('race_schedule.errors.nar_no_races_post_date', null, loc),
              actionRows: [],
              extraFlags: v2ExtraFlags(interaction),
              withBotingMenuBack: true,
              locale: loc,
            }),
          );
          return;
        }
        const narQuickItems = buildQuickPickItemsFromScheduleVenues({
          venuesDay,
          kaisaiDateYmd,
          source: 'nar',
          currentGroup: null,
        });
        const narQuickRow = buildHubQuickRacesSelectRow(narQuickItems);
        await interaction.editReply(
          await buildVenuePickIntroV2Payload({
            userId,
            extraFlags: v2ExtraFlags(interaction),
            locale: loc,
            introBodySuffix: narQuickItems.length ? venueQuickPickBodySuffix(loc) : '',
            actionRows: [
              venueSelectRowFromSchedule('nar', kaisaiDateYmd, null, venuesDay, loc),
              ...(narQuickRow ? [narQuickRow] : []),
              scheduleBackToKindSelectButtonRow(loc),
              betSlipOpenReviewButtonRowForSchedule(
                userId,
                firstScheduleAnchorRaceIdFromVenues(venuesDay),
              ),
            ],
          }),
        );
        return;
      }
    } catch (e) {
      console.error(e);
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: t('race_schedule.errors.schedule_fetch_failed', { message: e.message }, loc),
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
    }
    return;
  }

  // 1) 開催場 -> レース一覧
  if (customId === VENUE_MENU_ID) {
    await interaction.deferUpdate();
    const val = interaction.values[0];
    const parts = String(val).split('|');
    const scheduleKind = parts[0];
    let kaisaiDate;
    let currentGroup = null;
    let kaisaiId;
    if (scheduleKind === 'jra') {
      [, kaisaiDate, currentGroup, kaisaiId] = parts;
      if (!kaisaiDate || !currentGroup || !kaisaiId) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: t('race_schedule.errors.menu_invalid_boting', null, loc),
            actionRows: [],
            extraFlags: v2ExtraFlags(interaction),
            withBotingMenuBack: true,
            locale: loc,
          }),
        );
        return;
      }
      venueSelectionStore.set(userId, {
        source: 'jra',
        kaisaiDate,
        currentGroup,
        kaisaiId,
      });
    } else if (scheduleKind === 'nar') {
      [, kaisaiDate, kaisaiId] = parts;
      if (!kaisaiDate || !kaisaiId) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: t('race_schedule.errors.menu_invalid_boting', null, loc),
            actionRows: [],
            extraFlags: v2ExtraFlags(interaction),
            withBotingMenuBack: true,
            locale: loc,
          }),
        );
        return;
      }
      venueSelectionStore.set(userId, {
        source: 'nar',
        kaisaiDate,
        currentGroup: null,
        kaisaiId,
      });
    } else {
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: t('race_schedule.errors.menu_invalid_boting', null, loc),
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
      return;
    }

    try {
      const interactionYmd = jstYmd();
      let races = [];
      if (scheduleKind === 'jra') {
        const html = await fetchRaceListSub(kaisaiDate, currentGroup);
        const { venues } = parseRaceListSub(html, kaisaiDate);
        races = filterVenueRaces(venues, kaisaiId);
      } else {
        const html = await fetchNarRaceListSub(kaisaiDate, kaisaiId);
        const venue = parseNarRaceListSubToVenue(html, kaisaiDate);
        races = venue?.races || [];
      }
      races = filterRacesByInteractionPostDateYmd(
        races,
        kaisaiDate,
        interactionYmd,
        { source: scheduleKind === 'nar' ? 'nar' : 'jra' },
      );
      if (!races.length) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: t('race_schedule.errors.venue_no_races_today', null, loc),
            actionRows: [],
            extraFlags: v2ExtraFlags(interaction),
            withBotingMenuBack: true,
            locale: loc,
          }),
        );
        return;
      }
      for (const r of races) {
        raceResultFlagStore.set(`${userId}|${r.raceId}`, !!r.isResult);
      }
      const lines = races.map((r) => {
        const st = getRaceSalesStatus(r, kaisaiDate);
        const detail = raceSalesStatusDetailLabel(st, loc);
        return `**${r.roundLabel}** ${r.timeText} — ${r.title}\n└ ${detail}`;
      });
      let description = lines.join('\n\n');
      if (description.length > 4090) description = `${description.slice(0, 4087)}…`;

      const headline = [
        t('race_schedule.lines.race_list_title', null, loc),
        '',
        description,
        '',
        t('race_schedule.lines.race_list_kaisai', { date: kaisaiDate }, loc),
      ].join('\n');

      const vs = venueSelectionStore.get(userId);
      const backKind = vs?.source || scheduleKind;
      const backGroup = backKind === 'nar' ? '_' : currentGroup;

      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline,
          actionRows: [
            raceSelectRow(kaisaiDate, races, loc),
            scheduleBackToVenueButtonRow(kaisaiDate, backGroup, backKind, loc),
            scheduleBackToKindSelectButtonRow(loc),
            betSlipOpenReviewButtonRowForSchedule(
              userId,
              firstScheduleAnchorRaceIdFromRaces(races),
            ),
          ],
          extraFlags: v2ExtraFlags(interaction),
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
    } catch (e) {
      console.error(e);
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: t('race_schedule.errors.generic_message', { message: e.message }, loc),
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
    }
    return;
  }

  // 2) レース -> 出馬表+賭け方 / 結果+払戻 / 確定待ち
  if (customId === RACE_MENU_ID) {
    await interaction.deferUpdate();
    const rawVal = interaction.values[0];
    const [raceId, isResultFlag] = String(rawVal).split('|');
    try {
      const payload = await buildRaceMenuSelectionPayload(interaction, {
        raceId,
        isResultFlag,
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error(e);
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: t('race_schedule.errors.card_fetch_failed', { message: e.message }, loc),
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
    }
    return;
  }

  // セレクトでベットフローを前進したら「購入から戻った直後」専用の戻る解釈を解除する
  // + 戻るボタン再描画用に、各メニューで選んだ値を stepSelections に蓄積（式別〜馬番）
  if (
    customId.startsWith(BET_PREFIX) &&
    !customId.startsWith(BET_TYPE_MENU_PREFIX) &&
    !customId.startsWith(BET_SLIP_MENU_PREFIX) &&
    userId
  ) {
    const rid = raceIdFromBetFlowSelectCustomId(customId);
    if (rid) {
      const fl = getBetFlow(userId, rid);
      const patch = { resumeBackFromSummary: false };
      if (fl && interaction.values?.length) {
        patch.stepSelections = {
          ...(fl.stepSelections || {}),
          [customId]: interaction.values.map((v) => String(v)),
        };
        patch.purchaseSnapshot = null;
        patch.navViewMenuIndex = null;
      }
      patchBetFlow(userId, rid, patch);
    }
  }

  // 3) 賭け方メニュー
  if (customId.startsWith(BET_TYPE_MENU_PREFIX)) {
    await interaction.deferUpdate();
    const raceId = customId.split('|').pop();
    const betType = interaction.values[0];

    let flow = getBetFlow(userId, raceId);
    if (!flow?.result) {
      const scraper = new NetkeibaScraper();
      const fo = flow?.source || flow?.result?.netkeibaOrigin;
      const preferredOrigin =
        fo === 'jra' || fo === 'nar' ? fo : null;
      const result = await scraper.scrapeRaceCard(raceId, { preferredOrigin });
      setBetFlow(userId, raceId, { ...(flow || {}), result });
      flow = getBetFlow(userId, raceId);
    }
    if (!isJraBetTypeAllowedForFlow(betType, flow)) {
      await interaction.editReply(
        raceCardPayload(interaction,{
          result: flow.result,
          headline: t('race_schedule.errors.jra_bet_type_not_allowed', null, loc),
          actionRows: [
            betTypeSelectRow(raceId, null, flow, loc),
            scheduleRaceListBackIfScheduled(userId, raceId, loc),
          ].filter(Boolean),
        }),
      );
      return;
    }
    patchBetFlow(userId, raceId, {
      betType,
      jraMulti: false,
      // 賭け方を切り替えたら前の投票形式・軸などを残さない（戻るチェーンが壊れるのを防ぐ）
      pairMode: null,
      pairAxis: null,
      pairFormA: null,
      umatanMode: null,
      umatanFirst: null,
      umatanAxis: null,
      umatanAxis2: null,
      umatanFormA: null,
      trifukuMode: null,
      trifukuAxis1: null,
      trifukuAxis2: null,
      trifukuFormA: null,
      trifukuFormB: null,
      tritanMode: null,
      tritanFirst: null,
      tritanSecond: null,
      tritanAxis: null,
      tritanAxis2: null,
      tritanAxis3: null,
      tritanN12A1: null,
      tritanN12A2: null,
      tritanN13A1: null,
      tritanN13A3: null,
      tritanN23A2: null,
      tritanN23A3: null,
      tritanFormA: null,
      tritanFormB: null,
      backMenuIds: null,
      backMenuIndex: null,
      resumeBackFromSummary: false,
      purchase: null,
      purchaseSnapshot: null,
      navViewMenuIndex: null,
      stepSelections: { [`race_bet_type|${raceId}`]: [String(betType)] },
      lastSelectionLine: null,
    });

    flow = getBetFlow(userId, raceId);
    const result = flow.result;

    // 単勝/複勝/単勝+複勝 -> 馬番だけ選ぶ
    if (betType === 'win' || betType === 'place' || betType === 'win_place') {
      const options = horseOptionsFromResult(result);
      const lastMenuCustomId = `race_bet_single_pick|${raceId}|${betType}`;
      const backMenuIds = computeBackMenuIds({
        raceId,
        flow,
        betType,
        lastMenuCustomId,
      });
      const backMenuIndex = backMenuIds.lastIndexOf(lastMenuCustomId);
      patchBetFlow(userId, raceId, {
        backMenuIds,
        backMenuIndex:
          backMenuIndex >= 0 ? backMenuIndex : backMenuIds.length - 1,
      });
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.pick_horses', { betType: betTypeLabel(betType, loc) }, loc),
          actionRows: [
        buildSelectionRow({
            customId: `race_bet_single_pick|${raceId}|${betType}`,
            placeholder: ph('pick_one_horse', loc),
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, backMenuIndex, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    // 枠連/馬連/ワイド -> 通常/ながし/ボックス/フォーメーション
    if (betType === 'frame_pair' || betType === 'horse_pair' || betType === 'wide') {
      const lastId = `race_bet_pair_mode|${raceId}|${betType}`;
      const bi = setupHorseStepBack(userId, raceId, betType, lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.pick_vote_mode', { betType: betTypeLabel(betType, loc) }, loc),
          actionRows: [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(lastId)
              .setPlaceholder(t('bet_flow.placeholders.vote_mode', null, loc))
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(
                pairModesLabeled(loc).map((m) =>
                  new StringSelectMenuOptionBuilder()
                    .setLabel(m.label)
                    .setValue(m.id)
                    .setDescription(t('bet_flow.descriptions.next_pick_horses', null, loc)),
                ),
              ),
          ),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    // 馬単
    if (betType === 'umatan') {
      const lastId = `race_bet_umatan_mode|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'umatan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.pick_vote_mode', { betType: betTypeLabel('umatan', loc) }, loc),
          actionRows: [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(lastId)
              .setPlaceholder(t('bet_flow.placeholders.vote_mode', null, loc))
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(
                umatanModesLabeled(loc).map((m) =>
                  new StringSelectMenuOptionBuilder()
                    .setLabel(m.label)
                    .setValue(m.id)
                    .setDescription(t('bet_flow.descriptions.next_pick_horses', null, loc)),
                ),
              ),
          ),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    // 3連複
    if (betType === 'trifuku') {
      const lastId = `race_bet_trifuku_mode|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'trifuku', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.pick_vote_mode', { betType: betTypeLabel('trifuku', loc) }, loc),
          actionRows: [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(lastId)
              .setPlaceholder(t('bet_flow.placeholders.vote_mode', null, loc))
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(
                trifukuModesLabeled(loc).map((m) =>
                  new StringSelectMenuOptionBuilder()
                    .setLabel(m.label)
                    .setValue(m.id)
                    .setDescription(t('bet_flow.descriptions.next_pick_horses', null, loc)),
                ),
              ),
          ),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    // 3連単
    if (betType === 'tritan') {
      const lastId = `race_bet_tritan_mode|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.pick_vote_mode', { betType: betTypeLabel('tritan', loc) }, loc),
          actionRows: [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(lastId)
              .setPlaceholder(t('bet_flow.placeholders.vote_mode', null, loc))
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(
                tritanModesLabeled(loc).map((m) =>
                  new StringSelectMenuOptionBuilder()
                    .setLabel(m.label)
                    .setValue(m.id)
                    .setDescription(t('bet_flow.descriptions.next_pick_horses', null, loc)),
                ),
              ),
          ),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.errors.unsupported_bet_type', null, loc),
          actionRows: [
        
        ].filter(Boolean),
        }),
      );
  }

  // 4) 単勝/複勝/単勝+複勝: 馬番確定
  if (customId.startsWith('race_bet_single_pick|')) {
    await interaction.deferUpdate();
    const parts = customId.split('|'); // [prefix, raceId, betType]
    const raceId = parts[1];
    const betType = parts[2];
    const picks = interaction.values; // [horseNo]

    const flow = getBetFlow(userId, raceId);
    const flowLoc = resolveLocaleFromInteraction(interaction);
    if (!flow?.result) {
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: msgRaceBetFlowSessionInvalid(flowLoc),
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
          withBotingMenuBack: true,
          locale: flowLoc,
        }),
      );
      return;
    }
    const result = flow.result;
    const horseText = formatNamesByNums(result, picks, loc);
    const points = betType === 'win_place' ? 2 : 1;
    const selectionLine = t(
      'race_schedule.selection.arrow',
      { betType: betTypeLabel(betType, loc), summary: horseText },
      loc,
    );

    const options = horseOptionsFromResult(result);

    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_single_pick|${raceId}|${betType}`,
        placeholder: ph('pick_one_horse', loc),
        options,
        minValues: 1,
        maxValues: 1,
        defaultValues: picks,
      },
    });
    return;
  }

  // 5) 枠連/馬連/ワイド: 投票形式
  if (customId.startsWith('race_bet_pair_mode|')) {
    await interaction.deferUpdate();
    const [_, raceId, betType] = customId.split('|');
    const mode = interaction.values[0];

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { betType, pairMode: mode });
    const result = flow.result;

    const isFrame = betType === 'frame_pair';
    const options = isFrame ? frameOptionsFromResult(result, 25, {}, loc) : horseOptionsFromResult(result);

    // 通常（2つまで）
    if (mode === 'normal') {
      if (isFrame) {
        // 枠連（通常）は「1つずつ」選ぶ（同一枠(1-1)も許可するため）
        const lastMenuCustomId = `race_bet_frame_pair_normal_first|${raceId}`;
        const backMenuIds = computeBackMenuIds({
          raceId,
          flow: { ...flow, pairMode: mode },
          betType,
          lastMenuCustomId,
        });
        const backMenuIndex = backMenuIds.lastIndexOf(lastMenuCustomId);
        patchBetFlow(userId, raceId, {
          backMenuIds,
          backMenuIndex:
            backMenuIndex >= 0 ? backMenuIndex : backMenuIds.length - 1,
        });

        await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.pair_normal_frame_first', null, loc),
          actionRows: [
        buildSelectionRow({
              customId: lastMenuCustomId,
              placeholder: ph('first_frame', loc),
              options,
              minValues: 1,
              maxValues: 1,
            }),
            backButtonRow(raceId, backMenuIndex, loc),
            scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
        return;
      }

      const lastMenuCustomId = `race_bet_pair_normal|${raceId}|${betType}`;
      const backMenuIds = computeBackMenuIds({
        raceId,
        flow: { ...flow, pairMode: mode },
        betType,
        lastMenuCustomId,
      });
      const backMenuIndex = backMenuIds.lastIndexOf(lastMenuCustomId);
      patchBetFlow(userId, raceId, {
        backMenuIds,
        backMenuIndex: backMenuIndex >= 0 ? backMenuIndex : backMenuIds.length - 1,
      });
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.pair_normal_horse_two', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastMenuCustomId,
            placeholder: ph('horse_pick_two', loc),
            options,
            minValues: 1,
            maxValues: 2,
          }),
          backButtonRow(raceId, backMenuIndex, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    // ながし（軸 + 相手）
    if (mode === 'nagashi') {
      const lastMenuCustomId = `race_bet_pair_nagashi_axis|${raceId}|${betType}`;
      const backMenuIds = computeBackMenuIds({
        raceId,
        flow: { ...flow, pairMode: mode },
        betType,
        lastMenuCustomId,
      });
      const backMenuIndex = backMenuIds.lastIndexOf(lastMenuCustomId);
      patchBetFlow(userId, raceId, {
        backMenuIds,
        backMenuIndex: backMenuIndex >= 0 ? backMenuIndex : backMenuIds.length - 1,
      });
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.pair_nagashi_axis', {
            unit: isFrame
              ? t('race_schedule.display.unit_frame', null, loc)
              : t('race_schedule.display.unit_horse', null, loc),
          }, loc),
          actionRows: [
        buildSelectionRow({
            customId: `race_bet_pair_nagashi_axis|${raceId}|${betType}`,
            placeholder: isFrame ? ph('axis_frame', loc) : ph('axis_horse', loc),
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, backMenuIndex, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    // ボックス（何頭でも）
    if (mode === 'box') {
      const lastMenuCustomId = `race_bet_pair_box|${raceId}|${betType}`;
      const backMenuIds = computeBackMenuIds({
        raceId,
        flow: { ...flow, pairMode: mode },
        betType,
        lastMenuCustomId,
      });
      const backMenuIndex = backMenuIds.lastIndexOf(lastMenuCustomId);
      patchBetFlow(userId, raceId, {
        backMenuIds,
        backMenuIndex: backMenuIndex >= 0 ? backMenuIndex : backMenuIds.length - 1,
      });
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.pair_box', {
            unit: isFrame
              ? t('race_schedule.display.unit_frame', null, loc)
              : t('race_schedule.display.unit_horse', null, loc),
          }, loc),
          actionRows: [
        buildSelectionRow({
            customId: `race_bet_pair_box|${raceId}|${betType}`,
            placeholder: isFrame ? ph('frame_pick', loc) : ph('horse_pick', loc),
            options,
            minValues: 2,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, backMenuIndex, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    // フォーメーション（2グループ）
    if (mode === 'formation') {
      const lastMenuCustomId = `race_bet_pair_formA|${raceId}|${betType}`;
      const backMenuIds = computeBackMenuIds({
        raceId,
        flow: { ...flow, pairMode: mode },
        betType,
        lastMenuCustomId,
      });
      const backMenuIndex = backMenuIds.lastIndexOf(lastMenuCustomId);
      patchBetFlow(userId, raceId, {
        backMenuIds,
        backMenuIndex: backMenuIndex >= 0 ? backMenuIndex : backMenuIds.length - 1,
      });
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.pair_form_first', {
            unit: isFrame
              ? t('race_schedule.display.unit_frame', null, loc)
              : t('race_schedule.display.unit_horse', null, loc),
          }, loc),
          actionRows: [
        buildSelectionRow({
            customId: `race_bet_pair_formA|${raceId}|${betType}`,
            placeholder: isFrame
              ? ph('pair_form_group1_frame', loc)
              : ph('pair_form_group1_horse', loc),
            options,
            minValues: 1,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, backMenuIndex, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }
  }

  // 6) 枠連/馬連/ワイド: 通常
  if (customId.startsWith('race_bet_pair_normal|')) {
    await interaction.deferUpdate();
    const [_, raceId, betType] = customId.split('|');
    const picks = interaction.values;

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const isFrame = betType === 'frame_pair';

    if (picks.length < 2) {
      const options = isFrame ? frameOptionsFromResult(result, 25, {}, loc) : horseOptionsFromResult(result);
      const lastMenuCustomId = `race_bet_pair_normal|${raceId}|${betType}`;
      const backMenuIds = computeBackMenuIds({
        raceId,
        flow,
        betType,
        lastMenuCustomId,
      });
      const backMenuIndex = backMenuIds.lastIndexOf(lastMenuCustomId);
      patchBetFlow(userId, raceId, {
        backMenuIds,
        backMenuIndex: backMenuIndex >= 0 ? backMenuIndex : backMenuIds.length - 1,
      });
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.pair_normal_pick_two', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastMenuCustomId,
            placeholder: isFrame ? ph('frame_pick_two', loc) : ph('horse_pick_two', loc),
            options,
            minValues: 1,
            maxValues: 2,
          }),
          backButtonRow(raceId, backMenuIndex, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    const summary = isFrame
      ? t(
          'race_schedule.selection_snippets.frames_colon',
          { list: formatFrames(result, picks, loc) },
          loc,
        )
      : t(
          'race_schedule.selection_snippets.horses_colon',
          { list: formatNamesByNums(result, picks, loc) },
          loc,
        );
    const points = 1;
    const selectionLine = t(
      'race_schedule.selection.with_mode',
      {
        betType: betTypeLabel(betType, loc),
        mode: t('bet_flow.pair_modes.normal', null, loc),
        summary,
      },
      loc,
    );

    const options = isFrame ? frameOptionsFromResult(result, 25, {}, loc) : horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_pair_normal|${raceId}|${betType}`,
        placeholder: isFrame ? ph('frame_pick_two', loc) : ph('horse_pick_two', loc),
        options,
        minValues: 1,
        maxValues: 2,
        defaultValues: picks,
      },
    });
    return;
  }

  // 6-1) 枠連（通常）: 第1枠 -> 第2枠
  if (customId.startsWith('race_bet_frame_pair_normal_first|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const first = interaction.values[0];

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;

    const result = flow.result;
    patchBetFlow(userId, raceId, {
      betType: 'frame_pair',
      pairMode: 'normal',
      framePairNormalFirst: first,
    });

    const lastMenuCustomId = `race_bet_frame_pair_normal_second|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'frame_pair', lastMenuCustomId);

    const omitFrames =
      !frameAllowsWakurenSamePair(result.horses, first) ? [String(first)] : [];
    const options = frameOptionsFromResult(result, 25, { omitFrames }, loc);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.frame_pick_second', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastMenuCustomId,
          placeholder: ph('second_frame', loc),
          options,
          minValues: 1,
          maxValues: 1,
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }

  if (customId.startsWith('race_bet_frame_pair_normal_second|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const second = interaction.values[0];

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;

    const result = flow.result;
    const first = flow.framePairNormalFirst;

    if (
      first != null &&
      second != null &&
      String(first) === String(second) &&
      !frameAllowsWakurenSamePair(result.horses, first)
    ) {
      const omitFrames = [String(first)];
      const options = frameOptionsFromResult(result, 25, { omitFrames }, loc);
      const lastMenuCustomId = `race_bet_frame_pair_normal_second|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'frame_pair', lastMenuCustomId);
      await interaction.editReply(
        raceCardPayload(interaction, {
          result,
          headline: t('race_schedule.headlines.frame_same_wakuren_error', null, loc),
          actionRows: [
            buildSelectionRow({
              customId: lastMenuCustomId,
              placeholder: ph('second_frame', loc),
              options,
              minValues: 1,
              maxValues: 1,
            }),
            backButtonRow(raceId, bi, loc),
            scheduleRaceListBackIfScheduled(userId, raceId, loc),
          ].filter(Boolean),
        }),
      );
      return;
    }

    const points = 1;
    const selectionLine = t(
      'race_schedule.selection.frame_pair_normal',
      {
        betType: betTypeLabel('frame_pair', loc),
        mode: t('bet_flow.pair_modes.normal', null, loc),
        summary: formatFrames(result, [first, second], loc),
      },
      loc,
    );
    const omitFrames =
      first != null && !frameAllowsWakurenSamePair(result.horses, first)
        ? [String(first)]
        : [];
    const options = frameOptionsFromResult(result, 25, { omitFrames }, loc);

    const firstMenuCustomId = `race_bet_frame_pair_normal_first|${raceId}`;
    // 最終確定側の renderFinalSelection で lastMenu 以外も保持したいので先に stepSelections を埋める
    patchBetFlow(userId, raceId, {
      stepSelections: {
        ...(flow.stepSelections || {}),
        [firstMenuCustomId]: first != null ? [String(first)] : [],
      },
    });

    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType: 'frame_pair',
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_frame_pair_normal_second|${raceId}`,
        placeholder: ph('second_frame', loc),
        options,
        minValues: 1,
        maxValues: 1,
        defaultValues: [second],
      },
    });
    return;
  }

  // 7) 枠連/馬連/ワイド: ながし軸
  if (customId.startsWith('race_bet_pair_nagashi_axis|')) {
    await interaction.deferUpdate();
    const [_, raceId, betType] = customId.split('|');
    const axis = interaction.values[0];

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { pairAxis: axis });
    const result = flow.result;
    const isFrame = betType === 'frame_pair';
    const options = isFrame ? frameOptionsFromResult(result, 25, {}, loc) : horseOptionsFromResult(result);

    const lastMenuCustomId = `race_bet_pair_nagashi_opponent|${raceId}|${betType}`;
    const bi = setupHorseStepBack(userId, raceId, betType, lastMenuCustomId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.pair_nagashi_opponent', {
            unit: isFrame
              ? t('race_schedule.display.unit_frame', null, loc)
              : t('race_schedule.display.unit_horse', null, loc),
          }, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastMenuCustomId,
          placeholder: ph('opponents_multi', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }

  // 8) 枠連/馬連/ワイド: ながし相手
  if (customId.startsWith('race_bet_pair_nagashi_opponent|')) {
    await interaction.deferUpdate();
    const [_, raceId, betType] = customId.split('|');
    const opponents = interaction.values;

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const isFrame = betType === 'frame_pair';
    const axis = flow.pairAxis;

    const summary = isFrame
      ? t(
          'race_schedule.selection_snippets.axis_opp',
          {
            axis: formatFrames(result, [axis], loc),
            opp: formatFrames(result, opponents, loc),
          },
          loc,
        )
      : t(
          'race_schedule.selection_snippets.axis_opp',
          {
            axis: formatNamesByNums(result, [axis], loc),
            opp: formatNamesByNums(result, opponents, loc),
          },
          loc,
        );
    const points = isFrame
      ? countFramePairNagashiPoints(axis, opponents, result)
      : distinctCountExcluding(opponents, [axis]);
    const selectionLine = t(
      'race_schedule.selection.with_mode',
      {
        betType: betTypeLabel(betType, loc),
        mode: t('bet_flow.pair_modes.nagashi', null, loc),
        summary,
      },
      loc,
    );

    const options = isFrame ? frameOptionsFromResult(result, 25, {}, loc) : horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_pair_nagashi_opponent|${raceId}|${betType}`,
        placeholder: ph('opponents_multi', loc),
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: opponents,
      },
    });
    return;
  }

  // 9) 枠連/馬連/ワイド: ボックス
  if (customId.startsWith('race_bet_pair_box|')) {
    await interaction.deferUpdate();
    const [_, raceId, betType] = customId.split('|');
    const picks = interaction.values;

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const isFrame = betType === 'frame_pair';

    const summary = isFrame
      ? t(
          'race_schedule.selection_snippets.frames_colon',
          { list: formatFrames(result, picks, loc) },
          loc,
        )
      : t(
          'race_schedule.selection_snippets.horses_colon',
          { list: formatNamesByNums(result, picks, loc) },
          loc,
        );
    const points = isFrame
      ? countFramePairBoxPoints(picks, result)
      : calcComb2(uniqValues(picks).length);
    const selectionLine = t(
      'race_schedule.selection.with_mode',
      {
        betType: betTypeLabel(betType, loc),
        mode: t('bet_flow.pair_modes.box', null, loc),
        summary,
      },
      loc,
    );

    const options = isFrame ? frameOptionsFromResult(result, 25, {}, loc) : horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_pair_box|${raceId}|${betType}`,
        placeholder: isFrame ? ph('frame_pick', loc) : ph('horse_pick', loc),
        options,
        minValues: 2,
        maxValues: Math.min(options.length, 25),
        defaultValues: picks,
      },
    });
    return;
  }

  // 10) 枠連/馬連/ワイド: フォーメーション 第1群
  if (customId.startsWith('race_bet_pair_formA|')) {
    await interaction.deferUpdate();
    const [_, raceId, betType] = customId.split('|');
    const picks = interaction.values;

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { pairFormA: picks });
    const result = flow.result;
    const isFrame = betType === 'frame_pair';
    const options = isFrame ? frameOptionsFromResult(result, 25, {}, loc) : horseOptionsFromResult(result);

    const lastMenuCustomId = `race_bet_pair_formB|${raceId}|${betType}`;
    const bi = setupHorseStepBack(userId, raceId, betType, lastMenuCustomId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.pair_form_second', {
            unit: isFrame
              ? t('race_schedule.display.unit_frame', null, loc)
              : t('race_schedule.display.unit_horse', null, loc),
          }, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastMenuCustomId,
          placeholder: isFrame
            ? ph('pair_form_group2_frame', loc)
            : ph('pair_form_group2_horse', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }

  // 11) 枠連/馬連/ワイド: フォーメーション 第2群
  if (customId.startsWith('race_bet_pair_formB|')) {
    await interaction.deferUpdate();
    const [_, raceId, betType] = customId.split('|');
    const picksB = interaction.values;

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const isFrame = betType === 'frame_pair';
    const picksA = flow.pairFormA || [];

    const summary = isFrame
      ? t(
          'race_schedule.selection_snippets.form_two_groups',
          {
            g1: formatFrames(result, picksA, loc),
            g2: formatFrames(result, picksB, loc),
          },
          loc,
        )
      : t(
          'race_schedule.selection_snippets.form_two_groups',
          {
            g1: formatNamesByNums(result, picksA, loc),
            g2: formatNamesByNums(result, picksB, loc),
          },
          loc,
        );
    const points = isFrame
      ? countFramePairFormationPoints(picksA, picksB, result)
      : countUniquePairsUnordered(picksA, picksB);
    const selectionLine = t(
      'race_schedule.selection.with_mode',
      {
        betType: betTypeLabel(betType, loc),
        mode: t('bet_flow.pair_modes.formation', null, loc),
        summary,
      },
      loc,
    );

    const options = isFrame ? frameOptionsFromResult(result, 25, {}, loc) : horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_pair_formB|${raceId}|${betType}`,
        placeholder: isFrame
          ? ph('pair_form_group2_frame', loc)
          : ph('pair_form_group2_horse', loc),
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: picksB,
      },
    });
    return;
  }

  // 12) 馬単: モード選択
  if (customId.startsWith('race_bet_umatan_mode|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const mode = interaction.values[0];

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { betType: 'umatan', umatanMode: mode, jraMulti: false });
    const result = flow.result;
    const options = horseOptionsFromResult(result);

    if (mode === 'normal') {
      const lastId = `race_bet_umatan_normal_1|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'umatan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.umatan_normal_first', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('umatan_place_1', loc),
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'nagashi1') {
      const lastId = `race_bet_umatan_nagashi1_axis|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'umatan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.umatan_nagashi1_axis', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('axis_place_1', loc),
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'nagashi2') {
      const lastId = `race_bet_umatan_nagashi2_axis|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'umatan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.umatan_nagashi2_axis', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('axis_place_2', loc),
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'box') {
      const lastId = `race_bet_umatan_box|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'umatan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.umatan_box', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('horses_multi', loc),
            options,
            minValues: 2,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'formation') {
      const lastId = `race_bet_umatan_formA|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'umatan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.umatan_form_a', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('group_a_umatan', loc),
            options,
            minValues: 1,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }
  }

  // 13) 馬単 通常: 1着 -> 2着
  if (customId.startsWith('race_bet_umatan_normal_1|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const one = interaction.values[0];

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { umatanFirst: one, jraMulti: false });
    const result = flow.result;
    const options = horseOptionsFromResult(result);

    const lastId = `race_bet_umatan_normal_2|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'umatan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.umatan_pick_second', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('umatan_place_2', loc),
          options,
          minValues: 1,
          maxValues: 1,
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }

  if (customId.startsWith('race_bet_umatan_normal_2|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const two = interaction.values[0];

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const first = flow.umatanFirst;

    const betType = 'umatan';
    const points = first !== two ? 1 : 0;
    const selectionLine = t(
      'race_schedule.selection.umatan_normal',
      {
        betType: betTypeLabel('umatan', loc),
        mode: t('bet_flow.umatan_modes.normal', null, loc),
        p1: formatNamesByNums(result, [first], loc),
        p2: formatNamesByNums(result, [two], loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_umatan_normal_2|${raceId}`,
        placeholder: ph('umatan_place_2', loc),
        options,
        minValues: 1,
        maxValues: 1,
        defaultValues: [two],
      },
    });
    return;
  }

  // 14) 馬単 ながし1: 軸 -> 相手（2着）
  if (customId.startsWith('race_bet_umatan_nagashi1_axis|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const axis = interaction.values[0];

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { umatanAxis: axis });
    const result = flow.result;
    const options = horseOptionsFromResult(result);

    const lastId = `race_bet_umatan_nagashi1_opp|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'umatan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.umatan_opp_second', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('opp_place_2', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }

  if (customId.startsWith('race_bet_umatan_nagashi1_opp|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const opp = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const axis = flow.umatanAxis;

    const betType = 'umatan';
    const points = distinctCountExcluding(opp, [axis]);
    const selectionLine = t(
      'race_schedule.selection.umatan_nagashi1',
      {
        betType: betTypeLabel('umatan', loc),
        mode: t('bet_flow.umatan_modes.nagashi1', null, loc),
        axis: formatNamesByNums(result, [axis], loc),
        opp: formatNamesByNums(result, opp, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_umatan_nagashi1_opp|${raceId}`,
        placeholder: ph('opp_place_2', loc),
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: opp,
      },
    });
    return;
  }

  // 15) 馬単 ながし2: 軸（2着） -> 相手（1着）
  if (customId.startsWith('race_bet_umatan_nagashi2_axis|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const axis = interaction.values[0];

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { umatanAxis2: axis });
    const result = flow.result;
    const options = horseOptionsFromResult(result);

    const lastId = `race_bet_umatan_nagashi2_opp|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'umatan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.umatan_opp_first', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('opp_place_1', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }

  if (customId.startsWith('race_bet_umatan_nagashi2_opp|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const opp = interaction.values;

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const axis = flow.umatanAxis2;

    const betType = 'umatan';
    const points = distinctCountExcluding(opp, [axis]);
    const selectionLine = t(
      'race_schedule.selection.umatan_nagashi2',
      {
        betType: betTypeLabel('umatan', loc),
        mode: t('bet_flow.umatan_modes.nagashi2', null, loc),
        axis: formatNamesByNums(result, [axis], loc),
        opp: formatNamesByNums(result, opp, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_umatan_nagashi2_opp|${raceId}`,
        placeholder: ph('opp_place_1', loc),
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: opp,
      },
    });
    return;
  }

  // 16) 馬単 ボックス
  if (customId.startsWith('race_bet_umatan_box|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const picks = interaction.values;

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const betType = 'umatan';
    const uniq = uniqValues(picks).length;
    const points = uniq * (uniq - 1);
    const selectionLine = t(
      'race_schedule.selection.umatan_box',
      {
        betType: betTypeLabel('umatan', loc),
        mode: t('bet_flow.umatan_modes.box', null, loc),
        horses: formatNamesByNums(result, picks, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_umatan_box|${raceId}`,
        placeholder: ph('horses_multi', loc),
        options,
        minValues: 2,
        maxValues: Math.min(options.length, 25),
        defaultValues: picks,
      },
    });
    return;
  }

  // 17) 馬単 フォーメーション: 第1群 -> 第2群
  if (customId.startsWith('race_bet_umatan_formA|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const picksA = interaction.values;

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { umatanFormA: picksA, jraMulti: false });
    const result = flow.result;
    const options = horseOptionsFromResult(result);

    const lastId = `race_bet_umatan_formB|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'umatan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.umatan_form_b', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('group_b_umatan', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }

  if (customId.startsWith('race_bet_umatan_formB|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const picksB = interaction.values;

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const picksA = flow.umatanFormA || [];

    const betType = 'umatan';
    const points = countCrossDistinctPairs(picksA, picksB);
    const selectionLine = t(
      'race_schedule.selection.umatan_form',
      {
        betType: betTypeLabel('umatan', loc),
        mode: t('bet_flow.umatan_modes.formation', null, loc),
        a: formatNamesByNums(result, picksA, loc),
        b: formatNamesByNums(result, picksB, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_umatan_formB|${raceId}`,
        placeholder: ph('group_b_umatan', loc),
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: picksB,
      },
    });
    return;
  }

  // 18) 3連複: モード選択
  if (customId.startsWith('race_bet_trifuku_mode|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const mode = interaction.values[0];

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { betType: 'trifuku', trifukuMode: mode });
    const result = flow.result;
    const options = horseOptionsFromResult(result);

    if (mode === 'normal') {
      const lastId = `race_bet_trifuku_normal|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'trifuku', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.trifuku_normal', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('pick_three', loc),
            options,
            minValues: 3,
            maxValues: 3,
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'nagashi1') {
      const lastId = `race_bet_trifuku_n1_axis|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'trifuku', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.trifuku_n1_axis', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('axis_one', loc),
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'nagashi2') {
      const lastId = `race_bet_trifuku_n2_axis|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'trifuku', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.trifuku_n2_axis', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('axis_two', loc),
            options,
            minValues: 2,
            maxValues: 2,
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'box') {
      const lastId = `race_bet_trifuku_box|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'trifuku', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.trifuku_box', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('horses_multi_short', loc),
            options,
            minValues: 3,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'formation') {
      const lastId = `race_bet_trifuku_formA|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'trifuku', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.trifuku_form_a', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('form_group_1', loc),
            options,
            minValues: 1,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }
  }

  // 19) 3連複 通常
  if (customId.startsWith('race_bet_trifuku_normal|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const picks = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const betType = 'trifuku';
    const points = uniqValues(picks).length === 3 ? 1 : 0;
    const selectionLine = t(
      'race_schedule.selection.trifuku_normal',
      {
        betType: betTypeLabel('trifuku', loc),
        mode: t('bet_flow.trifuku_modes.normal', null, loc),
        horses: formatNamesByNums(result, picks, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_trifuku_normal|${raceId}`,
        placeholder: ph('pick_three', loc),
        options,
        minValues: 3,
        maxValues: 3,
        defaultValues: picks,
      },
    });
    return;
  }

  // 20) 3連複 軸1頭ながし: 軸 -> 相手
  if (customId.startsWith('race_bet_trifuku_n1_axis|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const axis = interaction.values[0];
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { trifukuAxis1: axis });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_trifuku_n1_opp|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'trifuku', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.trifuku_opp_two', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('opponents_multi_short', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }

  if (customId.startsWith('race_bet_trifuku_n1_opp|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const opp = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const axis = flow.trifukuAxis1;
    const betType = 'trifuku';
    const points = calcComb2(distinctCountExcluding(opp, [axis]));
    const selectionLine = t(
      'race_schedule.selection.trifuku_n1',
      {
        betType: betTypeLabel('trifuku', loc),
        mode: t('bet_flow.trifuku_modes.nagashi1', null, loc),
        axis: formatNamesByNums(result, [axis], loc),
        opp: formatNamesByNums(result, opp, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_trifuku_n1_opp|${raceId}`,
        placeholder: ph('opponents_multi_short', loc),
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: opp,
      },
    });
    return;
  }

  // 21) 3連複 軸2頭ながし: 軸 -> 相手
  if (customId.startsWith('race_bet_trifuku_n2_axis|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const axes = interaction.values; // exactly 2
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { trifukuAxis2: axes });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_trifuku_n2_opp|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'trifuku', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.trifuku_opp_one', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('opponents_multi_short', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }

  if (customId.startsWith('race_bet_trifuku_n2_opp|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const opp = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const axes = flow.trifukuAxis2 || [];
    const betType = 'trifuku';
    const points = distinctCountExcluding(opp, axes);
    const selectionLine = t(
      'race_schedule.selection.trifuku_n2',
      {
        betType: betTypeLabel('trifuku', loc),
        mode: t('bet_flow.trifuku_modes.nagashi2', null, loc),
        axis: formatNamesByNums(result, axes, loc),
        opp: formatNamesByNums(result, opp, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_trifuku_n2_opp|${raceId}`,
        placeholder: ph('opponents_multi_short', loc),
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: opp,
      },
    });
    return;
  }

  // 22) 3連複 ボックス
  if (customId.startsWith('race_bet_trifuku_box|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const picks = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const betType = 'trifuku';
    const points = calcComb3(uniqValues(picks).length);
    const selectionLine = t(
      'race_schedule.selection.trifuku_box',
      {
        betType: betTypeLabel('trifuku', loc),
        mode: t('bet_flow.trifuku_modes.box', null, loc),
        horses: formatNamesByNums(result, picks, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_trifuku_box|${raceId}`,
        placeholder: ph('horses_multi_short', loc),
        options,
        minValues: 3,
        maxValues: Math.min(options.length, 25),
        defaultValues: picks,
      },
    });
    return;
  }

  // 23) 3連複 フォーメーション: A -> B -> C
  if (customId.startsWith('race_bet_trifuku_formA|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const formA = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { trifukuFormA: formA });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_trifuku_formB|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'trifuku', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.trifuku_form_b', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('form_group_2', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }

  if (customId.startsWith('race_bet_trifuku_formB|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const formB = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { trifukuFormB: formB });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_trifuku_formC|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'trifuku', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.trifuku_form_c', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('form_group_3', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }

  if (customId.startsWith('race_bet_trifuku_formC|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const formC = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const formA = flow.trifukuFormA || [];
    const formB = flow.trifukuFormB || [];
    const betType = 'trifuku';
    const points = countUniqueTriplesUnordered(formA, formB, formC);
    const selectionLine = t(
      'race_schedule.selection.trifuku_form',
      {
        betType: betTypeLabel('trifuku', loc),
        mode: t('bet_flow.trifuku_modes.formation', null, loc),
        a: formatNamesByNums(result, formA, loc),
        b: formatNamesByNums(result, formB, loc),
        c: formatNamesByNums(result, formC, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_trifuku_formC|${raceId}`,
        placeholder: ph('form_group_3', loc),
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: formC,
      },
    });
    return;
  }

  // 24) 3連単: モード選択
  if (customId.startsWith('race_bet_tritan_mode|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const mode = interaction.values[0];

    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { betType: 'tritan', tritanMode: mode, jraMulti: false });
    const result = flow.result;
    const options = horseOptionsFromResult(result);

    if (mode === 'normal') {
      const lastId = `race_bet_tritan_normal_1|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_normal_first', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('umatan_place_1', loc),
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'nagashi1') {
      const lastId = `race_bet_tritan_nagashi1_axis|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_n1_axis', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('axis_place_1', loc),
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'nagashi2') {
      const lastId = `race_bet_tritan_nagashi2_axis|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_n2_axis', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('axis_place_2', loc),
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'nagashi3') {
      const lastId = `race_bet_tritan_nagashi3_axis|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_n3_axis', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('axis_place_3', loc),
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'nagashi12') {
      const lastId = `race_bet_tritan_n12_a1|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_n12_first', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('umatan_place_1', loc),
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'nagashi13') {
      const lastId = `race_bet_tritan_n13_a1|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_n13_first', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('umatan_place_1', loc),
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'nagashi23') {
      const lastId = `race_bet_tritan_n23_a2|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_n23_first', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('umatan_place_2', loc),
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'box') {
      const lastId = `race_bet_tritan_box|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_box', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('horses_multi_short', loc),
            options,
            minValues: 3,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
      return;
    }

    if (mode === 'formation') {
      const lastId = `race_bet_tritan_formA|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_form_a', null, loc),
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: ph('group_a_umatan', loc),
            options,
            minValues: 1,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, bi, loc),
          scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    }
    return;
  }

  // 25) 3連単 通常: 1着 -> 2着 -> 3着
  if (customId.startsWith('race_bet_tritan_normal_1|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const first = interaction.values[0];
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { tritanFirst: first });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_tritan_normal_2|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_pick_second', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('umatan_place_2', loc),
          options,
          minValues: 1,
          maxValues: 1,
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }

  if (customId.startsWith('race_bet_tritan_normal_2|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const second = interaction.values[0];
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { tritanSecond: second });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_tritan_normal_3|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_pick_third', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('tritan_place_3', loc),
          options,
          minValues: 1,
          maxValues: 1,
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }

  if (customId.startsWith('race_bet_tritan_normal_3|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const third = interaction.values[0];
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const first = flow.tritanFirst;
    const second = flow.tritanSecond;
    const betType = 'tritan';
    const points = first !== second && first !== third && second !== third ? 1 : 0;
    const selectionLine = t(
      'race_schedule.selection.tritan_normal',
      {
        betType: betTypeLabel('tritan', loc),
        mode: t('bet_flow.tritan_modes.normal', null, loc),
        p1: formatNamesByNums(result, [first], loc),
        p2: formatNamesByNums(result, [second], loc),
        p3: formatNamesByNums(result, [third], loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_tritan_normal_3|${raceId}`,
        placeholder: ph('tritan_place_3', loc),
        options,
        minValues: 1,
        maxValues: 1,
        defaultValues: [third],
      },
    });
    return;
  }

  // 26) 3連単 ながし1: 軸（1着） -> 相手（2,3着）
  if (customId.startsWith('race_bet_tritan_nagashi1_axis|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const axis = interaction.values[0];
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { tritanAxis: axis });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_tritan_nagashi1_opp|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_opp_23', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('opponent_pick', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }
  if (customId.startsWith('race_bet_tritan_nagashi1_opp|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const opp = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const axis = flow.tritanAxis;
    const betType = 'tritan';
    const n = distinctCountExcluding(opp, [axis]);
    const points = n * (n - 1);
    const selectionLine = t(
      'race_schedule.selection.tritan_nagashi1',
      {
        betType: betTypeLabel('tritan', loc),
        mode: t('bet_flow.tritan_modes.nagashi1', null, loc),
        axis: formatNamesByNums(result, [axis], loc),
        opp: formatNamesByNums(result, opp, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_tritan_nagashi1_opp|${raceId}`,
        placeholder: ph('opponent_pick', loc),
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: opp,
      },
    });
    return;
  }

  // 27) 3連単 ながし2: 軸（2着） -> 相手（1,3着）
  if (customId.startsWith('race_bet_tritan_nagashi2_axis|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const axis = interaction.values[0];
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { tritanAxis2: axis });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_tritan_nagashi2_opp|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_opp_13', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('opponent_pick', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }
  if (customId.startsWith('race_bet_tritan_nagashi2_opp|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const opp = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const axis = flow.tritanAxis2;
    const betType = 'tritan';
    const n = distinctCountExcluding(opp, [axis]);
    const points = n * (n - 1);
    const selectionLine = t(
      'race_schedule.selection.tritan_nagashi2',
      {
        betType: betTypeLabel('tritan', loc),
        mode: t('bet_flow.tritan_modes.nagashi2', null, loc),
        axis: formatNamesByNums(result, [axis], loc),
        opp: formatNamesByNums(result, opp, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_tritan_nagashi2_opp|${raceId}`,
        placeholder: ph('opponent_pick', loc),
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: opp,
      },
    });
    return;
  }

  // 28) 3連単 ながし3: 軸（3着） -> 相手（1,2着）
  if (customId.startsWith('race_bet_tritan_nagashi3_axis|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const axis = interaction.values[0];
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { tritanAxis3: axis });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_tritan_nagashi3_opp|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_opp_12', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('opponent_pick', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }
  if (customId.startsWith('race_bet_tritan_nagashi3_opp|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const opp = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const axis = flow.tritanAxis3;
    const betType = 'tritan';
    const n = distinctCountExcluding(opp, [axis]);
    const points = n * (n - 1);
    const selectionLine = t(
      'race_schedule.selection.tritan_nagashi3',
      {
        betType: betTypeLabel('tritan', loc),
        mode: t('bet_flow.tritan_modes.nagashi3', null, loc),
        axis: formatNamesByNums(result, [axis], loc),
        opp: formatNamesByNums(result, opp, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_tritan_nagashi3_opp|${raceId}`,
        placeholder: ph('opponent_pick', loc),
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: opp,
      },
    });
    return;
  }

  // 29) 3連単 1・2着ながし: 1着 -> 2着 -> 3着相手
  if (customId.startsWith('race_bet_tritan_n12_a1|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const a1 = interaction.values[0];
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { tritanN12A1: a1 });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_tritan_n12_a2|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_pick_second', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('umatan_place_2', loc),
          options,
          minValues: 1,
          maxValues: 1,
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }
  if (customId.startsWith('race_bet_tritan_n12_a2|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const a2 = interaction.values[0];
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { tritanN12A2: a2 });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_tritan_n12_opp3|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_opp_third_multi', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('opp_3rd_multi', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }
  if (customId.startsWith('race_bet_tritan_n12_opp3|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const opp3 = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const a1 = flow.tritanN12A1;
    const a2 = flow.tritanN12A2;
    const betType = 'tritan';
    const points = a1 === a2 ? 0 : distinctCountExcluding(opp3, [a1, a2]);
    const selectionLine = t(
      'race_schedule.selection.tritan_n12',
      {
        betType: betTypeLabel('tritan', loc),
        mode: t('bet_flow.tritan_modes.nagashi12', null, loc),
        a1: formatNamesByNums(result, [a1], loc),
        a2: formatNamesByNums(result, [a2], loc),
        opp: formatNamesByNums(result, opp3, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_tritan_n12_opp3|${raceId}`,
        placeholder: ph('opp_3rd_multi', loc),
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: opp3,
      },
    });
    return;
  }

  // 30) 3連単 1・3着ながし: 1着 -> 3着 -> 2着相手
  if (customId.startsWith('race_bet_tritan_n13_a1|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const a1 = interaction.values[0];
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { tritanN13A1: a1 });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_tritan_n13_a3|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_pick_third_plain', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('tritan_place_3', loc),
          options,
          minValues: 1,
          maxValues: 1,
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }
  if (customId.startsWith('race_bet_tritan_n13_a3|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const a3 = interaction.values[0];
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { tritanN13A3: a3 });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_tritan_n13_opp2|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_opp_second_multi', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('opp_2nd_multi', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }
  if (customId.startsWith('race_bet_tritan_n13_opp2|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const opp2 = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const a1 = flow.tritanN13A1;
    const a3 = flow.tritanN13A3;
    const betType = 'tritan';
    const points = a1 === a3 ? 0 : distinctCountExcluding(opp2, [a1, a3]);
    const selectionLine = t(
      'race_schedule.selection.tritan_n13',
      {
        betType: betTypeLabel('tritan', loc),
        mode: t('bet_flow.tritan_modes.nagashi13', null, loc),
        a1: formatNamesByNums(result, [a1], loc),
        a3: formatNamesByNums(result, [a3], loc),
        opp: formatNamesByNums(result, opp2, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_tritan_n13_opp2|${raceId}`,
        placeholder: ph('opp_2nd_multi', loc),
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: opp2,
      },
    });
    return;
  }

  // 31) 3連単 2・3着ながし: 2着 -> 3着 -> 1着相手
  if (customId.startsWith('race_bet_tritan_n23_a2|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const a2 = interaction.values[0];
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { tritanN23A2: a2 });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_tritan_n23_a3|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_pick_third_plain', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('tritan_place_3', loc),
          options,
          minValues: 1,
          maxValues: 1,
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }
  if (customId.startsWith('race_bet_tritan_n23_a3|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const a3 = interaction.values[0];
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { tritanN23A3: a3 });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_tritan_n23_opp1|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_opp_first_multi', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('opp_1st_multi', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }
  if (customId.startsWith('race_bet_tritan_n23_opp1|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const opp1 = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const a2 = flow.tritanN23A2;
    const a3 = flow.tritanN23A3;
    const betType = 'tritan';
    const points = a2 === a3 ? 0 : distinctCountExcluding(opp1, [a2, a3]);
    const selectionLine = t(
      'race_schedule.selection.tritan_n23',
      {
        betType: betTypeLabel('tritan', loc),
        mode: t('bet_flow.tritan_modes.nagashi23', null, loc),
        a2: formatNamesByNums(result, [a2], loc),
        a3: formatNamesByNums(result, [a3], loc),
        opp: formatNamesByNums(result, opp1, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_tritan_n23_opp1|${raceId}`,
        placeholder: ph('opp_1st_multi', loc),
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: opp1,
      },
    });
    return;
  }

  // 32) 3連単 ボックス
  if (customId.startsWith('race_bet_tritan_box|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const picks = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const betType = 'tritan';
    const uniq = uniqValues(picks).length;
    const points = uniq * (uniq - 1) * (uniq - 2);
    const selectionLine = t(
      'race_schedule.selection.tritan_box',
      {
        betType: betTypeLabel('tritan', loc),
        mode: t('bet_flow.tritan_modes.box', null, loc),
        horses: formatNamesByNums(result, picks, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_tritan_box|${raceId}`,
        placeholder: ph('horses_multi_short', loc),
        options,
        minValues: 3,
        maxValues: Math.min(options.length, 25),
        defaultValues: picks,
      },
    });
    return;
  }

  // 33) 3連単 フォーメーション A -> B -> C
  if (customId.startsWith('race_bet_tritan_formA|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const formA = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { tritanFormA: formA });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_tritan_formB|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_form_b_group', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('tritan_form_group2_place', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }
  if (customId.startsWith('race_bet_tritan_formB|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const formB = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    patchBetFlow(userId, raceId, { tritanFormB: formB });
    const result = flow.result;
    const options = horseOptionsFromResult(result);
    const lastId = `race_bet_tritan_formC|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: t('race_schedule.headlines.tritan_form_c_group', null, loc),
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: ph('tritan_form_group3_place', loc),
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi, loc),
        scheduleRaceListBackIfScheduled(userId, raceId, loc),
        ].filter(Boolean),
        }),
      );
    return;
  }
  if (customId.startsWith('race_bet_tritan_formC|')) {
    await interaction.deferUpdate();
    const raceId = customId.split('|')[1];
    const formC = interaction.values;
    const flow = getBetFlow(userId, raceId);
    if (!flow?.result) return;
    const result = flow.result;
    const formA = flow.tritanFormA || [];
    const formB = flow.tritanFormB || [];
    const betType = 'tritan';
    const points = countOrderedTriplesDistinct(formA, formB, formC);
    const selectionLine = t(
      'race_schedule.selection.tritan_form',
      {
        betType: betTypeLabel('tritan', loc),
        mode: t('bet_flow.tritan_modes.formation', null, loc),
        a: formatNamesByNums(result, formA, loc),
        b: formatNamesByNums(result, formB, loc),
        c: formatNamesByNums(result, formC, loc),
      },
      loc,
    );

    const options = horseOptionsFromResult(result);
    await renderFinalSelection({
      interaction,
      userId,
      raceId,
      result,
      betType,
      selectionLine,
      points,
      flowUnitYen: flow.unitYen,
      lastMenu: {
        customId: `race_bet_tritan_formC|${raceId}`,
        placeholder: ph('tritan_form_group3_place', loc),
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: formC,
      },
    });
    return;
  }
}
