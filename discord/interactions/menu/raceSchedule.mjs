import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import NetkeibaScraper from '../../../cheerio/netkeibaScraper.mjs';
import {
  fetchRaceListSub,
  parseRaceListSub,
  filterVenueRaces,
  getRaceSalesStatus,
  findRaceMetaForToday,
  fetchNarRaceListSub,
  parseNarRaceListSubToVenue,
  fetchTodayVenuesAndRaces,
  fetchNarTodayVenuesAndRaces,
  fetchNarVenuesForDate,
} from '../../../cheerio/netkeibaSchedule.mjs';
import { netkeibaResultUrl, netkeibaOriginFromFlow } from '../../utils/netkeibaUrls.mjs';
import {
  buildRaceCardV2Payload,
  buildRaceResultV2Payload,
  buildTextAndRowsV2Payload,
} from '../../utils/raceCardDisplay.mjs';
import { canBypassSalesClosed } from '../../utils/raceDebugBypass.mjs';
import {
  selectHorseLabel,
  selectFrameLabel,
  wakuUmaEmoji,
  wakuUmaEmojiResolvable,
  DISCORD_SELECT_OPTION_LABEL_RESERVE_POST_SELECTION,
} from '../../utils/raceNumberEmoji.mjs';
import { getBetFlow, setBetFlow, patchBetFlow, clearBetFlow } from '../../utils/betFlowStore.mjs';
import { getSlipSavedCount } from '../../utils/betSlipStore.mjs';
import {
  BET_SLIP_OPEN_CUSTOM_ID,
  RACE_PURCHASE_HISTORY_CUSTOM_ID,
  betSlipOpenReviewButtonRowForSchedule,
  firstScheduleAnchorRaceIdFromRaces,
  firstScheduleAnchorRaceIdFromVenues,
} from '../../utils/betSlipViewUi.mjs';
import {
  buildMenuRowFromCustomId,
  buildBetTypeMenuRow,
} from '../button/betFlowButtons.mjs';
import {
  SCHEDULE_KIND_MENU_ID,
  scheduleBackToKindSelectButtonRow,
} from '../../utils/scheduleKindUi.mjs';
import {
  filterBetTypesForJraSale,
  isJraBetTypeAllowedForFlow,
} from '../../utils/jraBetAvailability.mjs';
import { buildPayoutTicketsFromFlow } from '../../utils/raceBetTickets.mjs';
import { settleOpenRaceBetsForUser } from '../../utils/raceBetRecords.mjs';
import { buildVenuePickIntroV2Payload } from '../../utils/raceCommandHub.mjs';

const VENUE_MENU_ID = 'race_menu_venue';
const RACE_MENU_ID = 'race_menu_race';

function v2ExtraFlags(interaction) {
  try {
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      return MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }
  return 0;
}

function raceCardPayload(interaction, opts) {
  const rid = opts.result?.raceId;
  const uid = interaction.user?.id;
  const utilityContext =
    uid && rid && /^\d{12}$/.test(String(rid))
      ? { userId: uid, flow: getBetFlow(uid, String(rid)) }
      : null;
  return buildRaceCardV2Payload({
    ...opts,
    utilityContext,
  });
}

const BET_TYPE_MENU_PREFIX = 'race_bet_type|'; // raceId is appended after |
const BET_PREFIX = 'race_bet_';
/** 買い目まとめ確認用（betSlipMenu.mjs で処理。ここではベットフロー扱いしない） */
const BET_SLIP_MENU_PREFIX = 'race_bet_slip_';

// 直前に「開催場」を選んだ情報（ユーザーごと）
// 開催場->レース一覧->出馬表の「1段戻る」を実現するために使う
const venueSelectionStore = new Map(); // userId -> { source?: 'jra'|'nar', kaisaiDate, currentGroup, kaisaiId }

// /race メニューから選ばれたときだけ「結果（確定）」の有無を保持する
// userId|raceId -> boolean
const raceResultFlagStore = new Map();

const BET_TYPES = [
  { id: 'win', label: '単勝' },
  { id: 'place', label: '複勝' },
  { id: 'win_place', label: '単勝+複勝' },
  { id: 'frame_pair', label: '枠連' },
  { id: 'horse_pair', label: '馬連' },
  { id: 'wide', label: 'ワイド' },
  { id: 'umatan', label: '馬単' },
  { id: 'trifuku', label: '3連複' },
  { id: 'tritan', label: '3連単' },
];

const BET_TYPE_LABEL = Object.fromEntries(BET_TYPES.map((x) => [x.id, x.label]));

// ===== Bet points / total estimate =====
// 1点あたりの金額はベットフローごとに編集可能
const DEFAULT_UNIT_YEN = 100;

