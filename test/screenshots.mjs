// 產生 docs/教學.md 用的截圖（npm run docs:shots）
// 全新的瀏覽器設定檔＋虛構資料，不會拍到任何真實紀錄。虛構紀錄的日期在 2026 年 6～11 月。
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeTestExtension, connectAll, root } from './test-extension.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const out = path.join(root, 'docs/images');
mkdirSync(out, { recursive: true });
const shot = (name) => path.join(out, `${name}.png`);

// ── 虛構資料 ──
const streamers = [
  { id: 'hoshi', name: '星野晴晴', limit: 1500, aliases: { hivebee: ['星野晴晴'], youtube: ['Hoshi Haru'], twitch: ['hoshi_haru'] } },
  { id: 'lia', name: '莉雅·薇絲', limit: 1000, aliases: { hivebee: ['莉雅'], youtube: ['Lia Wiss'], twitch: [] } },
  { id: 'polu', name: '千千波露', limit: 800, aliases: { hivebee: [], youtube: ['MeowMeowPolu'], twitch: ['meowpolu'] } },
  { id: 'suzu', name: '涼風晨歌', limit: 1000, aliases: { hivebee: ['涼風晨歌'], youtube: [], twitch: [] } },
  { id: 'yuki', name: '雪見小夜', limit: 1000, aliases: { hivebee: [], youtube: ['Yukimi Sayo'], twitch: [] } },
];
const settings = {
  totalLimit: 3500, defaultStreamerLimit: 1000, warnRatio: 0.8, bitsToTWD: 0.45, fxRates: { USD: 32 },
  gpayProfiles: { 我的付款資料: true }, autoMatch: false, syncInterval: 360, autoMatchIgnore: [], connected: {}, streamers,
};
let n = 0;
const rec = (platform, channel, amount, date, kind = 'donate', extra = {}) => ({
  id: `demo:${++n}`, platform, channel, amount, currency: 'TWD', time: `${date}T20:${String(n % 60).padStart(2, '0')}:00+08:00`,
  kind, counted: true, ...extra,
});
const records = Object.fromEntries([
  rec('hivebee', '星野晴晴', 300, '2026-06-03'), rec('youtube', 'Hoshi Haru', 75, '2026-06-12', 'membership'),
  rec('hivebee', '莉雅', 150, '2026-06-20'), rec('youtube', 'MeowMeowPolu', 600, '2026-07-04', 'superchat'),
  rec('hivebee', '星野晴晴', 500, '2026-07-11'), rec('youtube', 'Hoshi Haru', 75, '2026-07-12', 'membership'),
  rec('twitch', 'meowpolu', 159, '2026-07-25', 'sub'), rec('hivebee', '涼風晨歌', 200, '2026-08-02'),
  rec('youtube', 'Hoshi Haru', 75, '2026-08-12', 'membership'), rec('hivebee', '星野晴晴', 1200, '2026-08-15'),
  rec('youtube', 'Lia Wiss', 300, '2026-08-28', 'superchat'), rec('twitch', 'hoshi_haru', 225, '2026-09-06', 'cheer'),
  rec('youtube', 'Hoshi Haru', 75, '2026-09-12', 'membership'), rec('hivebee', '莉雅', 450, '2026-09-19'),
  rec('youtube', 'Yukimi Sayo', 150, '2026-09-27', 'superchat'), rec('hivebee', '星野晴晴', 800, '2026-10-03'),
  rec('youtube', 'Hoshi Haru', 75, '2026-10-12', 'membership'), rec('youtube', 'MeowMeowPolu', 1500, '2026-10-18', 'superchat'),
  rec('hivebee', '涼風晨歌', 300, '2026-10-24'), rec('twitch', 'meowpolu', 159, '2026-10-25', 'sub'),
  rec('hivebee', '星野晴晴', 900, '2026-11-01'), rec('youtube', 'Lia Wiss', 150, '2026-11-02', 'superchat'),
  rec('youtube', 'Hoshi Haru', 75, '2026-11-03', 'membership'), rec('twitch', 'meowpolu', 450, '2026-11-04', 'cheer'),
  rec('youtube', '路過的小頻道', 30, '2026-11-04', 'superchat'),
].map((r) => [r.id, r]));

