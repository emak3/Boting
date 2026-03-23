import { Client, Partials, GatewayIntentBits } from "discord.js";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig, getConfigLogSummary } from './config/config.mjs';
import { initLogger, shutdownLogger } from './utils/logging/logger.mjs';
import { closePuppeteerBrowserPool } from './scrapers/netkeiba/utils/puppeteerBrowserPool.mjs';
import './utils/patches/usernameSystem.mjs';

const log = initLogger();
const __dirname = dirname(fileURLToPath(import.meta.url));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ],
    allowedMentions: { parse: ["users", "roles"] },
    partials: [Partials.Channel],
    // 遅い回線・DNS で undici の接続が 10s で落ちることがあるため REST 全体の上限を延ばす
    rest: { timeout: 60_000 },
});

client.commands = new Map();
client.messages = [];
client.modals = [];
client.menus = [];
client.userMenus = [];

function formatErr(reason) {
    if (reason instanceof Error) return reason.stack || reason.message;
    try {
        return JSON.stringify(reason);
    } catch {
        return String(reason);
    }
}

process.on("uncaughtException", async (error) => {
    log.error("uncaughtException:", formatErr(error));
    await shutdownLogger().catch(() => {});
    process.exit(1);
});

process.on("unhandledRejection", async (reason) => {
    log.error("unhandledRejection:", formatErr(reason));
    await shutdownLogger().catch(() => {});
    process.exit(1);
});

async function shutdown() {
    await closePuppeteerBrowserPool().catch(() => {});
    await client.destroy().catch(() => {});
    await shutdownLogger().catch(() => {});
    process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

// ファイルの動的インポート（cwd に依存しないよう __dirname 基準）
for (const file of readdirSync(join(__dirname, "discord/events")).filter((file) =>
    file.endsWith(".mjs"),
)) {
    const eventModule = await import(`./discord/events/${file}`);
    const event = eventModule.default;
    if (event.once) {
        client.once(event.name, async (...args) => await event.execute(...args));
    }
    else {
        client.on(event.name, async (...args) => await event.execute(...args));
    }
}

for (const file of readdirSync(join(__dirname, "discord/commands")).filter((file) =>
    file.endsWith(".mjs"),
)) {
    const commandModule = await import(`./discord/commands/${file}`);
    const command = commandModule.default;
    client.commands.set(command.command.name, command);
}

for (const file of readdirSync(join(__dirname, "discord/interactions/modal")).filter((file) =>
    file.endsWith(".mjs"),
)) {
    const modalModule = await import(`./discord/interactions/modal/${file}`);
    const modal = modalModule.default;
    client.modals.push(modal);
}

for (const file of readdirSync(join(__dirname, "discord/interactions/menu")).filter((file) =>
    file.endsWith(".mjs"),
)) {
    const menuModule = await import(`./discord/interactions/menu/${file}`);
    const menu = menuModule.default;
    client.menus.push(menu);
}

for (const file of readdirSync(join(__dirname, "discord/interactions/userMenu")).filter((file) =>
    file.endsWith(".mjs"),
)) {
    const userMenuModule = await import(`./discord/interactions/userMenu/${file}`);
    const userMenu = userMenuModule.default;
    client.userMenus.push(userMenu);
}

for (const file of readdirSync(join(__dirname, "discord/messages")).filter((file) =>
    file.endsWith(".mjs"),
)) {
    const messageModule = await import(`./discord/messages/${file}`);
    const message = messageModule.default;
    client.messages.push(message);
}

client.login(getConfig().token).then(() =>
    log.info("Discord client ready.", getConfigLogSummary()),
).catch((e) => {
    log.error("Discord login failed:", formatErr(e));
    shutdownLogger().finally(() => process.exit(1));
});
