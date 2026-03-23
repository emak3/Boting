import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { BOTING_HUB_PREFIX } from './botingHubConstants.mjs';
import { botingEmoji } from './botingEmojis.mjs';

/** `/boting` メインメニューへ戻る（エラー文面・サブ画面の下に並べる） */
export function buildBotingMenuBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|back`)
      .setLabel('メニューに戻る')
      .setEmoji(botingEmoji('home'))
      .setStyle(ButtonStyle.Secondary),
  );
}

/** エフェメラル返信用（本文 + メニューに戻る。スラッシュを再度打たなくてよい） */
export function buildEphemeralWithBotingBackPayload(content) {
  return {
    content,
    components: [buildBotingMenuBackRow()],
    flags: MessageFlags.Ephemeral,
  };
}
