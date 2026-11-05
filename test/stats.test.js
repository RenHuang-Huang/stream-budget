import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS as S } from '../src/lib/budget.js';
import { monthsBack, buildStats, lineSeries, foldOther, platformsOf, recipientsOf, dailyTotals, recentRecords } from '../src/lib/stats.js';

const rec = (id, channel, amount, time, platform = 'hivebee') => ({ id, channel, amount, time, platform, currency: 'TWD', counted: true });
const records = [
  rec(1, '♡ cocor0', 100, '2026-11-02T12:00:00'),
  rec(2, '星野晴晴', 75, '2026-11-03T12:00:00'),
  rec(3, '心 cocor0', 750, '2026-10-17T12:00:00', 'youtube'),
  rec(4, '千千波露', 3000, '2026-09-10T12:00:00', 'youtube'),
];

test('monthsBack 舊到新，跨年', () => {
  assert.deepEqual(monthsBack(3, new Date(2026, 0, 15)), ['2025-11', '2025-12', '2026-01']);
});

test('buildStats 依整段期間總額決定順序（顏色跟著對象走）', () => {
  const st = buildStats(records, S, monthsBack(3, new Date(2026, 10, 5)));
  assert.deepEqual(st.order.map((o) => o.name), ['千千波露', '心可可', '星野晴晴']);
  assert.deepEqual(st.summaries.map((s) => s.total), [3000, 750, 175]);
});

test('lineSeries 總額＋前 k 名', () => {
  const st = buildStats(records, S, monthsBack(3, new Date(2026, 10, 5)));
  const ls = lineSeries(st, 2);
  assert.deepEqual(ls.map((l) => l.name), ['總額', '千千波露', '心可可']);
  assert.deepEqual(ls[2].values, [0, 750, 100]);
});

test('foldOther 超過 n+1 塊才合併', () => {
  const items = [5, 4, 3, 2, 1, 1, 1].map((v, i) => ({ key: i, name: `${i}`, spent: v }));
  const f = foldOther(items, 5);
  assert.equal(f.length, 6);
  assert.equal(f[5].spent, 2);
  assert.equal(foldOther(items.slice(0, 6), 5).length, 6); // 剛好 6 塊不合併
});

test('platformsOf 含未對應的頻道', () => {
  const st = buildStats(records, S, ['2026-11']);
  assert.deepEqual(platformsOf(st.summaries[0]).map((p) => [p.name, p.spent]), [['HiveBee', 175]]);
  assert.equal(recipientsOf(st.summaries[0]).length, 2);
});

test('dailyTotals 依本地日期加總、限制區間', () => {
  const d = dailyTotals([...records, rec(5, 'x', 25, '2026-11-02T20:00:00')], S, '2026-10-01', '2026-11-30');
  assert.equal(d.get('2026-11-02'), 125);
  assert.equal(d.get('2026-10-17'), 750);
  assert.equal(d.has('2026-09-10'), false);
});

test('recentRecords 新到舊、標出對應到的直播主', () => {
  const r = recentRecords(records, S, '2026-11');
  assert.deepEqual(r.map((x) => [x.who, x.matched]), [['星野晴晴', false], ['心可可', true]]);
});
