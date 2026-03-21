import NetkeibaScraper from './netkeibaScraper.mjs';
import { pathToFileURL } from 'node:url';

async function testScraper() {
  const scraper = new NetkeibaScraper();
  // トップのピックアップ等、実在する race_id に差し替えて試験してください
  const raceId = process.env.TEST_RACE_ID || '202606020701';
  
  console.log('🐎 Netkeiba Scraper Test Starting...');
  console.log(`Race ID: ${raceId}`);
  console.log('=' .repeat(50));

  try {
    const result = await scraper.scrapeRaceCard(raceId);
    
    // 文字化けチェック
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
    
    // 文字化けが検出された場合は警告
    if (hasMojibake) {
      console.warn('\n⚠️ 警告: 文字化けが検出されました。エンコーディング設定を確認してください。');
    }
    
    return { success: !hasMojibake, content, data: result };

  } catch (error) {
    const errorContent = `
## ❌ Scraping Failed

**Error Details:**
- Message: ${error.message}
- Type: ${error.name}
- Time: ${new Date().toISOString()}

**Possible Issues:**
- Anti-scraping protection activated
- Network connectivity problems  
- HTML structure changes
- Rate limiting applied
- Character encoding issues

**Recommended Actions:**
1. Check network connection
2. Try again after a few minutes
3. Use Puppeteer fallback mode
4. Verify race ID is valid
5. Check encoding settings
    `;
    
    console.error(error);
    console.log(errorContent);
    return { success: false, content: errorContent, error };
  }
}

/**
 * 文字化けチェック関数
 */
function checkForMojibake(result) {
  const mojibakePattern = /[\uFFFD�]|[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
  
  // レース情報のチェック
  if (result.raceInfo) {
    for (const value of Object.values(result.raceInfo)) {
      if (typeof value === 'string' && mojibakePattern.test(value)) {
        console.warn(`文字化け検出 (レース情報): ${value}`);
        return true;
      }
    }
  }
  
  // 馬情報のチェック
  for (const horse of result.horses) {
    for (const [key, value] of Object.entries(horse)) {
      if (typeof value === 'string' && mojibakePattern.test(value)) {
        console.warn(`文字化け検出 (${horse.name || 'Unknown'} - ${key}): ${value}`);
        return true;
      }
    }
  }
  
  return false;
}

// 実行（Windows でも import.meta.url と argv を正しく突き合わせる）
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  testScraper().then((result) => {
    process.exit(result.success ? 0 : 1);
  });
}

export { testScraper };