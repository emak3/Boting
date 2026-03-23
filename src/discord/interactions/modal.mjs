/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export default async function (interaction) {
    if (!interaction.isModalSubmit()) return;
    for (const value of interaction.client.modals) {
        await value(interaction);
        if (interaction.deferred || interaction.replied) return;
    }
}