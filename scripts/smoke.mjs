// Quick mobile smoke test. Needs: npm i -D playwright (and a chromium). Usage: node scripts/smoke.mjs
// Serves index.html locally, opens every view at 390x844 (light + dark), fails on page errors or horizontal overflow.
import http from 'node:http';
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { chromium } from 'playwright';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  const path = q.url.split('?')[0].split('#')[0];
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (file.includes('..') || !existsSync(file) || !statSync(file).isFile()) { r.statusCode = 404; return r.end('Not found'); }
  r.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream'); r.end(readFileSync(file));
}).listen(0);
const port = srv.address().port;
const views = ['home', 'breathe', 'reset', 'rituals', 'log', 'summary', 'meds', 'numbers'];
const browser = await chromium.launch();
let bad = 0;
mkdirSync('shots', { recursive: true });
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  for (const v of views) {
    await page.goto(`http://localhost:${port}/#${v}`);
    await page.waitForTimeout(700);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) { console.log(`FAIL ${scheme}/${v}: horizontal overflow ${over}px`); bad++; }
    await page.screenshot({ path: `shots/${scheme}-${v}.png` });
  }
  if (errs.length) { console.log(`FAIL ${scheme}: page errors`, errs); bad++; }
  await ctx.close();
}
await browser.close(); srv.close();
console.log(bad ? `${bad} problem(s)` : 'smoke OK (screenshots in shots/)');
process.exit(bad ? 1 : 0);
