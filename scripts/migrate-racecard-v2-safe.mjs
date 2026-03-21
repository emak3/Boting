/**
 * raceSchedule.mjs: buildRaceCardEmbed + content + components → buildRaceCardV2Payload
 */
import fs from 'fs';

const path = 'discord/interactions/menu/raceSchedule.mjs';
let s = fs.readFileSync(path, 'utf8');

s = s.replace(
  /import \{ buildRaceCardEmbed \} from '\.\.\/\.\.\/utils\/raceCardEmbed\.mjs';/,
  "import { buildRaceCardV2Payload } from '../../utils/raceCardDisplay.mjs';",
);

function findMatchingBracket(s, openIdx, openCh, closeCh) {
  let d = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === openCh) d++;
    else if (c === closeCh) {
      d--;
      if (d === 0) return i;
    }
  }
  return -1;
}

const embedNeedle = 'embeds: [buildRaceCardEmbed(result)],';
let count = 0;
let pos = 0;

while (true) {
  const embedIdx = s.indexOf(embedNeedle, pos);
  if (embedIdx < 0) break;

  const before = s.slice(0, embedIdx);
  const replyKw = 'await interaction.editReply({';
  const replyStart = before.lastIndexOf(replyKw);
  if (replyStart < 0) {
    console.error('no editReply before embed at', embedIdx);
    process.exit(1);
  }

  const mid = s.slice(replyStart, embedIdx);
  const cm = mid.match(/content:\s*([\s\S]*?),\s*$/);
  if (!cm) {
    console.error('no content line before embed at', embedIdx);
    process.exit(1);
  }
  const headlineExpr = cm[1].trim();
  const contentStartInMid = cm.index;
  const contentAbsStart = replyStart + contentStartInMid;

  const afterEmbed = s.slice(embedIdx + embedNeedle.length);
  const compM = afterEmbed.match(/^\s*components:\s*\[/);
  if (!compM) {
    console.error('no components after embed at', embedIdx);
    process.exit(1);
  }
  const compKeywordStart = embedIdx + embedNeedle.length + compM.index;
  const bracketOpen = s.indexOf('[', compKeywordStart);
  const bracketClose = findMatchingBracket(s, bracketOpen, '[', ']');
  if (bracketClose < 0) {
    console.error('unbalanced [ at', bracketOpen);
    process.exit(1);
  }

  let editEnd = bracketClose + 1;
  const rest = s.slice(editEnd);
  const filterM = rest.match(/^\s*\.filter\(Boolean\)/);
  if (filterM) {
    editEnd += filterM[0].length;
  }
  const commaClose = s.slice(editEnd).match(/^\s*,\s*\r?\n\s*\}\)\s*;/);
  if (!commaClose) {
    console.error('no }); after components at', editEnd, s.slice(editEnd, editEnd + 80));
    process.exit(1);
  }
  editEnd += commaClose[0].length;

  const inner = s.slice(bracketOpen + 1, bracketClose).trim();

  const replacement =
    'await interaction.editReply(\n' +
    '        buildRaceCardV2Payload({\n' +
    '          result,\n' +
    '          headline: ' +
    headlineExpr +
    ',\n' +
    '          actionRows: [\n        ' +
    inner +
    '\n        ].filter(Boolean),\n' +
    '        }),\n' +
    '      );';

  const newS =
    s.slice(0, replyStart) + replacement + s.slice(editEnd);
  s = newS;
  pos = replyStart + replacement.length;
  count++;
}

fs.writeFileSync(path, s);
console.log('Converted', count, 'blocks');
