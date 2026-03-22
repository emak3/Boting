import { Events, BaseInteraction } from "discord.js";
import slash from "../interactions/slash.mjs";

export default {
    name: Events.InteractionCreate,
    /**
     * スラッシュは button/menu/modal より先に処理し、deferReply の 3 秒制限に余裕を持たせる。
     * @param {BaseInteraction} interaction
     */
    async execute(interaction) {
        if (interaction.isChatInputCommand()) {
            await slash(interaction);
            return;
        }
        for (const value of interaction.client.interactions) {
            if (typeof value === 'function') {
                await value(interaction);
            }
        }
    }
}