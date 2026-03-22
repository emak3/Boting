import iconv from 'iconv-lite';

/**
 * HTTPレスポンスからエンコーディングを検出
 */
export function detectEncodingFromResponse(response) {
  // Content-Typeヘッダーからエンコーディングを取得
  const contentType = response.headers['content-type'] || '';
  const charsetMatch = contentType.match(/charset=([^;]+)/i);
  
  if (charsetMatch) {
    return charsetMatch[1].trim().toUpperCase();
  }
  
  return null;
}

/**
 * HTMLコンテンツからエンコーディングを検出
 */
export function detectEncodingFromHtml(buffer) {
  // バッファの最初の部分を読んでメタタグを探す
  const sample = buffer.slice(0, 2048).toString('ascii');
  
  // meta charset を探す
  const metaCharsetMatch = sample.match(/<meta[^>]+charset=["']?([^"'\s>]+)/i);
  if (metaCharsetMatch) {
    return metaCharsetMatch[1].trim().toUpperCase();
  }
  
  // meta http-equiv を探す
  const httpEquivMatch = sample.match(/<meta[^>]+content=["'][^"']*charset=([^"'\s;]+)/i);
  if (httpEquivMatch) {
    return httpEquivMatch[1].trim().toUpperCase();
  }
  
  return null;
}

function requestUrl(response) {
  return response?.config?.url ?? response?.request?.path ?? null;
}

function logEncoding(level, message, ctx, extra = {}) {
  const payload = {
    label: ctx.label ?? 'handleEncoding',
    url: ctx.url ?? requestUrl(ctx.response),
    ...extra,
  };
  console[level](`[encoding] ${message}`, payload);
}

/**
 * エンコーディングを自動検出して変換
 * @param {Buffer|ArrayBuffer} buffer
 * @param {object|null} response axios レスポンス（ヘッダ検出用）
 * @param {{ label?: string, url?: string }} [context] 失敗時ログ用（処理名・URL）
 */
export function handleEncoding(buffer, response = null, context = {}) {
  const ctx = { ...context, response };
  try {
    let encoding = 'EUC-JP'; // netkeiba のデフォルト

    // 1. レスポンスヘッダーから検出を試みる
    if (response) {
      const headerEncoding = detectEncodingFromResponse(response);
      if (headerEncoding) {
        encoding = headerEncoding;
      }
    }

    // 2. HTMLコンテンツから検出を試みる
    const htmlEncoding = detectEncodingFromHtml(buffer);
    if (htmlEncoding) {
      encoding = htmlEncoding;
    }

    encoding = normalizeEncoding(encoding);

    const decoded = iconv.decode(buffer, encoding);

    if (containsMojibake(decoded)) {
      const alternatives = ['EUC-JP', 'SHIFT_JIS', 'ISO-2022-JP', 'UTF-8'];
      for (const alt of alternatives) {
        if (alt !== encoding) {
          try {
            const altDecoded = iconv.decode(buffer, alt);
            if (!containsMojibake(altDecoded)) {
              return altDecoded;
            }
          } catch {
            // 次の代替エンコーディングを試す
          }
        }
      }
      logEncoding(
        'warn',
        'mojibake suspected after primary decode and all alternatives; returning primary decode',
        ctx,
        {
          primaryEncoding: encoding,
          tried: alternatives.filter((a) => a !== encoding),
        },
      );
    }

    return decoded;
  } catch (error) {
    logEncoding('error', 'iconv.decode or detection threw', ctx, {
      err: error?.message ?? String(error),
      stack: error?.stack,
    });
    const fallbackEncodings = ['EUC-JP', 'SHIFT_JIS', 'UTF-8'];

    for (const enc of fallbackEncodings) {
      try {
        const decoded = iconv.decode(buffer, enc);
        if (!containsMojibake(decoded)) {
          logEncoding('warn', 'recovered using fallback decode after error', ctx, {
            encoding: enc,
          });
          return decoded;
        }
      } catch {
        continue;
      }
    }

    logEncoding('warn', 'all fallbacks failed or still suspect; using UTF-8 string', ctx, {
      tried: fallbackEncodings,
    });
    return buffer.toString('utf8');
  }
}

/**
 * エンコーディング名の正規化
 */
function normalizeEncoding(encoding) {
  const normalized = encoding.toUpperCase().replace(/[-_]/g, '');
  
  const encodingMap = {
    'EUCJP': 'EUC-JP',
    'SHIFTJIS': 'SHIFT_JIS',
    'SJIS': 'SHIFT_JIS',
    'ISO2022JP': 'ISO-2022-JP',
    'UTF8': 'UTF-8',
  };
  
  return encodingMap[normalized] || encoding;
}

/**
 * 文字化けの簡易チェック（HTML 全体は英字・タグが多く日本語比率が低いため比率判定はしない）
 */
function containsMojibake(text) {
  const mojibakePatterns = [
    /[\uFFFD]/,
    /[�]/,
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/,
  ];
  return mojibakePatterns.some((pattern) => pattern.test(text));
}