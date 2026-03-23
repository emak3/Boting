import { Events } from "discord.js";
import slash from "../interactions/slash.mjs";
import button from "../interactions/button.mjs";
import userMenu from "../interactions/userMenu.mjs";
import menu from "../interactions/menu.mjs";
import modal from "../interactions/modal.mjs";

export default {
    name: Events.InteractionCreate,
    /**
     * スラッシュは button/menu/modal より先に処理し、deferReply の 3 秒制限に余裕を持たせる。
     * 型に応じたハンドラだけ実行し、不要な isButton/isModal 判定と関数呼び出しを省く。
     * @param {BaseInteraction} interaction
     */
    async execute(interaction) {
        if (interaction.isChatInputCommand()) {
            await slash(interaction);
            return;
        }
        if (interaction.isButton()) {
            await button(interaction);
            return;
        }
        if (interaction.isUserSelectMenu()) {
            await userMenu(interaction);
            return;
        }
        if (interaction.isStringSelectMenu()) {
            await menu(interaction);
            return;
        }
        if (interaction.isModalSubmit()) {
            await modal(interaction);
            return;
        }
    },
};