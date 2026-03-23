import https from 'https';

const url =
  'https://nar.netkeiba.com/race/result.html?race_id=202446091009';
https
  .get(
    url,
    { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Botting-debug/1)' } },
    (res) => {
      let d = '';
      res.on('data', (c) => {
        d += c;
      });
      res.on('end', () => {
        const re =
          /<tr[^>]*class="([^"]*)"[^>]*>\s*<th[^>]*>([^<]+)/g;
        let m;
        let n = 0;
        while ((m = re.exec(d)) !== null && n < 40) {
          const lab = m[2].replace(/\s+/g, ' ').trim();
          if (/単|複|枠|馬|連|勝|wide/i.test(lab) || /[3３]/.test(lab)) {
            console.log(m[1], '|', lab);
            n++;
          }
        }
      });
    },
  )
  .on('error', console.error);
