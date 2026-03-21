import {
  wakuUmaEmoji,
  formatNumsWithWakuUmaEmoji,
  formatWakurenNumsWithEmoji,
} from './raceNumberEmoji.mjs';

/** @param {{ raceId?: string, raceInfo?: object, horses?: object[], payouts?: object[] }} parsed */
export function buildRaceResultEmbeds(parsed) {
  const raceId = parsed?.raceId;
  const url = raceId
    ? `https://race.netkeiba.com/race/result.html?race_id=${raceId}`
    : null;

  const ri = parsed.raceInfo || {};
  const desc = [`**日程:** ${ri.date || 'N/A'}`, `**コース:** ${ri.course || 'N/A'}`];
  if (url) desc.push(`[netkeibaで開く](${url})`);

  const horses = parsed.horses || [];
  const horseNumToFrame = new Map();
  for (const h of horses) {
    const key = parseInt(String(h.horseNumber).replace(/\D/g, ''), 10);
    if (Number.isFinite(key)) horseNumToFrame.set(String(key), h.frameNumber);
  }

  const fields = horses.slice(0, 25).map((h) => {
    const odds =
      h.odds && h.odds !== 'N/A' ? `単勝オッズ ${h.odds}` : '';
    const pop =
      h.popularity && h.popularity !== 'N/A' ? `${h.popularity}人気` : '';
    const tail = [pop, odds].filter(Boolean).join(' · ');
    const margin = h.margin ? ` 差: ${h.margin}` : '';
    const wu = wakuUmaEmoji(h.frameNumber, h.horseNumber);
    const numLabel = wu ? `${wu}` : `${h.horseNumber}.`;
    const wakuPart = wu ? '' : `枠${h.frameNumber} | `;
    return {
      name: `${h.finishRank}着 ${numLabel} ${h.name}`.trim(),
      value: `${wakuPart}${h.jockey || '—'} | ${h.time || '—'}${margin}${tail ? `\n${tail}` : ''}`.slice(
        0,
        1024,
      ),
      inline: false,
    };
  });

  const fmtNums = (nums, joiner) => {
    if (!nums?.length) return '—';
    return formatNumsWithWakuUmaEmoji(nums, joiner || '-', horseNumToFrame);
  };

  const payoutLines = (parsed.payouts || []).map((p) => {
    const isWakuren = /枠連/.test(p.label || '');
    const numPart = p.nums?.length
      ? isWakuren
        ? formatWakurenNumsWithEmoji(p.nums, p.joiner || '-')
        : fmtNums(p.nums, p.joiner || '-')
      : p.result && p.result !== '—'
        ? p.result
        : '—';
    const nk = p.ninki ? ` (${p.ninki})` : '';
    return `**${p.label}** ${numPart} \`${p.payout}\`${nk}`;
  });
  let payoutDesc = payoutLines.join('\n');
  if (payoutDesc.length > 4090) payoutDesc = `${payoutDesc.slice(0, 4087)}…`;

  const main = {
    color: 0xf1c40f,
    title: `🏁 ${ri.title || 'レース結果'}`,
    description: desc.join('\n'),
    fields,
    footer: { text: `全${horses.length}頭` },
  };

  const embeds = [main];
  if (payoutDesc) {
    embeds.push({
      color: 0x2ecc71,
      title: '💴 払い戻し',
      description: payoutDesc,
    });
  }

  return embeds;
}
