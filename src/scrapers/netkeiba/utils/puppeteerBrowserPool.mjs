import puppeteer from 'puppeteer';

/** @type {import('puppeteer').Browser | null} */
let browserInstance = null;

/** 起動・再接続を直列化（並列 getBrowser で二重 launch しない） */
let launchChain = Promise.resolve();

const DEFAULT_MAX_CONCURRENT_PAGES = 3;
let maxConcurrentPages = DEFAULT_MAX_CONCURRENT_PAGES;
let inFlightPages = 0;
/** @type {(() => void)[]} */
const waitQueue = [];

/**
 * 同時に開くタブの上限（メモリ・CPU 負荷用）。デフォルトは 3。
 * @param {number} n
 */
export function setPuppeteerMaxConcurrentPages(n) {
  const v = Math.max(1, Math.floor(Number(n)) || 1);
  maxConcurrentPages = v;
}

async function acquirePageSlot() {
  if (inFlightPages < maxConcurrentPages) {
    inFlightPages++;
    return;
  }
  await new Promise((resolve) => waitQueue.push(resolve));
  inFlightPages++;
}

function releasePageSlot() {
  inFlightPages--;
  const next = waitQueue.shift();
  if (next) next();
}

/**
 * ブラウザ起動を直列化し、切断時は次回で再 launch。
 */
async function getBrowser() {
  if (browserInstance?.isConnected()) {
    return browserInstance;
  }
  launchChain = launchChain.catch(() => {}).then(async () => {
    if (browserInstance?.isConnected()) {
      return browserInstance;
    }
    const b = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor',
        '--lang=ja-JP',
      ],
    });
    browserInstance = b;
    b.on('disconnected', () => {
      if (browserInstance === b) {
        browserInstance = null;
      }
    });
    return b;
  });
  return launchChain;
}

/**
 * プール済みブラウザで 1 ページを借り、終了後に閉じる。
 * @template T
 * @param {(page: import('puppeteer').Page) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withPuppeteerPage(fn) {
  await acquirePageSlot();
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    releasePageSlot();
  }
}

/**
 * プロセス終了時やメンテ用にブラウザを閉じる。
 */
export async function closePuppeteerBrowserPool() {
  const b = browserInstance;
  browserInstance = null;
  if (b?.isConnected()) {
    await b.close().catch(() => {});
  }
}
