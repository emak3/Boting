/**
 * デバッグハブのエフェメラルメッセージは、モーダル送信後の token では編集できない。
 * メインパネルを表示したインタラクションの token / messageId を覚えておき、
 * 週間CHモーダル保存後に InteractionWebhook で PATCH する。
 */

const TTL_MS = 14 * 60 * 1000;

/** @type {Map<string, { applicationId: string, token: string, messageId: string, savedAt: number }>} */
const store = new Map();

function k(userId) {
  return String(userId);
}

/**
 * @param {string} userId
 * @param {{ applicationId: string, token: string, messageId: string }} ctx
 */
export function saveDebugPanelWebhookContext(userId, ctx) {
  const applicationId = ctx.applicationId;
  const token = ctx.token;
  const messageId = ctx.messageId;
  if (!applicationId || !token || !messageId) return;
  store.set(k(userId), {
    applicationId: String(applicationId),
    token: String(token),
    messageId: String(messageId),
    savedAt: Date.now(),
  });
}

/**
 * @param {string} userId
 * @returns {{ applicationId: string, token: string, messageId: string } | null}
 */
export function getDebugPanelWebhookContext(userId) {
  const row = store.get(k(userId));
  if (!row) return null;
  if (Date.now() - row.savedAt > TTL_MS) {
    store.delete(k(userId));
    return null;
  }
  return {
    applicationId: row.applicationId,
    token: row.token,
    messageId: row.messageId,
  };
}

/**
 * `interaction.update` でデバッグメインパネルを表示した直後に呼ぶ
 * @param {import('discord.js').MessageComponentInteraction} interaction
 */
export function saveDebugPanelFromComponentInteraction(interaction) {
  const userId = interaction.user?.id;
  const mid = interaction.message?.id;
  const token = interaction.token;
  const applicationId = interaction.applicationId;
  if (!userId || !mid || !token || !applicationId) return;
  saveDebugPanelWebhookContext(userId, {
    applicationId,
    token,
    messageId: mid,
  });
}

/**
 * `/debug` の `editReply` の直後に呼ぶ
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function saveDebugPanelFromSlashInteraction(interaction) {
  const userId = interaction.user?.id;
  const token = interaction.token;
  const applicationId = interaction.applicationId;
  if (!userId || !token || !applicationId) return;
  const msg = await interaction.fetchReply().catch(() => null);
  if (!msg?.id) return;
  saveDebugPanelWebhookContext(userId, {
    applicationId,
    token,
    messageId: msg.id,
  });
}
