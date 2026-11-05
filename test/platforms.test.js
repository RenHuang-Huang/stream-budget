import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORMS, backfillUrls, isTabDoneKey, platformLabel, platformColor, aliasPlatforms } from '../src/lib/platforms.js';

test('平台 key 不重複，manual 在最後', () => {
  const keys = PLATFORMS.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.at(-1), 'manual');
});

test('backfillUrls 包含平台與來源的紀錄頁', () => {
  const urls = backfillUrls();
  assert.equal(urls.length, 5);
  assert.ok(urls.includes('https://pay.google.com/gp/w/home/activity'));
});

test('isTabDoneKey：平台分頁與 gpay 總結可關，gpay 單一付款資料不可關', () => {
  assert.ok(isTabDoneKey('hivebee:sponsorship'));
  assert.ok(isTabDoneKey('twitch:bits'));
  assert.ok(isTabDoneKey('gpay'));
  assert.ok(!isTabDoneKey('gpay:某付款資料'));
  assert.ok(!isTabDoneKey('youtube:x')); // YouTube 沒有自己的紀錄頁
  assert.ok(!isTabDoneKey('hivebee'));
});

test('未知平台退回 key 與 --other', () => {
  assert.equal(platformLabel('ecpay'), 'ecpay');
  assert.equal(platformColor('ecpay'), '--other');
  assert.deepEqual(aliasPlatforms().map((p) => p.key), ['hivebee', 'youtube', 'twitch']);
});

test('contentScriptsOf：id 加平台前綴、沒寫 matches 用全部 origins', async () => {
  const { connectables, contentScriptsOf } = await import('../src/lib/platforms.js');
  const all = connectables().flatMap(contentScriptsOf);
  assert.equal(new Set(all.map((s) => s.id)).size, all.length);
  const tw = contentScriptsOf(connectables().find((c) => c.key === 'twitch'));
  assert.deepEqual(tw.find((s) => s.id === 'twitch-main'), {
    id: 'twitch-main', matches: ['https://www.twitch.tv/*'], runAt: 'document_idle', persistAcrossSessions: true,
    js: ['src/content/twitch-main.js'], world: 'MAIN',
  });
  assert.deepEqual(connectables().map((c) => c.key), ['hivebee', 'youtube', 'twitch', 'gpay']);
});

test('backfillUrls 只取已連結的', () => {
  assert.deepEqual(backfillUrls({ twitch: true }), [
    'https://www.twitch.tv/wallet?tab=purchase-history',
    'https://www.twitch.tv/wallet?tab=bits-usage-history',
  ]);
  assert.deepEqual(backfillUrls({}), []);
});
