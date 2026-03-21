import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} from 'discord.js';
import { getBetFlow, clearBetFlow, patchBetFlow } from '../../utils/betFlowStore.mjs';
import { buildBetPurchaseV2Headline } from '../../utils/betPurchaseEmbed.mjs';
import { buildRaceCardV2Payload, buildTextAndRowsV2Payload } from '../../utils/raceCardDisplay.mjs';
import {
  selectHorseLabel,
  selectFrameLabel,
  wakuUmaEmojiResolvable,
} from '../../utils/raceNumberEmoji.mjs';

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

function safeParseRaceId(customId) {
  // race_bet_purchase|{raceId} / race_bet_unit_edit|{raceId}
  const parts = customId.split('|');
  return parts[parts.length - 1] || null;
}

function scheduleRaceListBackRow(raceId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_sched_back_to_race_list|${raceId}`)
      .setLabel('レース一覧へ')
      .setStyle(ButtonStyle.Secondary),
  );
}

function hasScheduleContext(flow) {
  return !!(flow?.kaisaiDate && flow?.currentGroup && flow?.kaisaiId);
}

function shouldShowForwardNav(flow) {
  const ids = flow?.backMenuIds;
  if (!ids?.length) return false;
  const vi = flow.navViewMenuIndex;
  if (vi == null || vi < 0) return false;
  if (vi < ids.length - 1) return true;
  return !!(vi === ids.length - 1 && flow.purchaseSnapshot);
}

/**
 * 戻る導線で1メニューだけ表示するときの UI（戻る・進むは同一行、レース一覧は別行）
 */
export async function renderBetFlowResumeView(interaction, { userId, raceId, flow, viewIndex, headline }) {
  const backMenuIds = flow.backMenuIds || [];
  const betTypeMenuId = `race_bet_type|${raceId}`;
  const currentMenuCustomId = backMenuIds[viewIndex];
  const menuRow =
    currentMenuCustomId === betTypeMenuId
      ? buildBetTypeMenuRow(raceId, flow)
      : buildMenuRowFromCustomId({
          menuCustomId: currentMenuCustomId,
          flow,
          result: flow.result,
        });
  const components = [];
  if (menuRow) components.push(menuRow);
  else components.push(buildBetTypeMenuRow(raceId, flow));

  const nextIndex = viewIndex - 1;
  const showBack = viewIndex === 0 || nextIndex >= 0;
  const backBtn = new ButtonBuilder()
    .setCustomId(`race_bet_back|${raceId}`)
    .setLabel('戻る')
    .setStyle(ButtonStyle.Secondary);
  const forwardBtn = shouldShowForwardNav(flow)
    ? new ButtonBuilder()
        .setCustomId(`race_bet_forward|${raceId}`)
        .setLabel('進む')
        .setStyle(ButtonStyle.Success)
    : null;

  const navRowButtons = [];
  if (showBack) navRowButtons.push(backBtn);
  if (forwardBtn) navRowButtons.push(forwardBtn);
  if (navRowButtons.length) {
    components.push(new ActionRowBuilder().addComponents(...navRowButtons));
  }

  if (hasScheduleContext(flow)) {
    components.push(scheduleRaceListBackRow(raceId));
  }

  const h = headline ?? '購入前（戻り）';
  await interaction.editReply(
    buildRaceCardV2Payload({
      result: flow.result,
      headline: h,
      actionRows: components.filter(Boolean),
    }),
  );
}

export default async function betFlowButtons(interaction) {
  if (!interaction.isButton()) return;
  const customId = interaction.customId;
  if (
    !customId.startsWith('race_bet_purchase|') &&
    !customId.startsWith('race_bet_unit_edit|') &&
    !customId.startsWith('race_bet_back|') &&
    !customId.startsWith('race_bet_forward|')
  )
    return;

  const raceId = safeParseRaceId(customId);
  const userId = interaction.user.id;
  const flow = getBetFlow(userId, raceId);

  if (!flow) {
    await interaction.reply({ content: '❌ セッションが無効です。もう一度 /race から開始してください。', ephemeral: true });
    return;
  }

  // 購入（仮）確定
  if (customId.startsWith('race_bet_purchase|')) {
    if (!flow.purchase) {
      await interaction.reply({ content: '❌ 購入できません（選択が完了していません）。', ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    const headline = buildBetPurchaseV2Headline({ flow });
    clearBetFlow(userId, raceId);
    let extraFlags = 0;
    try {
      if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
        extraFlags |= MessageFlags.Ephemeral;
      }
    } catch (_) {
      /* ignore */
    }
    await interaction.editReply(
      buildTextAndRowsV2Payload({
        headline,
        actionRows: [],
        extraFlags,
      }),
    );
    return;
  }

  // 進む（戻り中に同じ選択のまま次へ / 最後は購入サマリーへ）
  if (customId.startsWith('race_bet_forward|')) {
    let flowFwd = getBetFlow(userId, raceId);
    if (!flowFwd) {
      await interaction.reply({
        content: '❌ セッションが無効です。もう一度 /race から試してください。',
        ephemeral: true,
      });
      return;
    }
    const backMenuIds = flowFwd.backMenuIds || [];
    const vi = flowFwd.navViewMenuIndex;
    if (vi == null || !backMenuIds.length) {
      await interaction.reply({
        content: '❌ ここからは進めません。',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferUpdate();

    const lastLine = flowFwd.lastSelectionLine ?? '';

    if (vi < backMenuIds.length - 1) {
      const newVi = vi + 1;
      patchBetFlow(userId, raceId, {
        navViewMenuIndex: newVi,
        backMenuIndex: newVi - 1,
        resumeBackFromSummary: true,
      });
      flowFwd = getBetFlow(userId, raceId);
      await renderBetFlowResumeView(interaction, {
        userId,
        raceId,
        flow: flowFwd,
        viewIndex: newVi,
        headline: lastLine ? `購入前（戻り）\n${lastLine}` : '購入前（戻り）',
      });
      return;
    }

    if (flowFwd.purchaseSnapshot) {
      patchBetFlow(userId, raceId, {
        purchase: { ...flowFwd.purchaseSnapshot },
        purchaseSnapshot: null,
        navViewMenuIndex: null,
        backMenuIndex: backMenuIds.length - 1,
        resumeBackFromSummary: false,
      });
      const { editReplyPurchaseSummaryFromFlow } = await import('../menu/raceSchedule.mjs');
      await editReplyPurchaseSummaryFromFlow(interaction, userId, raceId);
      return;
    }

    await renderBetFlowResumeView(interaction, {
      userId,
      raceId,
      flow: flowFwd,
      viewIndex: vi,
      headline: lastLine ? `購入前（戻り）\n${lastLine}` : '購入前（戻り）',
    });
    return;
  }

  // 戻る（多段）
  if (customId.startsWith('race_bet_back|')) {
    await interaction.deferUpdate();

    const backMenuIds = flow.backMenuIds || [];
    const currentIndex =
      flow.backMenuIndex !== undefined && flow.backMenuIndex !== null
        ? flow.backMenuIndex
        : backMenuIds.length - 1;

    const lastLine = flow.purchase?.selectionLine ?? flow.lastSelectionLine ?? '';

    // 二重クリック・不整合で index がルートより前 — 賭け方へ（エラーにしない）
    if (currentIndex < 0 || !backMenuIds.length) {
      patchBetFlow(userId, raceId, {
        purchase: null,
        purchaseSnapshot: null,
        lastSelectionLine: lastLine,
        backMenuIndex: -1,
        resumeBackFromSummary: false,
        navViewMenuIndex: null,
      });
      const flowRoot = getBetFlow(userId, raceId);
      const components = [buildBetTypeMenuRow(raceId, flowRoot)];
      if (hasScheduleContext(flowRoot)) {
        components.push(scheduleRaceListBackRow(raceId));
      }
      await interaction.editReply(
        buildRaceCardV2Payload({
          result: flowRoot.result,
          headline: lastLine ? `購入前（戻り）\n${lastLine}` : '購入前（戻り）',
          actionRows: components.filter(Boolean),
        }),
      );
      return;
    }

    const atPurchase = !!flow.purchase;
    const resumeBackFromSummary = flow.resumeBackFromSummary === true;
    // 購入サマリーからの1回目、またはその直後の連鎖では「今の index のメニュー」を開く。
    // それ以外（通常にセレクトで進んだ画面）は 1 回の戻るで親（賭け方を含む）へ進む。
    let displayIndex;
    let nextIndex;
    if (atPurchase || resumeBackFromSummary) {
      displayIndex = currentIndex;
      nextIndex = currentIndex - 1;
    } else {
      displayIndex = currentIndex - 1;
      nextIndex = currentIndex - 2;
    }

    if (displayIndex < 0) {
      displayIndex = 0;
      nextIndex = -1;
    }
    if (displayIndex >= backMenuIds.length) {
      displayIndex = backMenuIds.length - 1;
      nextIndex = Math.min(nextIndex, displayIndex - 1);
    }

    let nextResume = resumeBackFromSummary;
    if (atPurchase) {
      nextResume = true;
    } else if (displayIndex === 0 && nextIndex < 0) {
      nextResume = false;
    }

    patchBetFlow(userId, raceId, {
      purchase: null,
      purchaseSnapshot:
        atPurchase && flow.purchase ? { ...flow.purchase } : flow.purchaseSnapshot ?? null,
      lastSelectionLine: lastLine,
      backMenuIndex: nextIndex,
      resumeBackFromSummary: nextResume,
      navViewMenuIndex: displayIndex,
    });

    const flowAfter = getBetFlow(userId, raceId);
    await renderBetFlowResumeView(interaction, {
      userId,
      raceId,
      flow: flowAfter,
      viewIndex: displayIndex,
      headline: lastLine ? `購入前（戻り）\n${lastLine}` : '購入前（戻り）',
    });
    return;
  }

  // 単価編集（modal を開く）
  if (customId.startsWith('race_bet_unit_edit|')) {
    const modalRaceId = raceId;
    const existing = flow.unitYen ?? 100;

    const modal = new ModalBuilder()
      .setCustomId(`race_bet_unit_modal|${modalRaceId}`)
      .setTitle('1点単価を編集');

    const input = new TextInputBuilder()
      .setCustomId('unit_yen')
      .setLabel('1点あたりの金額（円）')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue(String(existing))
      .setMinLength(1)
      .setMaxLength(7);

    modal.addComponents(new ActionRowBuilder().addComponents(input));

    await interaction.showModal(modal);
  }
}

function defaultBetTypeIdFromFlow(raceId, flow) {
  if (!flow) return null;
  const fromSteps = flow.stepSelections?.[`race_bet_type|${raceId}`]?.[0];
  if (fromSteps) return String(fromSteps);
  if (flow.betType) return String(flow.betType);
  return null;
}

export function buildBetTypeMenuRow(raceId, flow = null) {
  const sel = defaultBetTypeIdFromFlow(raceId, flow);
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`race_bet_type|${raceId}`)
      .setPlaceholder('賭ける方式を選択')
      .addOptions(
        BET_TYPES.map((t) => {
          const o = new StringSelectMenuOptionBuilder()
            .setLabel(t.label)
            .setValue(t.id)
            .setDescription('選択後に馬番/枠番を指定します');
          if (sel && t.id === sel) o.setDefault(true);
          return o;
        }),
      ),
  );
}

function modeOptionsList(modeDefs, selectedId) {
  const sel = selectedId != null && selectedId !== '' ? String(selectedId) : null;
  return modeDefs.map((m) => {
    const o = new StringSelectMenuOptionBuilder()
      .setLabel(m.label)
      .setValue(m.id)
      .setDescription('次で馬番/枠番を選びます');
    if (sel && m.id === sel) o.setDefault(true);
    return o;
  });
}

function horseOptionsFromResult(result, selectedValues = [], cap = 25) {
  const selectedSet = new Set((selectedValues || []).map((v) => String(v)));
  const unique = new Map();
  for (const h of result.horses || []) unique.set(String(h.horseNumber), h);
  const arr = Array.from(unique.entries())
    .map(([num, horse]) => ({ num, horse }))
    .sort((a, b) => Number(a.num) - Number(b.num))
    .slice(0, cap);
  return arr.map(({ num, horse }) => {
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(selectHorseLabel(horse, ''))
      .setValue(String(num))
      .setDescription(`${horse.jockey}`.slice(0, 70));
    const em = wakuUmaEmojiResolvable(horse.frameNumber, horse.horseNumber);
    if (em) opt.setEmoji({ id: em.id, name: em.name });
    if (selectedSet.has(String(num))) opt.setDefault(true);
    return opt;
  });
}

function frameOptionsFromResult(result, selectedValues = [], cap = 25) {
  const selectedSet = new Set((selectedValues || []).map((v) => String(v)));
  const counts = new Map();
  const frameToHorses = new Map();
  for (const h of result.horses || []) {
    const f = String(h.frameNumber);
    counts.set(f, (counts.get(f) || 0) + 1);
    if (!frameToHorses.has(f)) frameToHorses.set(f, []);
    frameToHorses.get(f).push(h);
  }
  const arr = Array.from(counts.entries())
    .map(([frame, count]) => ({ frame, count, horses: frameToHorses.get(frame) || [] }))
    .sort((a, b) => Number(a.frame) - Number(b.frame))
    .slice(0, cap);
  return arr.map(({ frame, count, horses }) => {
    const ex = horses?.[0]?.name || '';
    const f = parseInt(String(frame).replace(/\D/g, ''), 10);
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(selectFrameLabel(frame, ''))
      .setValue(String(frame))
      .setDescription(`${count}頭${ex ? `（例: ${ex}）` : ''}`.slice(0, 70));
    const em = Number.isFinite(f) ? wakuUmaEmojiResolvable(f, f) : null;
    if (em) opt.setEmoji({ id: em.id, name: em.name });
    if (selectedSet.has(String(frame))) opt.setDefault(true);
    return opt;
  });
}

export function buildMenuRowFromCustomId({ menuCustomId, flow, result }) {
  const parts = menuCustomId.split('|');
  const kind = parts[0];
  const raceId = parts[1];
  if (!raceId) return null;

  const stepSelections = flow.stepSelections || {};
  const selectedValues = stepSelections[menuCustomId] || [];

  // Pair / box / pick menus all depend on whether frame based
  const betTypeFromId = parts[2]; // for *_|raceId|betType
  const isFrame = betTypeFromId === 'frame_pair';

  // 枠連（通常）: 第1枠 / 第2枠
  if (
    kind === 'race_bet_frame_pair_normal_first' ||
    kind === 'race_bet_frame_pair_normal_second'
  ) {
    const options = frameOptionsFromResult(result, selectedValues);
    const placeholder = kind.endsWith('first')
      ? '第1枠を選択'
      : '第2枠を選択';
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(placeholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_single_pick') {
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('馬番を1頭選択')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(horseOptionsFromResult(result, selectedValues)),
    );
  }

  if (kind === 'race_bet_pair_mode') {
    const modeSel = selectedValues[0] ?? flow?.pairMode ?? null;
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('投票形式を選択')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(modeOptionsList(PAIR_MODE_OPTIONS, modeSel)),
    );
  }

  if (kind === 'race_bet_pair_normal') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isFrame ? '枠を選択（最大2）' : '馬番を選択（最大2）')
        .setMinValues(1)
        .setMaxValues(2)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_pair_nagashi_axis') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isFrame ? '軸の枠を選択' : '軸の馬番を選択')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_pair_nagashi_opponent') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('相手を選択（複数可）')
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_pair_box') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isFrame ? '枠を選択' : '馬番を選択')
        .setMinValues(2)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_pair_formA') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isFrame ? '第1群枠を選択' : '第1群馬番を選択')
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_pair_formB') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isFrame ? '第2群枠を選択' : '第2群馬番を選択')
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_umatan_mode') {
    const modeSel = selectedValues[0] ?? flow?.umatanMode ?? null;
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('投票形式を選択')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(modeOptionsList(UMATAN_MODE_OPTIONS, modeSel)),
    );
  }

  // 馬単の pick 系は全て馬番（フレーム基準ではない）
  if (kind === 'race_bet_umatan_normal_1' || kind === 'race_bet_umatan_normal_2') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(kind.endsWith('_1') ? '1着（1頭）' : '2着（1頭）')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_umatan_nagashi1_axis' || kind === 'race_bet_umatan_nagashi2_axis' || kind === 'race_bet_umatan_nagashi3_axis') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('軸（1頭）')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_umatan_nagashi1_opp' || kind === 'race_bet_umatan_nagashi2_opp') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('相手（複数可）')
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_umatan_box') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('馬番を選択（複数可）')
        .setMinValues(2)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_umatan_formA' || kind === 'race_bet_umatan_formB') {
    const options = horseOptionsFromResult(result, selectedValues);
    const isA = kind.endsWith('formA');
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isA ? '第1群（1着）' : '第2群（2着）')
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  // 3連複
  if (kind === 'race_bet_trifuku_mode') {
    const modeSel = selectedValues[0] ?? flow?.trifukuMode ?? null;
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('投票形式を選択')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(modeOptionsList(TRIFUKU_MODE_OPTIONS, modeSel)),
    );
  }

  if (kind === 'race_bet_trifuku_normal') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('3頭を選択')
        .setMinValues(3)
        .setMaxValues(3)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_trifuku_n1_axis') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('軸（1頭）')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_trifuku_n1_opp') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('相手（複数可）')
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_trifuku_n2_axis') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('軸（2頭）')
        .setMinValues(2)
        .setMaxValues(2)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_trifuku_n2_opp') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('相手（複数可）')
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_trifuku_box') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('馬番（複数可）')
        .setMinValues(3)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_trifuku_formA' || kind === 'race_bet_trifuku_formB' || kind === 'race_bet_trifuku_formC') {
    const options = horseOptionsFromResult(result, selectedValues);
    const idx = kind.endsWith('formA') ? '第1群' : kind.endsWith('formB') ? '第2群' : '第3群';
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(idx)
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  // 3連単
  if (kind === 'race_bet_tritan_mode') {
    const modeSel = selectedValues[0] ?? flow?.tritanMode ?? null;
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('投票形式を選択')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(modeOptionsList(TRITAN_MODE_OPTIONS, modeSel)),
    );
  }

  // tritan pick handlers (horses only)
  const tritanSingleKinds = [
    'race_bet_tritan_normal_1',
    'race_bet_tritan_normal_2',
    'race_bet_tritan_normal_3',
    'race_bet_tritan_nagashi1_axis',
    'race_bet_tritan_nagashi2_axis',
    'race_bet_tritan_nagashi3_axis',
    'race_bet_tritan_n12_a1',
    'race_bet_tritan_n12_a2',
    'race_bet_tritan_n13_a1',
    'race_bet_tritan_n13_a3',
    'race_bet_tritan_n23_a2',
    'race_bet_tritan_n23_a3',
  ];
  if (tritanSingleKinds.includes(kind)) {
    const options = horseOptionsFromResult(result, selectedValues);
    let placeholder = '軸（1頭）';
    if (kind === 'race_bet_tritan_normal_1') placeholder = '1着（1頭）';
    else if (kind === 'race_bet_tritan_normal_2') placeholder = '2着（1頭）';
    else if (kind === 'race_bet_tritan_normal_3') placeholder = '3着（1頭）';
    else if (kind === 'race_bet_tritan_n12_a1') placeholder = '1着（1頭）';
    else if (kind === 'race_bet_tritan_n12_a2') placeholder = '2着（1頭）';
    else if (kind === 'race_bet_tritan_n13_a1') placeholder = '1着（1頭）';
    else if (kind === 'race_bet_tritan_n13_a3') placeholder = '3着（1頭）';
    else if (kind === 'race_bet_tritan_n23_a2') placeholder = '2着（1頭）';
    else if (kind === 'race_bet_tritan_n23_a3') placeholder = '3着（1頭）';
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(placeholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  }

  const tritanMultiKinds = [
    'race_bet_tritan_nagashi1_opp',
    'race_bet_tritan_nagashi2_opp',
    'race_bet_tritan_nagashi3_opp',
    'race_bet_tritan_n12_opp3',
    'race_bet_tritan_n13_opp2',
    'race_bet_tritan_n23_opp1',
    'race_bet_tritan_box',
  ];
  if (tritanMultiKinds.includes(kind)) {
    const options = horseOptionsFromResult(result, selectedValues);
    const isBox = kind === 'race_bet_tritan_box';
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isBox ? '馬番（複数可）' : '相手（複数可）')
        .setMinValues(isBox ? 3 : 1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_tritan_formA' || kind === 'race_bet_tritan_formB' || kind === 'race_bet_tritan_formC') {
    const options = horseOptionsFromResult(result, selectedValues);
    const idx = kind.endsWith('formA') ? '第1群（1着候補）' : kind.endsWith('formB') ? '第2群（2着候補）' : '第3群（3着候補）';
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(idx)
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  return null;
}

