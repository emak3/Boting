import { MessageFlags } from 'discord.js';

/**
 * Components V2 ペイロードの `extraFlags` に OR するビット。
 * 元メッセージが ephemeral なら引き継ぐ。
 * デバッグ系モーダルなど `message` が無い場合は `assumeEphemeral: true` で Ephemeral を付与。
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {{ assumeEphemeral?: boolean }} [opts]
 * @returns {number}
 */
export function v2ExtraFlags(interaction, opts = {}) {
  const { assumeEphemeral = false } = opts;
  let flags = assumeEphemeral ? MessageFlags.Ephemeral : 0;
  try {
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      flags |= MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }
  return flags;
}

/**
 * `deferReply`（常に Ephemeral を付与）。追加の MessageFlags は `flags` で OR。
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').DeferReplyOptions & { flags?: number }} [options]
 */
export async function deferEphemeral(interaction, options = {}) {
  const { flags: extra = 0, ...rest } = options;
  return interaction.deferReply({
    ...rest,
    flags: MessageFlags.Ephemeral | extra,
  });
}

/**
 * `deferReply`（Ephemeral 既定）の直後に `editReply`。`payload` はオブジェクトまたは Promise。
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').InteractionEditReplyOptions | Promise<import('discord.js').InteractionEditReplyOptions>} payload
 * @param {import('discord.js').DeferReplyOptions & { flags?: number }} [deferOptions]
 */
export async function deferEphemeralThenEditReply(
  interaction,
  payload,
  deferOptions = {},
) {
  await deferEphemeral(interaction, deferOptions);
  const resolved = await payload;
  return interaction.editReply(resolved);
}

/**
 * コンポーネントの `deferUpdate` の直後に `editReply`（元の応答メッセージを編集する定形）。
 * `payload` はオブジェクトまたは Promise。
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').InteractionEditReplyOptions | Promise<import('discord.js').InteractionEditReplyOptions>} payload
 */
export async function deferUpdateThenEditReply(interaction, payload) {
  await interaction.deferUpdate();
  const resolved = await payload;
  return interaction.editReply(resolved);
}

/**
 * ボタン／セレクトの即時 `update`（defer しない）。
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').InteractionUpdateOptions} payload
 */
export async function updateComponent(interaction, payload) {
  return interaction.update(payload);
}
