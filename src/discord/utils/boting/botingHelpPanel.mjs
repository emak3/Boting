import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { buildBotingMenuBackRow } from './botingBackButton.mjs';
import { botingEmoji } from './botingEmojis.mjs';

/** ヘルプ内の地域タブ用セレクト（`client.menus` で処理） */
export const BOTING_HELP_REGION_SELECT = 'boting_help_region';

const HUB_ACCENT = 0x5865f2;

const URL_BAKEN_TYPES = 'https://www.jra.go.jp/kouza/beginner/baken/';
const URL_BAKEN_RULES = 'https://www.jra.go.jp/kouza/baken/';

/** @type {readonly { id: string; label: string; description: string }[]} */
export const BOTING_HELP_REGION_TABS = [
  { id: 'overview', label: '概要', description: '馬券の種類・ルール（JRA）' },
  { id: 'central', label: '中央(JRA)', description: 'JRA公式YouTube' },
  { id: 'hokkaido_tohoku', label: '北海道・東北', description: '帯広・門別札幌・岩手' },
  { id: 'nan_kanto', label: '南関東', description: '浦和・船橋・大井・川崎' },
  { id: 'chubu_hokuriku', label: '中部・北陸', description: '金沢・笠松・名古屋' },
  {
    id: 'kinki_shikoku_kyushu',
    label: '近畿・四国・九州',
    description: '園田・姫路・高知・佐賀',
  },
];

/** @type {Record<string, undefined>} */
const VALID_REGION = Object.fromEntries(BOTING_HELP_REGION_TABS.map((t) => [t.id, undefined]));

/**
 * @param {string} region
 * @returns {typeof BOTING_HELP_REGION_TABS[number]['id']}
 */
export function normalizeBotingHelpRegion(region) {
  const r = String(region || '');
  return r in VALID_REGION ? r : 'overview';
}

/**
 * チャンネル名・補足の2行表示（Text Display 用）
 * @param {string} heading 太字にする見出し（**は付けない）
 * @param {string} sub `-# └` の右に付く1行
 */
function channelEntryBody(heading, sub) {
  return `**${heading}**\n-# └ ${sub}`;
}

/** @type {readonly { heading: string; sub: string; url: string; label: string }[]} */
const YT_CENTRAL = [
  {
    heading: 'JRA公式チャンネル',
    sub: 'JRA 全10場のライブ・映像',
    url: 'https://www.youtube.com/@jraofficial',
    label: 'JRA 公式',
  },
];

/** @type {readonly { heading: string; sub: string; url: string; label: string }[]} */
const YT_HOKKAIDO_TOHOKU = [
  {
    heading: 'ばんえい十勝【公式】',
    sub: '帯広',
    url: 'https://www.youtube.com/@%E3%81%B0%E3%82%93%E3%81%88%E3%81%84%E5%8D%81%E5%8B%9D%E5%85%AC%E5%BC%8F',
    label: 'ばんえい十勝',
  },
  {
    heading: '【公式】ホッカイドウ競馬',
    sub: '門別・札幌',
    url: 'https://www.youtube.com/@live2820',
    label: 'ホッカイドウ',
  },
  {
    heading: '岩手競馬',
    sub: '盛岡・水沢',
    url: 'https://www.youtube.com/@IwateKeibaITV',
    label: '岩手競馬',
  },
];

/** @type {readonly { heading: string; sub: string; url: string; label: string }[]} */
const YT_NAN_KANTO = [
  {
    heading: '浦和競馬【公式】',
    sub: '浦和',
    url: 'https://www.youtube.com/@%E6%B5%A6%E5%92%8C%E7%AB%B6%E9%A6%AC%E5%85%AC%E5%BC%8F',
    label: '浦和競馬',
  },
  {
    heading: '船橋競馬場',
    sub: '船橋',
    url: 'https://www.youtube.com/@funabashi-keiba',
    label: '船橋',
  },
  {
    heading: 'TCK 東京シティ競馬【公式】',
    sub: '大井',
    url: 'https://www.youtube.com/@tckkeiba',
    label: 'TCK 大井',
  },
  {
    heading: '【公式】川崎競馬',
    sub: '川崎',
    url: 'https://www.youtube.com/@%E5%85%AC%E5%BC%8F%E5%B7%9D%E5%B4%8E%E7%AB%B6%E9%A6%AC',
    label: '川崎競馬',
  },
];

/** @type {readonly { heading: string; sub: string; url: string; label: string }[]} */
const YT_CHUBU_HOKURIKU = [
  {
    heading: '金沢競馬【公式】',
    sub: '金沢',
    url: 'https://www.youtube.com/@%E9%87%91%E6%B2%A2%E7%AB%B6%E9%A6%AC%E5%85%AC%E5%BC%8F%E3%83%81%E3%83%A3%E3%83%B3%E3%83%8D%E3%83%AB',
    label: '金沢競馬',
  },
  {
    heading: '笠松けいば',
    sub: 'レース映像配信',
    url: 'https://www.youtube.com/@%E7%AC%A0%E6%9D%BE%E3%81%91%E3%81%84%E3%81%B0%E3%83%AC%E3%83%BC%E3%82%B9%E6%98%A0%E5%83%8F%E9%85%8D%E4%BF%A1%E3%83%81%E3%83%A3',
    label: '笠松',
  },
  {
    heading: '金シャチけいば情報',
    sub: '名古屋',
    url: 'https://www.youtube.com/@%E9%87%91%E3%82%B7%E3%83%A3%E3%83%81%E3%81%91%E3%81%84%E3%81%B0%E6%83%85%E5%A0%B1',
    label: '名古屋',
  },
];

