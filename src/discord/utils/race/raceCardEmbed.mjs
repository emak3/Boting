import { wakuUmaEmoji, jogaiEmoji } from './raceNumberEmoji.mjs';
import { netkeibaResultUrl } from '../netkeiba/netkeibaUrls.mjs';
import { formatCompactPostTimeForHistory } from '../bet/betPurchaseEmbed.mjs';

/** @param {{ raceInfo?: object, horses: object[], totalHorses: number, oddsOfficialTime?: string }} result */
export function buildRaceCardEmbed(result) {
  if (!result?.horses?.length) {
    return {
      color: 0x95a5a6,
      title: '🐎 出馬表',
      description:
        '出馬表データがありません。セッションが切れたか取得に失敗しています。もう一度 /boting から開き直してください。',
    };
  }

  const raceId = result?.raceId;
  const isResult = !!result?.isResult;
  const origin = result?.netkeibaOrigin === 'nar' ? 'nar' : 'jra';
  const resultUrl = raceId ? netkeibaResultUrl(raceId, origin) : null;

  const ri = result.raceInfo || {};
  const courseBlock = ri.prizeMoney
    ? `**コース:** ${ri.course || 'N/A'}\n${ri.prizeMoney}`
    : `**コース:** ${ri.course || 'N/A'}`;
  const postRaw = result.oddsOfficialTime
    ? String(result.oddsOfficialTime).trim()
    : '';
  const postDisp = postRaw
    ? formatCompactPostTimeForHistory(postRaw) || postRaw
    : '';
  const embed = {
    color: isResult ? 0xed4245 : 0x0099ff,
    title: `${isResult ? '🏁' : '🐎'} ${ri.title || 'レース情報'}`,
    description: `**日程:** ${ri.date || 'N/A'}\n${courseBlock}`,
    fields: result.horses.slice(0, 18).map((horse) => {
      const place = horse.placeOddsMin ? ` / 複勝〜${horse.placeOddsMin}` : '';
      const ninki = horse.popularity && horse.popularity !== 'N/A' ? ` | ${horse.popularity}人気` : '';
      const wu = wakuUmaEmoji(horse.frameNumber, horse.horseNumber);
      const numLabel = wu ? `${wu}` : `${horse.horseNumber}.`;
      const wakuPart = wu ? '' : `枠${horse.frameNumber} | `;
      const jog = horse.excluded ? jogaiEmoji() : null;
      return {
        name: `${numLabel} ${horse.name}${jog ? ` ${jog}` : ''}`.trim(),
        value: `${wakuPart}${horse.age} | ${horse.weight}kg\n${horse.jockey}${ninki}\n単勝 ${horse.odds}${place}`,
        inline: true,
      };
    }),
    footer: {
      text: [
        `全${result.totalHorses}頭${
          postDisp ? ` | 発走時刻 ${postDisp}` : ''
        }`,
        isResult && resultUrl ? `結果: ${resultUrl}` : null,
      ]
        .filter(Boolean)
        .join(' | '),
    },
  };

  if (result.horses.length > 18) {
    embed.fields.push({
      name: '注意',
      value: `Embedの都合で先頭18頭のみ表示しています（全${result.totalHorses}頭取得済み）。`,
      inline: false,
    });
  }

  return embed;
}
