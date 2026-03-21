/**
 * netkeiba 系の競馬場コード（race_id の場コード2桁など）→ 表示名
 * @see 中央・地方・海外コード一覧（netkeiba 等で用いられる対応）
 */
const NETKEIBA_VENUE_BY_CODE = {
  '01': '札幌',
  '02': '函館',
  '03': '福島',
  '04': '新潟',
  '05': '東京',
  '06': '中山',
  '07': '中京',
  '08': '京都',
  '09': '阪神',
  '10': '小倉',
  '31': '北見',
  '32': '岩見沢',
  '33': '帯広',
  '34': '旭川',
  '35': '盛岡',
  '36': '水沢',
  '37': '上山',
  '38': '三条',
  '39': '足利',
  '40': '宇都宮',
  '41': '高崎',
  '42': '浦和',
  '43': '船橋',
  '44': '大井',
  '45': '川崎',
  '46': '金沢',
  '47': '笠松',
  '48': '名古屋',
  '49': '(未使用)',
  '50': '園田',
  '51': '姫路',
  '52': '益田',
  '53': '福山',
  '54': '高知',
  '55': '佐賀',
  '56': '荒尾',
  '57': '中津',
  '58': '札幌（地方競馬）',
  '59': '函館（地方競馬）',
  '60': '新潟（地方競馬）',
  '61': '中京（地方競馬）',
  A0: 'その他の外国',
  A2: '日本',
  A4: 'アメリカ',
  A6: 'イギリス',
  A8: 'フランス',
  B0: 'インド',
  B2: 'アイルランド',
  B4: 'ニュージーランド',
  B6: 'オーストラリア',
  B8: 'カナダ',
  C0: 'イタリア',
  C2: 'ドイツ',
  C4: 'アラブ首長国連邦',
  C6: 'イラク',
  C8: 'シリア',
  D0: 'スウェーデン',
  D2: 'ハンガリー',
  D4: 'ポルトガル',
  D6: 'ロシア',
  D8: 'ウルグアイ',
  E0: 'ペルー',
  E2: 'アルゼンチン',
  E4: 'ブラジル',
  E6: 'ベルギー',
  E8: 'トルコ',
  F0: '韓国',
  F2: 'チリ',
  F4: '(未使用)',
  F6: '(未使用)',
  F8: 'パナマ',
  G0: '香港',
  G2: 'スペイン',
  G4: '(未使用)',
  G6: '(未使用)',
  G8: '(未使用)',
  H0: '西ドイツ',
  H2: '南アフリカ',
  H4: 'スイス',
  H6: 'モナコ',
  H8: 'フィリピン',
  I0: 'プエルトリコ',
  I2: 'コロンビア',
  I4: 'チェコスロバキア',
  I6: 'チェコ',
  I8: 'スロバキア',
  J0: 'エクアドル',
  J2: 'ギリシャ',
  J4: 'マレーシア',
  J6: 'メキシコ',
  J8: 'モロッコ',
  K0: 'パキスタン',
  K2: 'ポーランド',
  K4: 'バングラディッシュ',
  K6: 'サウジアラビア',
  K8: 'キプロス',
  L0: 'タイ',
  L2: 'ウクライナ',
  L4: 'ベネズエラ',
  L6: 'ユーゴスラビア',
  L8: 'デンマーク',
  M0: 'シンガポール',
  M2: 'マカオ',
  M4: 'オーストリア',
  M6: 'ヨルダン',
  M8: 'カタール',
};

/**
 * @param {string} twoChar 英数字2桁（例: 05, A0）
 * @returns {string}
 */
export function netkeibaVenueNameFromTwoCharCode(twoChar) {
  if (!twoChar || String(twoChar).length !== 2) return '';
  const k = String(twoChar).toUpperCase();
  return NETKEIBA_VENUE_BY_CODE[k] || '';
}

/**
 * 開催一覧の見出しが「1回 阪神 10日目」「11回 水沢 1日目」のとき、場名（阪神・水沢）だけにする。
 * @param {string} raw
 * @returns {string}
 */
export function normalizeScheduleVenueDisplayName(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';

  const roundDay = s.match(/^\d+回\s*(.+?)\s*\d+日目$/);
  if (roundDay) {
    s = roundDay[1].trim();
  } else {
    const roundDay2 = s.match(/^第\d+回\s*(.+?)\s*第?\d+日目$/);
    if (roundDay2) s = roundDay2[1].trim();
  }

  s = s.replace(/競馬場\s*$/u, '').trim();
  return s;
}

/**
 * @param {string} raceId
 * @returns {string} 不明時は空文字（12桁数字のみ対象）
 */
export function jraVenueShortFromRaceId(raceId) {
  if (!/^\d{12}$/.test(String(raceId || ''))) return '';
  const pp = String(raceId).slice(4, 6);
  return netkeibaVenueNameFromTwoCharCode(pp);
}
