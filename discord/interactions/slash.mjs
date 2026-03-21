import { BaseInteraction, MessageFlags } from "discord.js";

/**
 * @param {BaseInteraction} interaction
 */
export default async function (interaction) {
    if (!interaction.isCommand()) return;
    if (interaction.client.commands.has(interaction.commandName)) {
        await interaction.client.commands.get(interaction.commandName).execute(interaction);
    } else {
        await interaction.reply({ content: "コマンドが存在しない又は、エラーの可能性があります。", flags: MessageFlags.Ephemeral });
    }
}