import { BaseInteraction } from 'discord.js';
import debugHubButtons from './button/debugHubButtons.mjs';
import raceHubButtons from './button/raceHubButtons.mjs';
import botingLedgerKeypadButtons from './button/botingLedgerKeypadButtons.mjs';
import bpRankLimitKeypadButtons from './button/bpRankLimitKeypadButtons.mjs';
import scheduleBackButtons from './button/scheduleBackButtons.mjs';
import unitYenKeypadButtons from './button/unitYenKeypadButtons.mjs';
import betFlowButtons from './button/betFlowButtons.mjs';

/**
 * 軽いハンドラを先に実行し、応答済みなら重い betFlow を走らせない（二重応答・遅延の抑制）。
 * @type {readonly ((interaction: import('discord.js').ButtonInteraction) => unknown)[]}
 */
const BUTTON_HANDLERS = [
  debugHubButtons,
  botingLedgerKeypadButtons,
  bpRankLimitKeypadButtons,
  raceHubButtons,
  scheduleBackButtons,
  unitYenKeypadButtons,
  betFlowButtons,
];

/**
 * @param {BaseInteraction} interaction
 */
export default async function (interaction) {
  if (!interaction.isButton()) return;
  if (interaction.deferred || interaction.replied) return;
  for (const handler of BUTTON_HANDLERS) {
    await handler(interaction);
    if (interaction.deferred || interaction.replied) return;
  }
}