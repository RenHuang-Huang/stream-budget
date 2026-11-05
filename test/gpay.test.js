import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, parseGpayRows, resolveHints, localDate } from '../src/lib/gpay.js';
import { DEFAULT_SETTINGS, summarize } from '../src/lib/budget.js';

// 依 Google 付款中心真實頁面格式虛構的列（付款資料「王小明」）
const YT = 'YouTube', GP = 'Google Play 應用程式';
const real = [
  [GP, '10月29日 · 給「星讀女僕茶館 HoshiyomiMaid Ch.」的超級留言 (YouTube)', '-$30.00'],
  [YT, '10月28日 · 「星野晴晴 Hoshi Haru」禮贈會籍', '-$75.00'],
  [YT, '10月21日 · 「星野晴晴 Hoshi Haru」會籍', '-$75.00'],
  [YT, '10月17日 · 「心 cocor0」會籍', '-$75.00'],
  [GP, '10月15日 · Twitch - 贈禮訂閱 (層級 1) (Twitch：Live 實況)', '-$89.00'],
  [GP, '10月3日 · 1,500 顆寶石 (YouTube)', '-$600.00'],
  [YT, '10月1日 · YouTube 超級留言', '-$300.00'],
  [YT, '10月1日 · YouTube 超級留言', '-$1,500.00'],
  [YT, '9月30日 · YouTube 超級留言', '-$30.00'],
  [GP, '9月29日 · 「量產型犬飼步歌參參機 Kura33」的會員資格 (YouTube)', '-$75.00'],
].map(([title, line, amount]) => ({ title, line, amount }));
const NOW = new Date(2026, 10, 5);

test('classify 各種說明', () => {
  assert.deepEqual(classify(YT, 'YouTube 超級留言'), { platform: 'youtube', kind: 'superchat', channel: '' });
  assert.equal(classify(GP, '給「A」的超級留言 (YouTube)').channel, 'A');
  assert.equal(classify(YT, '「心 cocor0」會籍').kind, 'membership');
  assert.equal(classify(YT, '「B」禮贈會籍').kind, 'gift-membership');
  assert.deepEqual(classify(GP, '5 個「Mira ch. 米菈」會籍贈禮 (YouTube)'), { platform: 'youtube', kind: 'gift-membership', channel: 'Mira ch. 米菈' });
  assert.equal(classify(GP, '連續包年VIP會員 (無限漫畫 - 暢享極致漫畫閱讀之旅)'), null);
  assert.equal(classify(GP, '「C」的會員資格 (YouTube)').channel, 'C');
  assert.equal(classify(GP, '1,500 顆寶石 (YouTube)').kind, 'jewels');
  assert.deepEqual(classify(GP, 'Twitch - 贈禮訂閱 (層級 1) (Twitch：Live 實況)'), { platform: 'twitch', kind: 'gift-sub', channel: '' });
  assert.equal(classify(GP, 'Google One 100 GB'), null);
});

test('parseGpayRows 解析各種列、金額、年份', () => {
  const rs = parseGpayRows(real, { now: NOW, profile: '王小明', complete: true });
  assert.equal(rs.length, 10);
  assert.equal(rs[0].amount, 30);
  assert.equal(rs[7].amount, 1500);
  assert.equal(rs[3].channel, '心 cocor0');
  assert.equal(rs[4].platform, 'twitch');
  assert.equal(rs[0].date, '2026-10-29');
  assert.equal(localDate(rs[9].time), '2026-09-29');
  assert.ok(rs.every((r) => r.gpayProfile === '王小明' && r.id.startsWith('gpay:王小明:')));
});

test('parseGpayRows 跨年：月份變大代表前一年', () => {
  const rows = [
    { title: YT, line: '1月3日 · YouTube 超級留言', amount: '-$75.00' },
    { title: YT, line: '12月30日 · YouTube 超級留言', amount: '-$75.00' },
    { title: YT, line: '2024年12月1日 · YouTube 超級留言', amount: '-$75.00' },
  ];
  const rs = parseGpayRows(rows, { now: new Date(2027, 0, 10), complete: true });
  assert.deepEqual(rs.map((r) => r.date), ['2027-01-03', '2026-12-30', '2024-12-01']);
});

test('未載入到底時略過最後一天；同日重複交易的 ID 不因新交易位移', () => {
  const sc = (d, a = '-$75.00') => ({ title: YT, line: `${d} · YouTube 超級留言`, amount: a });
  const before = parseGpayRows([sc('10月1日'), sc('10月1日'), sc('9月30日')], { now: NOW, complete: false });
  assert.equal(before.length, 2); // 9/30 可能被切一半，先略過
  const after = parseGpayRows([sc('10月1日'), sc('10月1日'), sc('10月1日'), sc('9月30日')], { now: NOW, complete: false });
  const ids = new Set(after.map((r) => r.id));
  assert.ok(before.every((r) => ids.has(r.id))); // 舊的兩筆 ID 不變
  assert.equal(ids.size, 3);
});

test('退款或非支出不計入', () => {
  const rs = parseGpayRows([{ title: YT, line: '10月1日 · YouTube 超級留言', amount: '$75.00' }], { now: NOW, complete: true });
  assert.equal(rs.length, 0);
});

test('resolveHints 用聊天室線索補頻道，同金額、優先同一天、只用一次', () => {
  const rs = parseGpayRows(real, { now: NOW, profile: 'p', complete: true });
  const hint = (amount, d, channel) => ({ id: `h${amount}${d}`, hint: true, counted: false, platform: 'youtube', amount, channel, time: new Date(`${d}T21:00:00`).toISOString() });
  const out = resolveHints([...rs, hint(1500, '2026-09-30', '心可可 Cocoro ch.'), hint(300, '2026-10-05', '遠的')]);
  assert.equal(out.find((r) => r.amount === 1500 && r.kind === 'superchat').channel, '心可可 Cocoro ch.'); // 差 1 天可配對
  assert.equal(out.find((r) => r.amount === 300).channel, ''); // 差 4 天不配對
});

test('summarize：線索補上的頻道計入直播主、未勾選的付款資料排除', () => {
  const rs = parseGpayRows(real, { now: NOW, profile: '王小明', complete: true });
  const hint = { id: 'h', hint: true, counted: false, platform: 'youtube', amount: 300, channel: '心 cocor0', time: new Date(2026, 9, 1, 7, 0).toISOString() };
  const s = summarize([...rs, hint], DEFAULT_SETTINGS, '2026-10');
  assert.equal(s.total, 30 + 75 + 75 + 75 + 89 + 600 + 300 + 1500);
  assert.equal(s.streamers[0].spent, 75 + 300); // 會籍 + 線索補上的超級留言
  assert.ok(s.unmatched.some((u) => u.channel === 'YouTube 超級留言' && u.spent === 1500));
  const off = summarize([...rs, hint], { ...DEFAULT_SETTINGS, gpayProfiles: { 王小明: false } }, '2026-10');
  assert.equal(off.total, 0);
});
