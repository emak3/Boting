import { User } from 'discord.js';

/**
 * Discordの新しいユーザー名システム対応
 * Userクラスにtagプロパティを追加して互換性を保持
 */
Object.defineProperty(User.prototype, 'tag', {
  get: function() {
    return typeof this.username === 'string'
      ? this.discriminator === '0'
        ? this.globalName 
          ? `${this.globalName} (@${this.username})` 
          : `@${this.username}`
        : `${this.username}#${this.discriminator}`
      : null;
  }
});

export default {};