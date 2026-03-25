import { Events, MessageFlags } from "discord.js";
import slash from "../interactions/slash.mjs";
import button from "../interactions/button.mjs";
import userMenu from "../interactions/userMenu.mjs";
import menu from "../interactions/menu.mjs";
import modal from "../interactions/modal.mjs";
import { initLogger } from "../../utils/logging/logger.mjs";
import { resolveLocaleFromInteraction, t } from "../../i18n/index.mjs";

const log = initLogger();

function formatInteractionErr(reason) {
    if (reason instanceof Error) return reason.stack || reason.message;
    try {
        return JSON.stringify(reason);
    } catch {
        return String(reason);
    }
}

function isExpiredOrUnknownInteractionError(code) {
    return code === 10062;
}

/**
 * ハンドラ例外後もユーザーに一言返し、プロセス全体の unhandledRejection を避ける。
 * @param {import('discord.js').Interaction} interaction
 */
async function safeReplyAfterHandlerError(interaction) {
    const loc = resolveLocaleFromInteraction(interaction);
    const content = t("errors.interaction_failed", null, loc);
    try {
        if (interaction.deferred) {
            await interaction.editReply({ content });
            return;
        }
        if (interaction.replied) {
            await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (e2) {
        log.warn(
            "safeReplyAfterHandlerError:",
            formatInteractionErr(e2),
        );
    }
}

export default {
    name: Events.InteractionCreate,
    /**
     * スラッシュは button/menu/modal より先に処理し、deferReply の 3 秒制限に余裕を持たせる。
     * 型に応じたハンドラだけ実行し、不要な isButton/isModal 判定と関数呼び出しを省く。
     * @param {import('discord.js').Interaction} interaction
     */
    async execute(interaction) {
        try {
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
        } catch (e) {
            if (isExpiredOrUnknownInteractionError(e?.code)) {
                log.warn(
                    "InteractionCreate: unknown/expired interaction (10062)",
                );
                return;
            }
            log.error("InteractionCreate:", formatInteractionErr(e));
            await safeReplyAfterHandlerError(interaction);
        }
    },
};