function formatBetPoints(points, unitYen = DEFAULT_UNIT_YEN) {
  const yen = points * unitYen;
  return `点数: ${points}点 | 合計: ${yen} bp（${unitYen} bp/点）`;
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

const PAIR_MODE_OPTIONS = [
  { id: 'normal', label: '通常' },
  { id: 'nagashi', label: 'ながし' },
  { id: 'box', label: 'ボックス' },
  { id: 'formation', label: 'フォーメーション' },
];

const UMATAN_MODE_OPTIONS = [
  { id: 'normal', label: '通常' },
  { id: 'nagashi1', label: '1着ながし' },
  { id: 'nagashi2', label: '2着ながし' },
  { id: 'box', label: 'ボックス' },
  { id: 'formation', label: 'フォーメーション' },
];

const TRIFUKU_MODE_OPTIONS = [
  { id: 'normal', label: '通常' },
  { id: 'nagashi1', label: '軸1頭ながし' },
  { id: 'nagashi2', label: '軸2頭ながし' },
  { id: 'box', label: 'ボックス' },
  { id: 'formation', label: 'フォーメーション' },
];

const TRITAN_MODE_OPTIONS = [
  { id: 'normal', label: '通常' },
  { id: 'nagashi1', label: '1着ながし' },
  { id: 'nagashi2', label: '2着ながし' },
  { id: 'nagashi3', label: '3着ながし' },
  { id: 'nagashi12', label: '1・2着ながし' },
  { id: 'nagashi13', label: '1・3着ながし' },
  { id: 'nagashi23', label: '2・3着ながし' },
  { id: 'box', label: 'ボックス' },
  { id: 'formation', label: 'フォーメーション' },
];

function raceSelectRow(kaisaiDateYmd, races) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(RACE_MENU_ID)
    .setPlaceholder('レースを選択（出馬表を表示）')
    .addOptions(
      races.slice(0, 25).map((r) => {
        const st = getRaceSalesStatus(r, kaisaiDateYmd);
        const label = `${r.roundLabel} ${r.timeText}`.replace(/\s+/g, ' ').trim().slice(0, 100);
        const desc = `${st.shortLabel} · ${r.title}`.slice(0, 100);
        return new StringSelectMenuOptionBuilder()
          .setLabel(label || r.raceId)
          // RACE_MENU_ID 側で「確定/発売前」を判定するため、isResult を一緒に渡す
          .setValue(`${r.raceId}|${r.isResult ? 1 : 0}`)
          .setDescription(desc);
      }),
    );
  return new ActionRowBuilder().addComponents(menu);
}

function scheduleBackToVenueButtonRow(kaisaiDateYmd, currentGroup, scheduleKind = 'jra') {
  const pad = scheduleKind === 'nar' ? '_' : currentGroup;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_sched_back_to_venue|${scheduleKind}|${kaisaiDateYmd}|${pad}`)
      .setLabel('開催場へ')
      .setStyle(ButtonStyle.Secondary),
  );
}

function venueSelectRowFromSchedule(scheduleKind, kaisaiDate, currentGroup, venues) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(VENUE_MENU_ID)
    .setPlaceholder('開催場を選択')
    .addOptions(
      venues.slice(0, 25).map((v) => {
        const value =
          scheduleKind === 'nar'
            ? `nar|${kaisaiDate}|${v.kaisaiId}`
            : `jra|${kaisaiDate}|${currentGroup}|${v.kaisaiId}`;
        const prefix = scheduleKind === 'nar' ? '[地方] ' : '';
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${prefix}${v.title}`.slice(0, 100))
          .setValue(value)
          .setDescription(`全${v.races.length}レース`.slice(0, 100));
      }),
    );
  return new ActionRowBuilder().addComponents(menu);
}

function scheduleBackToRaceListButtonRow(raceId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_sched_back_to_race_list|${raceId}`)
      .setLabel('レース一覧へ')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** /race 経由で開催情報があるときだけ、レース一覧に戻る行を付ける（メニューの下に並べる） */
function scheduleRaceListBackIfScheduled(userId, raceId) {
  const f = getBetFlow(userId, raceId);
  if (!f?.kaisaiDate || !f?.kaisaiId) return null;
  if (f.source === 'nar') return scheduleBackToRaceListButtonRow(raceId);
  if (f.currentGroup != null && String(f.currentGroup).length > 0) {
    return scheduleBackToRaceListButtonRow(raceId);
  }
  return null;
}

function betTypeSelectRow(raceId, selectedBetTypeId = null, flow = null) {
  const types = filterBetTypesForJraSale(BET_TYPES, {
    source: flow?.source,
    result: flow?.result,
  });
  const selRaw = selectedBetTypeId != null ? String(selectedBetTypeId) : null;
  const sel = selRaw && types.some((t) => t.id === selRaw) ? selRaw : null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${BET_TYPE_MENU_PREFIX}${raceId}`)
    .setPlaceholder('賭ける方式を選択')
    .addOptions(
      types.map((t) => {
        const o = new StringSelectMenuOptionBuilder()
          .setLabel(t.label)
          .setValue(t.id)
          .setDescription('選択後に馬番/枠番を指定します');
        if (sel && t.id === sel) o.setDefault(true);
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

/** 購入サマリー下部: 金額変更・購入予定に追加・購入予定（=まとめて確認）・追加済みクリア、その下に戻る・レース一覧 */
function summaryPurchaseButtonRows(raceId, userId, backMenuIndex, flow = null) {
  const savedN = getSlipSavedCount(userId);
  const hasCurrent = !!(flow?.purchase?.selectionLine);
  const batchTotal = savedN + (hasCurrent ? 1 : 0);
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`race_bet_unit_edit|${raceId}`)
        .setLabel('金額変更')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`race_bet_add_to_cart|${raceId}`)
        .setLabel('購入予定に追加')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${RACE_PURCHASE_HISTORY_CUSTOM_ID}|${raceId}`)
        .setLabel('購入履歴')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${BET_SLIP_OPEN_CUSTOM_ID}|${raceId}`)
        .setLabel(batchTotal ? `購入予定(${batchTotal})` : '購入予定')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`race_bet_cart_clear|${raceId}`)
        .setLabel('追加済みを空にする')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(savedN === 0),
    ),
  ];
  const br = backButtonRow(raceId, backMenuIndex);
  if (br) rows.push(br);
  const sched = scheduleRaceListBackIfScheduled(userId, raceId);
  if (sched) rows.push(sched);
  return rows;
}

