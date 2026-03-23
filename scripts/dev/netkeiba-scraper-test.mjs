/**
 * Netkeiba スクレイパーの手動試験（開発用）
 * 実行: node --env-file=dev.env scripts/dev/netkeiba-scraper-test.mjs
 */
import NetkeibaScraper from '../../src/scrapers/netkeiba/netkeibaScraper.mjs';
import { pathToFileURL } from 'node:url';

async function testScraper() {
  const scraper = new NetkeibaScraper();
  const raceId = process.env.TEST_RACE_ID || '202606020701';

  console.log('🐎 Netkeiba Scraper Test Starting...');
  console.log(`Race ID: ${raceId}`);
  console.log('='.repeat(50));

  try {
    const result = await scraper.scrapeRaceCard(raceId);

    const hasMojibake = checkForMojibake(result);

    const content = `
## 📊 Scraping Results

**Race Information:**
- Title: ${result.raceInfo?.title || 'N/A'}
- Date: ${result.raceInfo?.date || 'N/A'}
- Course: ${result.raceInfo?.course || 'N/A'}
- Class: ${result.raceInfo?.class || 'N/A'}
- Total Horses: ${result.totalHorses}

**Horse Entries:**
${result.horses.map((horse, index) => `
${index + 1}. **${horse.name}** 
   - Frame: ${horse.frameNumber} | Number: ${horse.horseNumber}
   - Age: ${horse.age} | Weight: ${horse.weight}kg
   - Odds: ${horse.odds} | Place〜: ${horse.placeOddsMin ?? 'N/A'} | Popularity: ${horse.popularity}
   - Jockey: ${horse.jockey} | Trainer: ${horse.trainer}
   - Horse ID: ${horse.horseId || 'N/A'}
   - URL: ${horse.url || 'N/A'}
`).join('')}

**Scraping Details:**
- Method Used: ${result.method || 'cheerio'}
- Odds official time: ${result.oddsOfficialTime || 'N/A'}
- Scraped At: ${result.scrapedAt}
- Character Encoding: ${hasMojibake ? '❌ 文字化けが検出されました' : '✅ 正常'}
- Success: ${hasMojibake ? '⚠️' : '✅'}
    `;

    console.log(content);

    if (hasMojibake) {
      console.warn(
        '\n⚠️ 警告: 文字化けが検出されました。エンコーディング設定を確認してください。',
      );
    }

    return { success: !hasMojibake, content, data: result };
  } catch (error) {
    const errorContent = `
## ❌ Scraping Failed

**Error Details:**
- Message: ${error.message}
- Type: ${error.name}
- Time: ${new Date().toISOString()}
    `;

    console.error(error);
    console.log(errorContent);
    return { success: false, content: errorContent, error };
  }
}

function checkForMojibake(result) {
  const mojibakePattern = /[\uFFFD�]|[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

  if (result.raceInfo) {
    for (const value of Object.values(result.raceInfo)) {
      if (typeof value === 'string' && mojibakePattern.test(value)) {
        console.warn(`文字化け検出 (レース情報): ${value}`);
        return true;
      }
    }
  }

  for (const horse of result.horses) {
    for (const [key, value] of Object.entries(horse)) {
      if (typeof value === 'string' && mojibakePattern.test(value)) {
        console.warn(
          `文字化け検出 (${horse.name || 'Unknown'} - ${key}): ${value}`,
        );
        return true;
      }
    }
  }

  return false;
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  testScraper().then((result) => {
    process.exit(result.success ? 0 : 1);
  });
}

export { testScraper };
