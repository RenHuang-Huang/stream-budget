// 產生 Chrome 線上應用程式商店用的圖（npm run store:shots）→ docs/store/
// 素材是 docs/images/ 的教學截圖（虛構資料，先跑 npm run docs:shots 可重拍）。
// 截圖 1280×800；小型宣傳圖塊 440×280。
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs/store');
mkdirSync(out, { recursive: true });

const img = (f) => `data:image/png;base64,${readFileSync(path.join(root, f)).toString('base64')}`;
const font = `system-ui, -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;

const shots = [
  { name: '1-stats', src: 'docs/images/08-stats.png', title: '每月花在誰身上，一眼看懂', sub: '趨勢、平台比例、直播主預算進度、每日熱力圖' },
  { name: '2-popup', src: 'docs/images/07-popup.png', title: '本月預算隨時掌握', sub: '總額與每位直播主的進度，接近上限就提醒', side: true },
  { name: '3-guard', src: 'docs/images/10-guard.png', title: '送出前先看一眼', sub: '贊助按鈕旁顯示「送出後本月會變成多少」，只提醒、不阻擋' },
  { name: '4-connect', src: 'docs/images/02-connect-on.png', title: '自己選要連結哪些平台', sub: 'HiveBee、YouTube、Twitch；沒連結的網站完全不讀取' },
  { name: '5-streamers', src: 'docs/images/05-streamers.png', title: '跨平台自動對應同一位直播主', sub: '每人各設上限，資料只存在你的電腦' },
];

const page = (body, w, h) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:${w}px;height:${h}px;overflow:hidden;font-family:${font};color:#141a2e;
    background:linear-gradient(135deg,#eaf2fd 0%,#f3f5fa 55%,#fdeee6 100%)}
  .shot{border-radius:14px;box-shadow:0 2px 6px rgb(20 26 46/.08),0 18px 48px rgb(20 26 46/.16);background:#fff}
  h1{font-size:44px;font-weight:800;letter-spacing:.01em}
  p{font-size:22px;color:#4b5371;margin-top:12px;line-height:1.5}
</style></head><body>${body}</body></html>`;

const top = (s) => `<div style="height:800px;display:flex;flex-direction:column;align-items:center;padding:48px 56px 40px">
  <h1>${s.title}</h1><p>${s.sub}</p>
  <div style="flex:1;min-height:0;width:100%;display:flex;align-items:center;justify-content:center;margin-top:32px">
    <img class="shot" src="${img(s.src)}" style="max-width:100%;max-height:100%"></div></div>`;

const side = (s) => `<div style="height:800px;display:flex;align-items:center;gap:72px;padding:48px 96px">
  <div style="flex:1"><h1>${s.title}</h1><p>${s.sub}</p></div>
  <img class="shot" src="${img(s.src)}" style="max-height:704px"></div>`;

const tile = `<div style="height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px">
  <img src="${img('icons/icon128.png')}" style="width:88px;height:88px">
  <div style="font-size:34px;font-weight:800">斗內預算管家</div>
  <div style="font-size:16px;color:#4b5371">直播贊助的每月預算與提醒</div></div>`;

const browser = await chromium.launch();
const render = async (html, w, h, file) => {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'load' });
  await p.screenshot({ path: path.join(out, file) });
  await p.close();
  console.log(`docs/store/${file}`);
};
for (const s of shots) await render(page(s.side ? side(s) : top(s), 1280, 800), 1280, 800, `screenshot-${s.name}.png`);
await render(page(tile, 440, 280), 440, 280, 'promo-small-440x280.png');
await browser.close();
