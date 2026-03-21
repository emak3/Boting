import { netkeibaResultUrl, netkeibaOriginFromFlow } from './netkeibaUrls.mjs';

const BET_TYPE_LABEL = {
  win: '単勝',
  place: '複勝',
  win_place: '単勝+複勝',
  frame_pair: '枠連',
  horse_pair: '馬連',
  wide: 'ワイド',
  umatan: '馬単',
  trifuku: '3連複',
  tritan: '3連単',
};

/** Components V2 用（Text Display 1 ブロック） */
export function buildBetPurchaseV2Headline({ flow }) {
  const unitYen = flow?.unitYen ?? 100;
  const points = flow?.purchase?.points ?? 0;
  const selectionLine = flow?.purchase?.selectionLine ?? '（選択なし）';
  const totalYen = points * unitYen;

  const raceTitle = flow?.result?.raceInfo?.title || 'レース';
  const oddsTime = flow?.result?.oddsOfficialTime;
  const raceId = flow?.result?.raceId;
  const isResult = !!flow?.result?.isResult;
  const origin = netkeibaOriginFromFlow(flow);
  const resultUrl = raceId ? netkeibaResultUrl(raceId, origin) : null;

  return [
    '**購入内容（仮）**',
    '',
    `レース: ${raceTitle}`,
    oddsTime ? `オッズ時刻: ${oddsTime}` : null,
    isResult && resultUrl ? `結果: ${resultUrl}` : null,
    '',
    selectionLine,
    `点数: ${points}点`,
    `1点あたり: ${unitYen}円`,
    `合計目安: ${totalYen}円（${unitYen}円/点）`,
    '',
    '*実際の決済は行いません（選択内容の確認のみ）*',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 複数買い目をまとめた確認文（Components V2 用）
 * @param {{ items: Array<{ raceId: string, unitYen: number, points: number, selectionLine: string, raceTitle?: string, oddsOfficialTime?: string, isResult?: boolean, netkeibaOrigin?: string }> }} opts
 */
export function buildBetSlipBatchV2Headline({ items }) {
  const lines = ['**まとめて購入内容（仮）**', ''];
  let grandPoints = 0;
  let grandYen = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const unitYen = it.unitYen ?? 100;
    const points = it.points ?? 0;
    const selectionLine = it.selectionLine ?? '（選択なし）';
    const raceTitle = it.raceTitle || 'レース';
    const raceId = it.raceId;
    const origin = it.netkeibaOrigin === 'nar' ? 'nar' : 'jra';
    const resultUrl =
      raceId && it.isResult ? netkeibaResultUrl(raceId, origin) : null;
    const subtotal = points * unitYen;
    grandPoints += points;
    grandYen += subtotal;

    lines.push(`**${i + 1}.** ${raceTitle}`);
    if (it.oddsOfficialTime) lines.push(`オッズ時刻: ${it.oddsOfficialTime}`);
    if (resultUrl) lines.push(`結果: ${resultUrl}`);
    lines.push(selectionLine);
    lines.push(`点数: ${points}点 | 1点: ${unitYen}円 | 小計: ${subtotal}円`);
    lines.push('');
  }

  lines.push(
    `—`,
    `**合計** 点数: ${grandPoints}点 | 合計目安: ${grandYen}円`,
    '',
    '*実際の決済は行いません（選択内容の確認のみ）*',
  );

  return lines.join('\n');
}

export function buildBetPurchaseEmbed({ flow }) {
  const unitYen = flow?.unitYen ?? 100;
  const points = flow?.purchase?.points ?? 0;
  const selectionLine = flow?.purchase?.selectionLine ?? '（選択なし）';
  const totalYen = points * unitYen;

  const raceTitle = flow?.result?.raceInfo?.title || 'レース';
  const oddsTime = flow?.result?.oddsOfficialTime;
  const raceId = flow?.result?.raceId;
  const isResult = !!flow?.result?.isResult;
  const origin = netkeibaOriginFromFlow(flow);
  const resultUrl = raceId ? netkeibaResultUrl(raceId, origin) : null;

  return {
    color: 0x2ecc71,
    title: '購入内容（仮）',
    description: [
      `レース: ${raceTitle}`,
      oddsTime ? `オッズ時刻: ${oddsTime}` : null,
      isResult && resultUrl ? `結果: ${resultUrl}` : null,
      '',
      selectionLine,
      `点数: ${points}点`,
      `1点あたり: ${unitYen}円`,
      `合計目安: ${totalYen}円（${unitYen}円/点）`,
    ]
      .filter(Boolean)
      .join('\n'),
    footer: { text: '実際の決済は行いません（選択内容の確認のみ）' },
  };
}

export { BET_TYPE_LABEL };

