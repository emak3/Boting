import { BaseInteraction, MessageFlags } from "discord.js";
import { runPendingRaceRefundsForUser } from "../utils/raceBetRefundSweep.mjs";

/**
 * 未精算の競馬払戻を先に実行し、bp 残高・ランキング集計と整合させる
 * @param {string} userId
 */
async function runPendingRaceRefundsBeforeCommand(userId) {
    await runPendingRaceRefundsForUser(userId);
}

/**
 * @param {BaseInteraction} interaction
 */
export default async function (interaction) {
    if (!interaction.isCommand()) return;
    await runPendingRaceRefundsBeforeCommand(interaction.user.id);
    if (interaction.client.commands.has(interaction.commandName)) {
        await interaction.client.commands.get(interaction.commandName).execute(interaction);
    } else {
        await interaction.reply({ content: "コマンドが存在しない又は、エラーの可能性があります。", flags: MessageFlags.Ephemeral });
    }
}