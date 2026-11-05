// 圖表頁的資料整理（純函式，方便測試）
import { summarize, countedRecords, toTWD, matchStreamer } from './budget.js';
import { localDate } from './gpay.js';

import { platformLabel } from './platforms.js';

/** 往回 n 個月（含本月），舊→新，例如 ['2025-12', …, '2026-11'] */
export function monthsBack(n, now = new Date()) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

/** 一個月份彙整裡的「收款對象」：設定好的直播主＋未對應的頻道 */
export function recipientsOf(summary) {
  return [
    ...summary.streamers.filter((s) => s.spent).map((s) => ({ key: `s:${s.id}`, name: s.name, spent: s.spent })),
    ...summary.unmatched.map((u) => ({
      key: `u:${u.platform}|${u.channel}`,
      name: `${u.channel || '（未知）'}`,
      sub: platformLabel(u.platform),
      spent: u.spent,
    })),
  ];
}

/** 各平台金額 */
export function platformsOf(summary, records, settings) {
  // summary.streamers 只有對應到的；平台合計要把未對應的也算進來
  const out = {};
  for (const s of summary.streamers) for (const [p, v] of Object.entries(s.byPlatform)) out[p] = (out[p] || 0) + v;
  for (const u of summary.unmatched) out[u.platform] = (out[u.platform] || 0) + u.spent;
  return Object.entries(out)
    .filter(([, v]) => v)
    .map(([p, spent]) => ({ key: `p:${p}`, name: platformLabel(p), spent }))
    .sort((a, b) => b.spent - a.spent);
}

/** 最多 n 塊，其餘併成「其他」（圓餅圖切太多塊會讀不出來） */
export function foldOther(items, n = 5) {
  const sorted = [...items].sort((a, b) => b.spent - a.spent);
  if (sorted.length <= n + 1) return sorted;
  const rest = sorted.slice(n);
  return [...sorted.slice(0, n), { key: 'other', name: `其他 ${rest.length} 個`, spent: rest.reduce((a, b) => a + b.spent, 0), other: true }];
}

/**
 * 整段期間的統計。顏色跟著「對象」走、不跟名次走：依整段期間總額排序決定色槽，
 * 切換月份時同一個直播主永遠是同一個顏色。
 */
export function buildStats(records, settings, months) {
  const summaries = months.map((m) => summarize(records, settings, m));
  const totals = new Map();
  for (const s of summaries)
    for (const r of recipientsOf(s)) totals.set(r.key, { name: r.name, sub: r.sub, spent: (totals.get(r.key)?.spent || 0) + r.spent });
  const order = [...totals].sort((a, b) => b[1].spent - a[1].spent).map(([key, v]) => ({ key, ...v }));
  return { months, summaries, order };
}

/** 折線圖：總額＋整段期間花最多的前 k 個對象，每個月的金額 */
export function lineSeries(stats, k = 3) {
  const top = stats.order.slice(0, k);
  return [
    { key: 'total', name: '總額', values: stats.summaries.map((s) => s.total) },
    ...top.map((t) => ({
      key: t.key,
      name: t.name,
      values: stats.summaries.map((s) => recipientsOf(s).find((r) => r.key === t.key)?.spent || 0),
    })),
  ];
}

/** 每日合計（本地日期 → NT$），給日曆熱力圖 */
export function dailyTotals(records, settings, fromDate, toDate) {
  const out = new Map();
  for (const r of countedRecords(records, settings)) {
    const d = localDate(r.time);
    if (d < fromDate || d > toDate) continue;
    out.set(d, (out.get(d) || 0) + toTWD(r, settings));
  }
  return out;
}

/** 指定月份最近的 n 筆實際計入的紀錄，附上對應到的直播主名稱 */
export function recentRecords(records, settings, month, n = 8) {
  const names = new Map(settings.streamers.map((s) => [s.id, s.name]));
  return countedRecords(records, settings)
    .filter((r) => localDate(r.time).slice(0, 7) === month)
    .sort((a, b) => b.time.localeCompare(a.time))
    .slice(0, n)
    .map((r) => {
      const sid = r.streamerId || matchStreamer(settings, r.platform, r.channel);
      return { ...r, twd: toTWD(r, settings), who: names.get(sid) || r.channel || r.note || '（未知）', matched: !!sid };
    });
}
