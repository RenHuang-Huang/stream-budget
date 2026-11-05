// 在真的 Chromium 載入 extension，把 HiveBee 網址導向本地 fixture，驗證整條流程
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync, mkdtempSync } from 'node:fs';
import { makeTestExtension, connectAll } from './test-extension.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const ext = makeTestExtension();
const fixtures = {
  sponsorship: readFileSync(path.join(root, 'test/fixtures/hivebee-sponsorship.html'), 'utf8'),
  subscription: readFileSync(path.join(root, 'test/fixtures/hivebee-subscription.html'), 'utf8'),
};
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'sb-')), {
  channel: 'chromium',
  timezoneId: 'Asia/Taipei',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;

  // 先在設定頁連結 HiveBee（沒連結的平台不會註冊 content script）
  const opts = await ctx.newPage();
  await opts.goto(`chrome-extension://${extId}/options/options.html`);
  await connectAll(opts, ['hivebee']);
  const registered = await opts.evaluate(() => chrome.runtime.sendMessage({ type: 'getConnections' }));
  assert.deepEqual(registered.data, { hivebee: true });

  await ctx.route('https://www.hivebee.com.tw/**', (r) => {
    const tab = new URL(r.request().url()).searchParams.get('tab');
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: fixtures[tab] ?? fixtures.sponsorship });
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto('https://www.hivebee.com.tw/member/history?tab=sponsorship');
  await page.waitForSelector('#sb-banner', { timeout: 10000 });
  await page.goto('https://www.hivebee.com.tw/member/history?tab=subscription');
  await page.waitForSelector('#sb-banner', { timeout: 10000 });
  console.log('content script log:', logs.filter((l) => l.startsWith('[SB]')));
  console.log('banner:', await page.locator('#sb-banner').innerText());
  await page.screenshot({ path: path.join(root, 'test/out-hivebee.png') });

  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForSelector('#streamers li');
  await popup.locator('#unmatchedBox').evaluate((d) => (d.open = true));
  const nov = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'getSummary', month: '2026-11' }));
  const oct = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'getSummary', month: '2026-10' }));
  await popup.locator('#month').fill('2026-11');
  await popup.locator('#month').dispatchEvent('change');
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: path.join(root, 'test/out-popup.png'), fullPage: true });

  // 贊助：11月 550（心可可 200，失敗的 500 不算）、10月 300（心可可 200）
  // VIP：11月 +750、10月 +7000（"$7000 / $10000" 取實際付款）
  assert.equal(nov.data.total, 1300);
  assert.equal(nov.data.streamers[0].spent, 950);
  assert.equal(oct.data.total, 7300);
  assert.equal(oct.data.streamers[0].spent, 7200);
  console.log('11月:', nov.data.total, '心可可', nov.data.streamers[0].spent, '| 10月:', oct.data.total, '心可可', oct.data.streamers[0].spent);
  console.log('E2E OK');
} finally {
  await ctx.close();
}
