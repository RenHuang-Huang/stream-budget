import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS as S, norm, matchStreamer, summarize, newAlerts, monthKey, toTWD, countedRecords } from '../src/lib/budget.js';

const rec = (o) => ({ platform: 'hivebee', currency: 'TWD', counted: true, time: '2026-11-02T12:00:00', ...o });

test('norm 去除 emoji 與符號', () => {
  assert.equal(norm('♡ cocor0'), 'cocor0');
  assert.equal(norm('🤍莉雅·薇絲✨LIA-VESS'), '莉雅薇絲liavess');
});

test('matchStreamer 用別名與名稱對應', () => {
  assert.equal(matchStreamer(S, 'hivebee', '♡ cocor0'), 'cocoro');
  assert.equal(matchStreamer(S, 'youtube', '心可可 Cocoro ch.'), 'cocoro');
  assert.equal(matchStreamer(S, 'hivebee', '星野晴晴'), null);
});

test('summarize 依月份、直播主、平台彙總，跳過失敗交易', () => {
  const rs = [
    rec({ id: 1, channel: '♡ cocor0', amount: 100 }),
    rec({ id: 2, channel: '♡ cocor0', amount: 100, platform: 'twitch', currency: 'BITS' }), // 100 bits * 0.45
    rec({ id: 3, channel: '星野晴晴', amount: 75 }),
    rec({ id: 4, channel: '♡ cocor0', amount: 999, counted: false }),
    rec({ id: 5, channel: '♡ cocor0', amount: 500, time: '2026-10-31T12:00:00' }),
  ];
  const s = summarize(rs, S, '2026-11');
  assert.equal(s.total, 100 + 45 + 75);
  assert.deepEqual(s.streamers[0].byPlatform, { hivebee: 100, twitch: 45 });
  assert.deepEqual(s.unmatched, [{ platform: 'hivebee', channel: '星野晴晴', spent: 75 }]);
});

test('超過上限產生通知，且同一門檻只通知一次', () => {
  const rs = [rec({ id: 1, channel: 'cocor0', amount: 1000 }), rec({ id: 2, channel: 'x', amount: 2500 })];
  const s = summarize(rs, S, '2026-11');
  assert.equal(s.totalLevel, 'over');
  assert.equal(s.streamers[0].level, 'over');
  const a = newAlerts(s, []);
  assert.equal(a.length, 2);
  assert.equal(newAlerts(s, a.map((x) => x.key)).length, 0);
});

test('monthKey 使用本地時區', () => {
  assert.equal(monthKey(new Date(2026, 10, 30, 23, 59)), '2026-11');
});

test('toTWD：USD 依匯率、Bits 依 bitsToTWD、沒設定的幣別照原數字', () => {
  assert.equal(toTWD({ amount: 2.49, currency: 'USD' }, S), 80);
  assert.equal(toTWD({ amount: 2.49, currency: 'USD' }, { ...S, fxRates: { USD: 30 } }), 75);
  assert.equal(toTWD({ amount: 1907, currency: 'BITS' }, S), 858);
  assert.equal(toTWD({ amount: 100, currency: 'JPY' }, S), 100);
});

test('Google Play 付的 Twitch 訂閱：兩邊都有時只算 Twitch 那筆（有實況主）', () => {
  // 範例：Google 付款紀錄 NT$89（10/15 中午）／Twitch GOOGLE_IAB TWD 89（UTC 10/15 16:34）
  const gp = { id: 'g', source: 'gpay', platform: 'twitch', amount: 89, currency: 'TWD', time: '2026-10-15T04:00:00.000Z', channel: '' };
  const tw = { id: 't', platform: 'twitch', paymentProvider: 'GOOGLE_IAB', amount: 89, currency: 'TWD', time: '2026-10-15T16:34:47Z', channel: 'example_vtuber' };
  assert.deepEqual(countedRecords([gp, tw], S).map((r) => r.id), ['t']);
  assert.deepEqual(countedRecords([gp], S).map((r) => r.id), ['g']); // 沒匯入 Twitch 時保留 Google 那筆
  const other = { ...gp, id: 'g2', amount: 150 };
  assert.deepEqual(countedRecords([gp, other, tw], S).map((r) => r.id).sort(), ['g2', 't']);
});

test('previewSpend：加上這筆後的直播主／總額等級，取較嚴重的', async () => {
  const { previewSpend, summarize, DEFAULT_SETTINGS: S } = await import('../src/lib/budget.js');
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const records = [{ id: 'a', platform: 'hivebee', channel: 'cocor0', amount: 700, currency: 'TWD', time: now.toISOString() }];
  const sum = summarize(records, S, month);
  let p = previewSpend(sum, S, 'youtube', '心 cocor0', 100);
  assert.equal(p.streamer.name, '心可可');
  assert.equal(p.streamer.after, 800);
  assert.equal(p.streamer.level, 'warn'); // 800 / 1000 = 80%
  assert.equal(p.totalLevel, 'ok');
  assert.equal(p.level, 'warn');
  p = previewSpend(sum, S, 'youtube', '心 cocor0', 300);
  assert.equal(p.level, 'over');
  // Twitch 聊天室用「顯示名稱 (帳號)」查：別名還沒有 Twitch 帳號時，靠直播主名稱也對得到
  const s2 = { ...S, streamers: [...S.streamers, { id: 'haru', name: '星野晴晴', limit: 1000, aliases: { youtube: ['星野晴晴 Hoshi Haru'] } }] };
  assert.equal(previewSpend(summarize(records, s2, month), s2, 'twitch', '星野晴晴 (hoshiharu)', 45).streamer.name, '星野晴晴');
  p = previewSpend(sum, S, 'youtube', '沒有設定的頻道', 2500);
  assert.equal(p.streamer, null);
  assert.equal(p.totalAfter, 3200);
  assert.equal(p.level, 'over');
});
