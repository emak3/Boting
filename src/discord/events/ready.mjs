import { Events, Client, Routes, ActivityType } from "discord.js";
import { getConfig } from '../../config/config.mjs';
import { initLogger } from '../../utils/logging/logger.mjs';
import { refreshDebugAuthorizedCache } from '../utils/debug/debugAuthStore.mjs';
import { initDatabase } from '../utils/db/initDb.mjs';
const log = initLogger();

export default {
    name: Events.ClientReady,
    /**
     * @param {Client} client
     */
    async execute(client) {

        await getConfig();
    
        client.user.setActivity({
            name: '競馬Boting v1',
            type: ActivityType.Playing
        });
        log.info('online!');

        try {
            await initDatabase();
            log.info('SQLite (Sequelize) ready');
        } catch (e) {
            log.error('initDatabase failed:', e?.message ?? e);
            throw e;
        }

        try {
            await refreshDebugAuthorizedCache();
            log.info('debugAuthorizedUsers cache refreshed');
        } catch (e) {
            log.warn('refreshDebugAuthorizedCache failed (using in-memory seed until next success):', e?.message ?? e);
        }

        const commands = [];
        for (const command of client.commands.values()) {
            commands.push(command.command.toJSON());
        }
        (async () => {
            try {
                log.info(`Started refreshing ${commands.length} application (/) commands.`);
                const data = await client.rest.put(Routes.applicationCommands(client.user.id), {
                    body: commands,
                });
                log.info(`${data.length} 個のApplication Commandsを登録。`);
            } catch (error) {
                log.error(error);
            }
        })();
    }
}