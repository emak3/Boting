import { MessageFlags } from "discord.js";

/**
 * 未精算の競馬払戻は各コマンドで deferReply の直後に await する。
 * execute 内で defer より前に重い await すると 3 秒超えで DiscordAPIError[10062] になる。
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export default async function (interaction) {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.client.commands.has(interaction.commandName)) {
        try {
            await interaction.client.commands.get(interaction.commandName).execute(interaction);
        } catch (e) {
            if (e?.code === 10062) {
                console.warn(
                    "[slash] Unknown interaction (10062); token expired or already acknowledged",
                    interaction.commandName,
                );
                return;
            }
            throw e;
        }
    } else {
        await interaction.reply({ content: "コマンドが存在しない又は、エラーの可能性があります。", flags: MessageFlags.Ephemeral });
    }
}