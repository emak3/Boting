import { Events, Message } from "discord.js";

export default {
    name: Events.MessageCreate,
    /**
     * @param {Message} message
     */
    async execute(message) {
        for (const value of message.client.messages) {
            if (typeof value === 'function') {
                await value(message);
            }
        }
    }
}