// Twitch 直播頁的簡化示意（只有聊天輸入框與按鈕列，結構和真的頁面一樣）
const twitchPage = `<!doctype html><html><head><meta charset="utf-8"><title>星野晴晴 - Twitch</title>
<style>body{margin:0;background:#0e0e10;color:#efeff1;font:14px system-ui,sans-serif;display:flex;height:100vh}
.video{flex:1;display:grid;place-items:center;color:#adadb8;background:linear-gradient(135deg,#1f1f23,#2b2140)}
.chat{width:340px;border-left:1px solid #2f2f35;display:flex;flex-direction:column}
.chat h3{margin:0;padding:12px;text-align:center;font-size:13px;border-bottom:1px solid #2f2f35}
.msgs{flex:1;padding:10px 12px;display:grid;align-content:end;gap:8px;color:#dedee3}
.msgs b{color:#bf94ff}.chat-input{padding:10px}
[data-a-target=chat-input]{border:2px solid #9147ff;border-radius:6px;padding:9px;min-height:20px;outline:none}
.chat-input__buttons-container{display:flex;justify-content:flex-end;margin-top:8px}
.chat-input__buttons-container button{background:#9147ff;color:#fff;border:0;border-radius:4px;padding:6px 12px;font-weight:600}</style></head>
<body><div class="video">（直播畫面）</div><div class="chat"><h3>聊天室</h3>
<div class="msgs"><div><b>觀眾A</b>：晚安～</div><div><b>觀眾B</b>：今天唱什麼歌</div></div>
<div class="chat-input"><div data-a-target="chat-input" contenteditable="true"></div>
<div class="chat-input__buttons-container"><button>聊天</button></div></div></div></body></html>`;

const ext = makeTestExtension();
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'sb-shot-')), {
  channel: 'chromium', timezoneId: 'Asia/Taipei', locale: 'zh-TW', colorScheme: 'light', deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const url = (p) => `chrome-extension://${extId}/${p}`;
  await new Promise((r) => setTimeout(r, 2000)); // 等安裝時的初始化（寫入預設設定、自動對應）跑完，免得蓋掉示範資料
  await sw.evaluate(async ({ settings, records }) => {
    await chrome.storage.local.set({ settings, records, setupDone: false });
  }, { settings, records });
  const hideSavebar = '#savebar{display:none!important}';

  // 1. 第一次打開：連結平台（全部未連結）
  const opts = await ctx.newPage();
  await opts.setViewportSize({ width: 1180, height: 900 });
  await opts.goto(url('options/options.html'));
  await opts.addStyleTag({ content: hideSavebar });
  await opts.waitForSelector('#connectList li');
  await opts.locator('#sec-connect').screenshot({ path: shot('01-connect-off') });

  // 2. 勾選後（測試版擴充功能已有網站權限，等同使用者按了「允許」）
  await connectAll(opts);
  await opts.reload();
  await opts.addStyleTag({ content: hideSavebar });
  await opts.waitForSelector('#connectList li.on');
  await opts.locator('#sec-connect').screenshot({ path: shot('02-connect-on') });
  await opts.locator('#sec-import').screenshot({ path: shot('03-import') });
  await opts.locator('#sec-limits').screenshot({ path: shot('04-limits') });
  await opts.locator('#sec-streamers').screenshot({ path: shot('05-streamers') });
  await opts.locator('#sec-sync').screenshot({ path: shot('06-sync') });

  // 3. 彈出視窗
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 640 });
  await popup.goto(url('popup/popup.html'));
  await popup.waitForSelector('#streamers li');
  await popup.locator('#unmatchedBox').evaluate((d) => (d.open = true));
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: shot('07-popup'), fullPage: true });

  // 4. 統計頁
  const stats = await ctx.newPage();
  await stats.setViewportSize({ width: 1280, height: 900 });
  await stats.goto(url('stats/stats.html'));
  await stats.waitForTimeout(1500);
  await stats.screenshot({ path: shot('08-stats') });

  // 5. 送出前提醒（Twitch 聊天室輸入 Cheer）
  await ctx.route('https://www.twitch.tv/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: twitchPage }));
  const tw = await ctx.newPage();
  await tw.setViewportSize({ width: 1000, height: 560 });
  await tw.goto('https://www.twitch.tv/hoshi_haru');
  await tw.locator('[data-a-target=chat-input]').click();
  await tw.keyboard.type('Cheer500 加油！');
  await tw.waitForSelector('#sb-guard', { timeout: 10000 });
  await tw.waitForTimeout(500);
  await tw.screenshot({ path: shot('10-guard') });

  // 6. 深色模式
  await stats.emulateMedia({ colorScheme: 'dark' });
  await stats.waitForTimeout(800);
  await stats.screenshot({ path: shot('11-stats-dark') });

  console.log('截圖完成：', out);
} finally {
  await ctx.close();
}