/** @type {readonly { heading: string; sub: string; url: string; label: string }[]} */
const YT_KINKI_SHIKOKU_KYUSHU = [
  {
    heading: 'そのだけいば・ひめじけいば',
    sub: '園田・姫路',
    url: 'https://www.youtube.com/@sonodahimejiweb',
    label: '園田・姫路',
  },
  {
    heading: '高知けいば',
    sub: '高知',
    url: 'https://www.youtube.com/@KeibaOrJp',
    label: '高知',
  },
  {
    heading: 'sagakeiba official',
    sub: '佐賀',
    url: 'https://www.youtube.com/@sagakeibaofficial',
    label: '佐賀競馬',
  },
];

/** @type {Record<string, readonly { heading: string; sub: string; url: string; label: string }[]>} */
const YOUTUBE_BY_REGION = {
  central: YT_CENTRAL,
  hokkaido_tohoku: YT_HOKKAIDO_TOHOKU,
  nan_kanto: YT_NAN_KANTO,
  chubu_hokuriku: YT_CHUBU_HOKURIKU,
  kinki_shikoku_kyushu: YT_KINKI_SHIKOKU_KYUSHU,
};

function webLinkButton(url, label) {
  return new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setURL(url)
    .setLabel(label)
    .setEmoji(botingEmoji('web'));
}

function youtubeLinkButton(url, label) {
  return new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setURL(url)
    .setLabel(label)
    .setEmoji(botingEmoji('youtube'));
}

function linkSection(body, button) {
  return new SectionBuilder()
    .addTextDisplayComponents((td) => td.setContent(body))
    .setButtonAccessory(() => button);
}

/**
 * @param {string} currentId
 */
function buildHelpRegionSelectRow(currentId) {
  const cur = normalizeBotingHelpRegion(currentId);
  const tab = BOTING_HELP_REGION_TABS.find((t) => t.id === cur);
  const placeholder = tab ? `地域タブ（表示中: ${tab.label}）` : '地域タブを選択';

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(BOTING_HELP_REGION_SELECT)
      .setPlaceholder(placeholder)
      .addOptions(
        ...BOTING_HELP_REGION_TABS.map((t) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(t.label)
            .setValue(t.id)
            .setDescription(t.description)
            .setDefault(t.id === cur),
        ),
      ),
  );
}

/**
 * `/boting` のヘルプ（JRA 初心者向け・地域別 YouTube）
 * @param {{ extraFlags?: number, region?: string }} opts
 */
export function buildBotingHelpPanelPayload({ extraFlags = 0, region = 'overview' } = {}) {
  const r = normalizeBotingHelpRegion(region);
  const container = new ContainerBuilder().setAccentColor(HUB_ACCENT);

  if (r === 'overview') {
    container
      .addTextDisplayComponents((td) =>
        td.setContent(
          '## ヘルプ\n' +
            '実馬券の種類・ルールは JRA の公式ページから。ライブ配信は下の**地域タブ**で場所を選ぶと YouTube の公式チャンネルへ飛べます。',
        ),
      )
      .addSectionComponents(
        linkSection(
          channelEntryBody(
            '馬券の種類（はじめての方へ）',
            '単勝・複勝など10種類の概要',
          ),
          webLinkButton(URL_BAKEN_TYPES, 'JRA：馬券の種類'),
        ),
        linkSection(
          channelEntryBody('馬券のルール', '発売・払戻・成立など'),
          webLinkButton(URL_BAKEN_RULES, 'JRA：馬券のルール'),
        ),
      )
      .addTextDisplayComponents((td) =>
        td.setContent(
          '### YouTube（ライブ）\n南関東・北海道など、**地域タブ**から選んでください。',
        ),
      );
  } else {
    const tab = BOTING_HELP_REGION_TABS.find((t) => t.id === r);
    const yt = YOUTUBE_BY_REGION[r] || [];
    const title = tab ? tab.label : r;
    container.addTextDisplayComponents((td) =>
      td.setContent(
        `## ${title}\n右のボタンから各公式チャンネル（YouTube）を開けます。`,
      ),
    );
    for (const row of yt) {
      container.addSectionComponents(
        linkSection(
          channelEntryBody(row.heading, row.sub),
          youtubeLinkButton(row.url, row.label),
        ),
      );
    }
    container.addTextDisplayComponents((td) =>
      td.setContent('別の地域は下の**地域タブ**から選び直せます。'),
    );
  }

  return {
    content: null,
    embeds: [],
    components: [container, buildHelpRegionSelectRow(r), buildBotingMenuBackRow()],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}