function backButtonRow(raceId, backMenuIndex) {
  const idx = Number(backMenuIndex);
  if (!Number.isFinite(idx) || idx < 1) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_bet_back|${raceId}`)
      .setLabel('戻る')
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
  const flow = getBetFlow(userId, raceId);
  const purch = flow?.purchase;
  if (!purch?.lastMenuCustomId || !flow?.result) {
    await interaction.editReply(
      buildTextAndRowsV2Payload({
        headline: '❌ サマリーを再表示できませんでした。',
        actionRows: [],
        extraFlags: v2ExtraFlags(interaction),
      }),
    );
    return;
  }

  const result = flow.result;
  const betType = flow.betType;
  const { selectionLine, points, lastMenuCustomId } = purch;
  const unitYen = flow.unitYen ?? DEFAULT_UNIT_YEN;

  const backMenuIds = computeBackMenuIds({
    raceId,
    flow,
    betType,
    lastMenuCustomId,
  });
  const backMenuIndex = backMenuIds.lastIndexOf(lastMenuCustomId);

  const isResult = !!result?.isResult;
  const origin = netkeibaOriginFromFlow(flow);
  const resultUrl = isResult ? netkeibaResultUrl(raceId, origin) : null;

  const content = `${selectionLine}\n${formatBetPoints(points, unitYen)}${
    resultUrl ? `\n結果: ${resultUrl}` : ''
  }`;

  const betTypeMenuId = `race_bet_type|${raceId}`;
  const summaryMenuRows = [];
  for (const menuId of backMenuIds) {
    const row =
      menuId === betTypeMenuId
        ? buildBetTypeMenuRow(raceId, flow)
        : buildMenuRowFromCustomId({
            menuCustomId: menuId,
            flow,
            result,
          });
    if (row) summaryMenuRows.push(row);
  }

  await interaction.editReply(
    buildTextAndRowsV2Payload({
      headline: content,
      actionRows: [
        ...summaryMenuRows,
        ...summaryPurchaseButtonRows(raceId, userId, backMenuIndex, flow),
      ].filter(Boolean),
      extraFlags: v2ExtraFlags(interaction),
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
  const currentFlow = getBetFlow(userId, raceId) || {};

  const backMenuIds = computeBackMenuIds({
    raceId,
    flow: currentFlow,
    betType,
    lastMenuCustomId: lastMenu.customId,
  });
  const backMenuIndex = backMenuIds.lastIndexOf(lastMenu.customId);

  const unitYen = flowUnitYen ?? DEFAULT_UNIT_YEN;
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
        selectionLine,
        points,
        lastMenuCustomId: lastMenu.customId,
      },
    },
    raceId,
  );
  patchBetFlow(userId, raceId, {
    betType,
    unitYen,
    purchase: {
      selectionLine,
      points,
      lastMenuCustomId: lastMenu.customId,
      tickets,
    },
    stepSelections: nextStepSelections,
    lastSelectionLine: selectionLine,
    backMenuIds,
    backMenuIndex: backMenuIndex >= 0 ? backMenuIndex : backMenuIds.length - 1,
    navViewMenuIndex: null,
    purchaseSnapshot: null,
  });

  const isResult = !!result?.isResult;
  const flowForOrigin = getBetFlow(userId, raceId) || {};
  const origin = netkeibaOriginFromFlow(flowForOrigin);
  const resultUrl = isResult ? netkeibaResultUrl(raceId, origin) : null;

  const content = `${selectionLine}\n${formatBetPoints(points, unitYen)}${
    resultUrl ? `\n結果: ${resultUrl}` : ''
  }`;

  const flowAfter = getBetFlow(userId, raceId);
  const betTypeMenuId = `race_bet_type|${raceId}`;
  const summaryMenuRows = [];
  for (const menuId of backMenuIds) {
    const row =
      menuId === betTypeMenuId
        ? buildBetTypeMenuRow(raceId, flowAfter)
        : buildMenuRowFromCustomId({
            menuCustomId: menuId,
            flow: flowAfter,
            result,
          });
    if (row) summaryMenuRows.push(row);
  }

  await interaction.editReply(
    buildTextAndRowsV2Payload({
      headline: content,
      actionRows: [
        ...summaryMenuRows,
        ...summaryPurchaseButtonRows(raceId, userId, backMenuIndex, flowAfter),
      ].filter(Boolean),
      extraFlags: v2ExtraFlags(interaction),
    }),
  );
}

function horseOptionsFromResult(result, cap = 25) {
  const unique = new Map(); // horseNumber -> horse
  for (const h of result.horses || []) {
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

function frameOptionsFromResult(result, cap = 25) {
  const counts = new Map();
  const frameToHorses = new Map();
  for (const h of result.horses || []) {
    const f = String(h.frameNumber);
    counts.set(f, (counts.get(f) || 0) + 1);
    if (!frameToHorses.has(f)) frameToHorses.set(f, []);
    frameToHorses.get(f).push(h);
  }
  const arr = Array.from(counts.entries())
    .map(([frame, count]) => ({ frame, count, horses: frameToHorses.get(frame) }))
    .sort((a, b) => Number(a.frame) - Number(b.frame))
    .slice(0, cap);

  return arr.map(({ frame, count, horses }) => {
    const firstHorseName = horses?.[0]?.name || '';
    const f = parseInt(String(frame).replace(/\D/g, ''), 10);
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(selectFrameLabel(frame, '', DISCORD_SELECT_OPTION_LABEL_RESERVE_POST_SELECTION))
      .setValue(frame)
      .setDescription(`${count}頭${firstHorseName ? `（例: ${firstHorseName}）` : ''}`.slice(0, 70));
    const em = Number.isFinite(f) ? wakuUmaEmojiResolvable(f, f) : null;
    if (em) opt.setEmoji({ id: em.id, name: em.name });
    return opt;
  });
}

function horseNameByNum(result) {
  const m = new Map();
  for (const h of result.horses || []) m.set(String(h.horseNumber), h.name);
  return m;
}

function frameLabelToHorses(result) {
  const m = new Map();
  for (const h of result.horses || []) {
    const f = String(h.frameNumber);
    if (!m.has(f)) m.set(f, []);
    m.get(f).push(h);
  }
  return m;
}

function formatNamesByNums(result, nums) {
  const byKey = new Map();
  for (const h of result.horses || []) {
    byKey.set(String(h.horseNumber), h);
    const k = parseInt(String(h.horseNumber).replace(/\D/g, ''), 10);
    if (Number.isFinite(k)) byKey.set(String(k), h);
  }
  const nameMap = horseNameByNum(result);
  return nums
    .map((n) => {
      const ns = String(n);
      const kn = parseInt(ns.replace(/\D/g, ''), 10);
      const horse = byKey.get(ns) ?? (Number.isFinite(kn) ? byKey.get(String(kn)) : null);
      const nm = horse?.name || nameMap.get(ns) || '不明';
      const em = horse ? wakuUmaEmoji(horse.frameNumber, horse.horseNumber) : null;
      if (em) return `${em} ${nm}`.trim();
      return `${n}. ${nm}`;
    })
    .join(', ');
}

function formatFrames(result, frames) {
  const map = frameLabelToHorses(result);
  return frames
    .map((f) => {
      const horses = map.get(String(f)) || [];
      const example = horses?.[0]?.name;
      return `枠${f}${example ? `(${example})` : ''}`;
    })
    .join(', ');
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
    customId !== SCHEDULE_KIND_MENU_ID &&
    !isScheduleBetSelect
  )
    return;

  const userId = interaction.user?.id;

  // 0) /race 直後: 中央 / 地方
  if (customId === SCHEDULE_KIND_MENU_ID) {
    await interaction.deferUpdate();
    const kind = interaction.values[0];
    try {
      if (kind === 'jra') {
        const { venues, kaisaiDateYmd, currentGroup } = await fetchTodayVenuesAndRaces();
        if (!venues.length) {
          await interaction.editReply(
            buildTextAndRowsV2Payload({
              headline: '❌ 本日の中央開催データが取得できませんでした。',
              actionRows: [],
              extraFlags: v2ExtraFlags(interaction),
            }),
          );
          return;
        }
        await interaction.editReply(
          await buildVenuePickIntroV2Payload({
            userId,
            extraFlags: v2ExtraFlags(interaction),
            actionRows: [
              venueSelectRowFromSchedule('jra', kaisaiDateYmd, currentGroup, venues),
              scheduleBackToKindSelectButtonRow(),
              betSlipOpenReviewButtonRowForSchedule(
                userId,
                firstScheduleAnchorRaceIdFromVenues(venues),
              ),
            ],
          }),
        );
        return;
      }
      if (kind === 'nar') {
        const { venues, kaisaiDateYmd } = await fetchNarTodayVenuesAndRaces();
        if (!venues.length) {
          await interaction.editReply(
            buildTextAndRowsV2Payload({
              headline: '❌ 本日の地方開催データが取得できませんでした。',
              actionRows: [],
              extraFlags: v2ExtraFlags(interaction),
            }),
          );
          return;
        }
        await interaction.editReply(
          await buildVenuePickIntroV2Payload({
            userId,
            extraFlags: v2ExtraFlags(interaction),
            actionRows: [
              venueSelectRowFromSchedule('nar', kaisaiDateYmd, null, venues),
              scheduleBackToKindSelectButtonRow(),
              betSlipOpenReviewButtonRowForSchedule(
                userId,
                firstScheduleAnchorRaceIdFromVenues(venues),
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
          headline: `❌ 開催一覧の取得に失敗: ${e.message}`,
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
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
            headline: '❌ メニュー値が不正です。もう一度 /race から試してください。',
            actionRows: [],
            extraFlags: v2ExtraFlags(interaction),
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
            headline: '❌ メニュー値が不正です。もう一度 /race から試してください。',
            actionRows: [],
            extraFlags: v2ExtraFlags(interaction),
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
          headline: '❌ メニュー値が不正です。もう一度 /race から試してください。',
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
        }),
      );
      return;
    }

    try {
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
      if (!races.length) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: '❌ その開催場のレースが見つかりませんでした。',
            actionRows: [],
            extraFlags: v2ExtraFlags(interaction),
          }),
        );
        return;
      }
      for (const r of races) {
        raceResultFlagStore.set(`${userId}|${r.raceId}`, !!r.isResult);
      }
      const lines = races.map((r) => {
        const st = getRaceSalesStatus(r, kaisaiDate);
        return `**${r.roundLabel}** ${r.timeText} — ${r.title}\n└ ${st.detail}`;
      });
      let description = lines.join('\n\n');
      if (description.length > 4090) description = `${description.slice(0, 4087)}…`;

      const headline = [
        '🏇 **レース一覧**',
        '',
        description,
        '',
        `開催日 ${kaisaiDate}（日本時間）`,
      ].join('\n');

      const vs = venueSelectionStore.get(userId);
      const backKind = vs?.source || scheduleKind;
      const backGroup = backKind === 'nar' ? '_' : currentGroup;

      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline,
          actionRows: [
            raceSelectRow(kaisaiDate, races),
            scheduleBackToVenueButtonRow(kaisaiDate, backGroup, backKind),
            betSlipOpenReviewButtonRowForSchedule(
              userId,
              firstScheduleAnchorRaceIdFromRaces(races),
            ),
          ],
          extraFlags: v2ExtraFlags(interaction),
        }),
      );
    } catch (e) {
      console.error(e);
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: `❌ ${e.message}`,
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
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
      const scraper = new NetkeibaScraper();
      const lastVenue = venueSelectionStore.get(userId);

      let raceMeta = null;
      let salesStatus = null;
      let metaFallback = null;
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
          } else {
            const html = await fetchRaceListSub(
              lastVenue.kaisaiDate,
              lastVenue.currentGroup,
            );
            const { venues } = parseRaceListSub(html, lastVenue.kaisaiDate);
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

      const flowCtx = lastVenue?.kaisaiId
        ? {
            kaisaiDate: lastVenue.kaisaiDate,
            currentGroup: lastVenue.currentGroup ?? null,
            kaisaiId: lastVenue.kaisaiId,
            source: lastVenue.source ?? 'jra',
          }
        : metaFallback?.scheduleKaisaiId
          ? {
              kaisaiDate: metaFallback.kaisaiDateYmd,
              currentGroup: metaFallback.currentGroup ?? null,
              kaisaiId: metaFallback.scheduleKaisaiId,
              source: metaFallback.source,
            }
          : {};

      const salesBypass = canBypassSalesClosed(userId);

      const resultSnap = await scraper.scrapeRaceResult(raceId);
      if (resultSnap.confirmed && !salesBypass) {
        let bpFooter = null;
        try {
          const pay = await settleOpenRaceBetsForUser(userId, raceId, resultSnap);
          if (pay.settled > 0 && pay.totalRefund > 0) {
            bpFooter = `**あなたの競馬払戻** +${pay.totalRefund} bp（残高 ${pay.balance} bp）`;
          } else if (pay.settled > 0) {
            bpFooter = `**あなたの競馬払戻** 該当なし（精算 ${pay.settled} 件・残高 ${pay.balance} bp）`;
          }
        } catch (e) {
          console.warn('settleOpenRaceBetsForUser', e);
        }
        setBetFlow(userId, raceId, {
          ...flowCtx,
          source: flowCtx.source || resultSnap.netkeibaOrigin || 'jra',
        });
        await interaction.editReply(
          buildRaceResultV2Payload({
            parsed: resultSnap,
            bpFooter,
            actionRows: [
              flowCtx.kaisaiId ? scheduleBackToRaceListButtonRow(raceId) : null,
            ].filter(Boolean),
            extraFlags: v2ExtraFlags(interaction),
          }),
        );
        return;
      }

      if (isResult && !salesBypass) {
        setBetFlow(userId, raceId, {
          ...flowCtx,
          source: flowCtx.source || 'jra',
        });
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline:
              '❌ レース結果の取得に失敗しました。時間をおいて再度お試しください。',
            actionRows: [
              flowCtx.kaisaiId ? scheduleBackToRaceListButtonRow(raceId) : null,
            ].filter(Boolean),
            extraFlags: v2ExtraFlags(interaction),
          }),
        );
        return;
      }

      if (salesStatus?.closed && !salesBypass) {
        setBetFlow(userId, raceId, {
          ...flowCtx,
          source: flowCtx.source || 'jra',
        });
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline:
              '⏳ 発売は締め切られています。レース結果の確定までお待ちください。',
            actionRows: [
              flowCtx.kaisaiId ? scheduleBackToRaceListButtonRow(raceId) : null,
            ].filter(Boolean),
            extraFlags: v2ExtraFlags(interaction),
          }),
        );
        return;
      }

      const result = await scraper.scrapeRaceCard(raceId);
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
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: '',
          actionRows: [
            betTypeSelectRow(raceId, betTypeDefault, flowAfter),
            flowCtx.kaisaiId ? scheduleBackToRaceListButtonRow(raceId) : null,
          ].filter(Boolean),
          extraFlags: v2ExtraFlags(interaction),
        }),
      );
    } catch (e) {
      console.error(e);
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: `❌ 出馬表の取得に失敗: ${e.message}`,
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
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
      const result = await scraper.scrapeRaceCard(raceId);
      setBetFlow(userId, raceId, { result });
      flow = getBetFlow(userId, raceId);
    }
    if (!isJraBetTypeAllowedForFlow(betType, flow)) {
      await interaction.editReply(
        raceCardPayload(interaction,{
          result: flow.result,
          headline:
            '❌ この出走頭数ではその券種は発売されません（JRAの発売頭数ルール）。別の券種を選んでください。',
          actionRows: [
            betTypeSelectRow(raceId, null, flow),
            scheduleRaceListBackIfScheduled(userId, raceId),
          ].filter(Boolean),
        }),
      );
      return;
    }
    patchBetFlow(userId, raceId, {
      betType,
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
          headline: `「${BET_TYPE_LABEL[betType]}」の馬番を選択してください。`,
          actionRows: [
        buildSelectionRow({
            customId: `race_bet_single_pick|${raceId}|${betType}`,
            placeholder: '馬番を1頭選択',
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, backMenuIndex),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: `「${BET_TYPE_LABEL[betType]}」の投票形式を選択してください。`,
          actionRows: [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(lastId)
              .setPlaceholder('投票形式を選択')
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(
                PAIR_MODE_OPTIONS.map((m) =>
                  new StringSelectMenuOptionBuilder()
                    .setLabel(m.label)
                    .setValue(m.id)
                    .setDescription('次で馬番/枠番を選びます'),
                ),
              ),
          ),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「馬単」の投票形式を選択してください。',
          actionRows: [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(lastId)
              .setPlaceholder('投票形式を選択')
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(
                UMATAN_MODE_OPTIONS.map((m) =>
                  new StringSelectMenuOptionBuilder()
                    .setLabel(m.label)
                    .setValue(m.id)
                    .setDescription('次で馬番を選びます'),
                ),
              ),
          ),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「3連複」の投票形式を選択してください。',
          actionRows: [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(lastId)
              .setPlaceholder('投票形式を選択')
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(
                TRIFUKU_MODE_OPTIONS.map((m) =>
                  new StringSelectMenuOptionBuilder()
                    .setLabel(m.label)
                    .setValue(m.id)
                    .setDescription('次で馬番を選びます'),
                ),
              ),
          ),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「3連単」の投票形式を選択してください。',
          actionRows: [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(lastId)
              .setPlaceholder('投票形式を選択')
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(
                TRITAN_MODE_OPTIONS.map((m) =>
                  new StringSelectMenuOptionBuilder()
                    .setLabel(m.label)
                    .setValue(m.id)
                    .setDescription('次で馬番を選びます'),
                ),
              ),
          ),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
        ].filter(Boolean),
        }),
      );
      return;
    }

    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: '❌ 未対応の賭け方式です。',
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
    if (!flow?.result) {
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: '❌ セッションが無効です。もう一度 /race から開始してください。',
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
        }),
      );
      return;
    }
    const result = flow.result;
    const horseText = formatNamesByNums(result, picks);
    const points = betType === 'win_place' ? 2 : 1;
    const selectionLine = `選択: ${BET_TYPE_LABEL[betType]} => ${horseText}`;

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
        placeholder: '馬番を1頭選択',
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
    const options = isFrame ? frameOptionsFromResult(result) : horseOptionsFromResult(result);

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
          headline: '「通常（枠連）」: 第1枠を1つ選択してください。',
          actionRows: [
        buildSelectionRow({
              customId: lastMenuCustomId,
              placeholder: '第1枠を選択',
              options,
              minValues: 1,
              maxValues: 1,
            }),
            backButtonRow(raceId, backMenuIndex),
            scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「通常」: 馬番を2つまで選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastMenuCustomId,
            placeholder: '馬番を選択（最大2）',
            options,
            minValues: 1,
            maxValues: 2,
          }),
          backButtonRow(raceId, backMenuIndex),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: `「ながし」: まず軸を${isFrame ? '枠' : '馬番'}で1つ選んでください。`,
          actionRows: [
        buildSelectionRow({
            customId: `race_bet_pair_nagashi_axis|${raceId}|${betType}`,
            placeholder: isFrame ? '軸の枠を選択' : '軸の馬番を選択',
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, backMenuIndex),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: `「ボックス」: ${isFrame ? '枠' : '馬番'}を必要数選択してください。`,
          actionRows: [
        buildSelectionRow({
            customId: `race_bet_pair_box|${raceId}|${betType}`,
            placeholder: isFrame ? '枠を選択' : '馬番を選択',
            options,
            minValues: 2,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, backMenuIndex),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: `「フォーメーション」: 第1群（${isFrame ? '枠' : '馬番'}）を選択してください。`,
          actionRows: [
        buildSelectionRow({
            customId: `race_bet_pair_formA|${raceId}|${betType}`,
            placeholder: `第1群${isFrame ? '枠' : '馬番'}`,
            options,
            minValues: 1,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, backMenuIndex),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
      const options = isFrame ? frameOptionsFromResult(result) : horseOptionsFromResult(result);
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
          headline: '❌ 通常は2つ選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastMenuCustomId,
            placeholder: isFrame ? '枠を選択（最大2）' : '馬番を選択（最大2）',
            options,
            minValues: 1,
            maxValues: 2,
          }),
          backButtonRow(raceId, backMenuIndex),
          scheduleRaceListBackIfScheduled(userId, raceId),
        ].filter(Boolean),
        }),
      );
      return;
    }

    const summary = isFrame ? `枠: ${formatFrames(result, picks)}` : `馬番: ${formatNamesByNums(result, picks)}`;
    const points = 1;
    const selectionLine = `選択: ${BET_TYPE_LABEL[betType]}（通常） => ${summary}`;

    const options = isFrame ? frameOptionsFromResult(result) : horseOptionsFromResult(result);
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
        placeholder: isFrame ? '枠を選択（最大2）' : '馬番を選択（最大2）',
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

    const options = frameOptionsFromResult(result);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: '次に第2枠を選択してください。',
          actionRows: [
        buildSelectionRow({
          customId: lastMenuCustomId,
          placeholder: '第2枠を選択',
          options,
          minValues: 1,
          maxValues: 1,
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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

    const points = 1;
    const selectionLine = `選択: 枠連（通常） => ${formatFrames(result, [first, second])}`;
    const options = frameOptionsFromResult(result);

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
        placeholder: '第2枠を選択',
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
    const options = isFrame ? frameOptionsFromResult(result) : horseOptionsFromResult(result);

    const lastMenuCustomId = `race_bet_pair_nagashi_opponent|${raceId}|${betType}`;
    const bi = setupHorseStepBack(userId, raceId, betType, lastMenuCustomId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: `「ながし」: 相手を${isFrame ? '枠' : '馬番'}で選択してください。`,
          actionRows: [
        buildSelectionRow({
          customId: lastMenuCustomId,
          placeholder: '相手を選択（複数可）',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
      ? `軸: ${formatFrames(result, [axis])} / 相手: ${formatFrames(result, opponents)}`
      : `軸: ${formatNamesByNums(result, [axis])} / 相手: ${formatNamesByNums(result, opponents)}`;
    const points = distinctCountExcluding(opponents, [axis]);
    const selectionLine = `選択: ${BET_TYPE_LABEL[betType]}（ながし） => ${summary}`;

    const options = isFrame ? frameOptionsFromResult(result) : horseOptionsFromResult(result);
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
        placeholder: '相手を選択（複数可）',
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

    const summary = isFrame ? `枠: ${formatFrames(result, picks)}` : `馬番: ${formatNamesByNums(result, picks)}`;
    const points = calcComb2(uniqValues(picks).length);
    const selectionLine = `選択: ${BET_TYPE_LABEL[betType]}（ボックス） => ${summary}`;

    const options = isFrame ? frameOptionsFromResult(result) : horseOptionsFromResult(result);
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
        placeholder: isFrame ? '枠を選択' : '馬番を選択',
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
    const options = isFrame ? frameOptionsFromResult(result) : horseOptionsFromResult(result);

    const lastMenuCustomId = `race_bet_pair_formB|${raceId}|${betType}`;
    const bi = setupHorseStepBack(userId, raceId, betType, lastMenuCustomId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: `「フォーメーション」: 第2群（${isFrame ? '枠' : '馬番'}）を選択してください。`,
          actionRows: [
        buildSelectionRow({
          customId: lastMenuCustomId,
          placeholder: `第2群${isFrame ? '枠' : '馬番'}`,
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
      ? `第1群: ${formatFrames(result, picksA)} / 第2群: ${formatFrames(result, picksB)}`
      : `第1群: ${formatNamesByNums(result, picksA)} / 第2群: ${formatNamesByNums(result, picksB)}`;
    const points = countUniquePairsUnordered(picksA, picksB);
    const selectionLine = `選択: ${BET_TYPE_LABEL[betType]}（フォーメーション） => ${summary}`;

    const options = isFrame ? frameOptionsFromResult(result) : horseOptionsFromResult(result);
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
        placeholder: `第2群${isFrame ? '枠' : '馬番'}`,
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
    patchBetFlow(userId, raceId, { betType: 'umatan', umatanMode: mode });
    const result = flow.result;
    const options = horseOptionsFromResult(result);

    if (mode === 'normal') {
      const lastId = `race_bet_umatan_normal_1|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'umatan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: '「馬単 通常」: まず1着を選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '1着（1頭）',
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「1着ながし」: 軸（1着）を選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '軸（1着）',
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「2着ながし」: 軸（2着）を選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '軸（2着）',
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「馬単 ボックス」: 馬番を必要数選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '馬番を選択（複数可）',
            options,
            minValues: 2,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「馬単 フォーメーション」: 第1群（1着候補）を選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '第1群（1着）',
            options,
            minValues: 1,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
    patchBetFlow(userId, raceId, { umatanFirst: one });
    const result = flow.result;
    const options = horseOptionsFromResult(result);

    const lastId = `race_bet_umatan_normal_2|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'umatan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: '次に2着を選択してください。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '2着（1頭）',
          options,
          minValues: 1,
          maxValues: 1,
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 馬単（通常） => 1着: ${formatNamesByNums(result, [first])} / 2着: ${formatNamesByNums(result, [two])}`;

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
        placeholder: '2着（1頭）',
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
          headline: '相手（2着）を選択してください（複数可）。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '相手（2着）',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 馬単（1着ながし） => 軸(1着): ${formatNamesByNums(result, [axis])} / 相手(2着): ${formatNamesByNums(result, opp)}`;

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
        placeholder: '相手（2着）',
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
          headline: '相手（1着）を選択してください（複数可）。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '相手（1着）',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 馬単（2着ながし） => 軸(2着): ${formatNamesByNums(result, [axis])} / 相手(1着): ${formatNamesByNums(result, opp)}`;

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
        placeholder: '相手（1着）',
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
    const selectionLine = `選択: 馬単（ボックス） => 馬番: ${formatNamesByNums(result, picks)}`;

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
        placeholder: '馬番を選択（複数可）',
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
    patchBetFlow(userId, raceId, { umatanFormA: picksA });
    const result = flow.result;
    const options = horseOptionsFromResult(result);

    const lastId = `race_bet_umatan_formB|${raceId}`;
    const bi = setupHorseStepBack(userId, raceId, 'umatan', lastId);
    await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: '第2群（2着候補）を選択してください。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '第2群（2着）',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 馬単（フォーメーション） => 1着群: ${formatNamesByNums(result, picksA)} / 2着群: ${formatNamesByNums(result, picksB)}`;

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
        placeholder: '第2群（2着）',
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
          headline: '「3連複 通常」: 馬番を3つ（3頭）選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '3頭を選択',
            options,
            minValues: 3,
            maxValues: 3,
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「軸1頭ながし」: 軸を1頭選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '軸（1頭）',
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「軸2頭ながし」: 軸を2頭選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '軸（2頭）',
            options,
            minValues: 2,
            maxValues: 2,
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「3連複 ボックス」: 馬番を必要数選択してください（3頭以上）。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '馬番（複数可）',
            options,
            minValues: 3,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「3連複 フォーメーション」: 第1群を選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '第1群',
            options,
            minValues: 1,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 3連複（通常） => ${formatNamesByNums(result, picks)}`;

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
        placeholder: '3頭を選択',
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
          headline: '相手（2頭分）を選択してください（複数可）。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '相手（複数可）',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 3連複（軸1頭ながし） => 軸: ${formatNamesByNums(result, [axis])} / 相手: ${formatNamesByNums(result, opp)}`;

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
        placeholder: '相手（複数可）',
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
          headline: '相手（残り1頭）を選択してください（複数可）。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '相手（複数可）',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 3連複（軸2頭ながし） => 軸: ${formatNamesByNums(result, axes)} / 相手: ${formatNamesByNums(result, opp)}`;

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
        placeholder: '相手（複数可）',
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
    const selectionLine = `選択: 3連複（ボックス） => ${formatNamesByNums(result, picks)}`;

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
        placeholder: '馬番（複数可）',
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
          headline: '第2群を選択してください。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '第2群',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '第3群を選択してください。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '第3群',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 3連複（フォーメーション） => A: ${formatNamesByNums(result, formA)} / B: ${formatNamesByNums(result, formB)} / C: ${formatNamesByNums(result, formC)}`;

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
        placeholder: '第3群',
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
    patchBetFlow(userId, raceId, { betType: 'tritan', tritanMode: mode });
    const result = flow.result;
    const options = horseOptionsFromResult(result);

    if (mode === 'normal') {
      const lastId = `race_bet_tritan_normal_1|${raceId}`;
      const bi = setupHorseStepBack(userId, raceId, 'tritan', lastId);
      await interaction.editReply(
        raceCardPayload(interaction,{
          result,
          headline: '「3連単 通常」: まず1着を選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '1着（1頭）',
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「1着ながし」: 軸（1着）を選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '軸（1着）',
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「2着ながし」: 軸（2着）を選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '軸（2着）',
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「3着ながし」: 軸（3着）を選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '軸（3着）',
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「1・2着ながし」: まず1着を選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '1着（1頭）',
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「1・3着ながし」: まず1着を選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '1着（1頭）',
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「2・3着ながし」: まず2着を選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '2着（1頭）',
            options,
            minValues: 1,
            maxValues: 1,
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「3連単 ボックス」: 馬番を必要数選択してください（3頭以上）。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '馬番（複数可）',
            options,
            minValues: 3,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '「3連単 フォーメーション」: 第1群（1着候補）を選択してください。',
          actionRows: [
        buildSelectionRow({
            customId: lastId,
            placeholder: '第1群（1着）',
            options,
            minValues: 1,
            maxValues: Math.min(options.length, 25),
          }),
          backButtonRow(raceId, bi),
          scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '次に2着を選択してください。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '2着（1頭）',
          options,
          minValues: 1,
          maxValues: 1,
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '最後に3着を選択してください。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '3着（1頭）',
          options,
          minValues: 1,
          maxValues: 1,
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 3連単（通常） => 1着: ${formatNamesByNums(result, [first])} / 2着: ${formatNamesByNums(result, [second])} / 3着: ${formatNamesByNums(result, [third])}`;

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
        placeholder: '3着（1頭）',
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
          headline: '相手（2着・3着）を選択してください（複数可）。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '相手',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 3連単（1着ながし） => 軸: ${formatNamesByNums(result, [axis])} / 相手: ${formatNamesByNums(result, opp)}`;

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
        placeholder: '相手',
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
          headline: '相手（1着・3着）を選択してください（複数可）。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '相手',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 3連単（2着ながし） => 軸: ${formatNamesByNums(result, [axis])} / 相手: ${formatNamesByNums(result, opp)}`;

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
        placeholder: '相手',
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
          headline: '相手（1着・2着）を選択してください（複数可）。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '相手',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 3連単（3着ながし） => 軸: ${formatNamesByNums(result, [axis])} / 相手: ${formatNamesByNums(result, opp)}`;

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
        placeholder: '相手',
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
          headline: '次に2着を選択してください。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '2着（1頭）',
          options,
          minValues: 1,
          maxValues: 1,
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '次に3着（相手）を選択してください（複数可）。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '3着相手',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 3連単（1・2着ながし） => 1着: ${formatNamesByNums(result, [a1])} / 2着: ${formatNamesByNums(result, [a2])} / 3着相手: ${formatNamesByNums(result, opp3)}`;

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
        placeholder: '3着相手',
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
          headline: '次に3着を選択してください。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '3着（1頭）',
          options,
          minValues: 1,
          maxValues: 1,
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '次に2着（相手）を選択してください（複数可）。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '2着相手',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 3連単（1・3着ながし） => 1着: ${formatNamesByNums(result, [a1])} / 3着: ${formatNamesByNums(result, [a3])} / 2着相手: ${formatNamesByNums(result, opp2)}`;

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
        placeholder: '2着相手',
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
          headline: '次に3着を選択してください。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '3着（1頭）',
          options,
          minValues: 1,
          maxValues: 1,
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '次に1着（相手）を選択してください（複数可）。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '1着相手',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 3連単（2・3着ながし） => 2着: ${formatNamesByNums(result, [a2])} / 3着: ${formatNamesByNums(result, [a3])} / 1着相手: ${formatNamesByNums(result, opp1)}`;

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
        placeholder: '1着相手',
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
    const selectionLine = `選択: 3連単（ボックス） => ${formatNamesByNums(result, picks)}`;

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
        placeholder: '馬番（複数可）',
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
          headline: '第2群（2着候補）を選択してください。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '第2群（2着）',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
          headline: '第3群（3着候補）を選択してください。',
          actionRows: [
        buildSelectionRow({
          customId: lastId,
          placeholder: '第3群（3着）',
          options,
          minValues: 1,
          maxValues: Math.min(options.length, 25),
        }),
        backButtonRow(raceId, bi),
        scheduleRaceListBackIfScheduled(userId, raceId),
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
    const selectionLine = `選択: 3連単（フォーメーション） => 1着群: ${formatNamesByNums(result, formA)} / 2着群: ${formatNamesByNums(result, formB)} / 3着群: ${formatNamesByNums(result, formC)}`;

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
        placeholder: '第3群（3着）',
        options,
        minValues: 1,
        maxValues: Math.min(options.length, 25),
        defaultValues: formC,
      },
    });
    return;
  }
}
