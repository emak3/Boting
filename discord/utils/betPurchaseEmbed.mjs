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

