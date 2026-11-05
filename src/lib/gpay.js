// Google 付款中心「活動」列表（pay.google.com → iframe payments.google.com/.../timelineview）解析
// 純函式，不碰 DOM / chrome.*，方便用 node --test 測試。
//
// 2026/11/05 對照真實頁面：每列 = 標題（YouTube / Google Play 應用程式）＋「10月29日 · 說明」＋「-$75.00」
// - 列表日期沒有年份、沒有交易 ID（ID 要點開明細才有），依列表順序（新→舊）推算年份
// - 網頁付的 Super Chat 只寫「YouTube 超級留言」，沒有頻道 → 用直播聊天室記下的線索補（見 resolveHints）

const DATE_RE = /^(?:(\d{4})年\s*)?(\d{1,2})月(\d{1,2})日\s*·\s*(.*)$/;

/** 依說明文字分類；不是 YouTube / Twitch 的交易回傳 null */
export function classify(title, desc) {
  let m;
  if ((m = desc.match(/^給「(.+)」的超級(留言|貼圖)\s*\(YouTube\)$/)))
    return { platform: 'youtube', kind: 'superchat', channel: m[1] };
  if (/^YouTube 超級(留言|貼圖)$/.test(desc)) return { platform: 'youtube', kind: 'superchat', channel: '' };
  // 網頁：「X」禮贈會籍；手機 App：5 個「X」會籍贈禮 (YouTube)
  if ((m = desc.match(/^(?:\d+\s*個)?「(.+)」(?:禮贈會籍|會籍贈禮)(?:\s*\(YouTube\))?$/)))
    return { platform: 'youtube', kind: 'gift-membership', channel: m[1] };
  if ((m = desc.match(/^「(.+)」(?:會籍|的會員資格\s*\(YouTube\))$/)))
    return { platform: 'youtube', kind: 'membership', channel: m[1] };
  if (/顆寶石\s*\(YouTube\)$/.test(desc)) return { platform: 'youtube', kind: 'jewels', channel: '' };
  if (/^Twitch\b/.test(desc))
    return { platform: 'twitch', kind: /贈禮/.test(desc) ? 'gift-sub' : /訂閱/.test(desc) ? 'sub' : 'twitch', channel: '' };
  if (title === 'YouTube' || /\(YouTube\)$/.test(desc))
    return { platform: 'youtube', kind: 'youtube', channel: desc.match(/「(.+?)」/)?.[1] || '' };
  return null;
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * @param rows     [{ title, line, amount }]，line 例如「10月29日 · 「心 cocor0」會籍」，依頁面順序（新→舊）
 * @param opts.now      現在時間（推算年份用）
 * @param opts.profile  付款資料名稱（例如「王小明」）
 * @param opts.complete 列表是否已載入到底；未到底時最後一天可能被切一半，先略過避免去重 ID 位移
 */
/** 每列的日期（YYYY-MM-DD，讀不到為 null）與說明；列表新→舊，月份變大代表跨到前一年 */
export function rowDates(rows, now = new Date()) {
  let year = now.getFullYear();
  let prevMonth = now.getMonth() + 1;
  return rows.map((r) => {
    const m = String(r.line || '').trim().match(DATE_RE);
    if (!m) return { date: null, desc: '' };
    const month = Number(m[2]);
    if (m[1]) year = Number(m[1]);
    else if (month > prevMonth) year--;
    prevMonth = month;
    return { date: `${year}-${pad(month)}-${pad(Number(m[3]))}`, desc: m[4].trim() };
  });
}

export function parseGpayRows(rows, { now = new Date(), profile = '', complete = false } = {}) {
  const dates = rowDates(rows, now);
  const items = [];
  for (const [i, r] of rows.entries()) {
    const { date, desc } = dates[i];
    if (!date) continue;
    const raw = String(r.amount || '').trim();
    const amount = Number(raw.replace(/[^\d.]/g, ''));
    if (!raw.startsWith('-') || !Number.isFinite(amount) || !amount) continue; // 只計支出（退款等先略過）
    const c = classify(String(r.title || '').trim(), desc);
    if (!c) continue;
    items.push({ date, desc, amount, ...c });
  }

  if (!complete && items.length) {
    const last = items[items.length - 1].date;
    while (items.length && items[items.length - 1].date === last) items.pop();
  }

  // 同一天、同說明、同金額的交易：從當天最舊一筆開始編號，新交易只會加在上面，不影響舊的編號
  const seen = new Map();
  const out = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const key = `${it.date}|${it.desc}|${it.amount}`;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    out.unshift({
      id: `gpay:${profile}:${key}:${n}`,
      platform: it.platform,
      source: 'gpay',
      gpayProfile: profile,
      kind: it.kind,
      channel: it.channel,
      note: it.desc,
      amount: it.amount,
      currency: 'TWD',
      time: new Date(`${it.date}T12:00:00`).toISOString(), // 列表沒有時間，取當天中午（本地時區）
      date: it.date,
      status: '已完成',
      counted: true,
    });
  }
  return out;
}

/** 本地日期 YYYY-MM-DD */
export const localDate = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const dayDiff = (a, b) => Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 86400000);

/**
 * 用直播聊天室記下的 Super Chat 線索（hint: true）補上付款紀錄缺的頻道。
 * 同金額、日期相差 ≤ 1 天，優先同一天；每條線索只用一次。回傳新陣列，不改原物件。
 */
export function resolveHints(records) {
  const hints = records.filter((r) => r.hint).map((h) => ({ h, d: localDate(h.time), used: false }));
  if (!hints.length) return records;
  return records.map((r) => {
    if (r.hint || r.platform !== 'youtube' || r.kind !== 'superchat' || r.channel || r.streamerId) return r;
    const d = r.date || localDate(r.time);
    let best = null;
    for (const x of hints) {
      if (x.used || x.h.amount !== r.amount) continue;
      const diff = Math.abs(dayDiff(x.d, d));
      if (diff <= 1 && (!best || diff < best.diff)) best = { x, diff };
    }
    if (!best) return r;
    best.x.used = true;
    return { ...r, channel: best.x.h.channel, hintId: best.x.h.id };
  });
}
