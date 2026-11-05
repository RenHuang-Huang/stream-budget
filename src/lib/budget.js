// 純函式：不碰 chrome.*，方便用 node --test 測試
import { resolveHints } from './gpay.js';

export const PLATFORMS = ['hivebee', 'youtube', 'twitch', 'manual'];

export const DEFAULT_SETTINGS = {
  totalLimit: 3000,
  defaultStreamerLimit: 1000,
  warnRatio: 0.8,
  // Twitch 小奇點換算成台幣（每 1 bit 多少 NT$），請依你實際購買的價格調整
  bitsToTWD: 0.45,
  // 外幣匯率（1 單位 = NT$），Twitch 網頁付款多為 USD
  fxRates: { USD: 32 },
  // Google 付款資料是否計入：{ "付款資料A": true, "付款資料B": false }；第一次看到時自動加入並預設計入
  gpayProfiles: {},
  // 未對應頻道自動對應（見 automatch.js）；autoMatchIgnore 是使用者刪掉的自動直播主的頻道，不再自動建立
  autoMatch: true,
  // 自動更新間隔（分鐘）：0 關閉、60、360、1440；只在使用者開著 HiveBee／YouTube／Twitch 頁面時才執行
  syncInterval: 360,
  autoMatchIgnore: [],
  streamers: [
    {
      id: 'cocoro',
      name: '心可可',
      limit: 1000,
      // TODO: YouTube / Twitch 的頻道名稱請到「選項」頁確認後修改
      aliases: { hivebee: ['cocor0'], youtube: ['cocor0'], twitch: ['cocor0'] },
    },
  ],
};

/** 正規化名稱：全形轉半形、轉小寫、去除符號與 emoji */
export const norm = (s) =>
  (s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** 依平台別名找出對應的直播主 id，找不到回傳 null */
export function matchStreamer(settings, platform, channel) {
  const c = norm(channel);
  if (!c) return null;
  for (const s of settings.streamers) {
    const keys = [s.name, ...(s.aliases?.[platform] || [])].map(norm).filter(Boolean);
    if (keys.some((k) => c.includes(k))) return s.id;
  }
  return null;
}

/** 本地時區的月份字串，例如 2026-11 */
export function monthKey(d) {
  const date = d instanceof Date ? d : new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function toTWD(rec, settings) {
  if (rec.currency === 'BITS') return Math.round(rec.amount * settings.bitsToTWD);
  if (!rec.currency || rec.currency === 'TWD') return rec.amount;
  const rate = { ...DEFAULT_SETTINGS.fxRates, ...settings.fxRates }[rec.currency];
  return rate ? Math.round(rec.amount * rate) : rec.amount; // 沒設定匯率的幣別先照原數字算
}

/**
 * 手機 App 用 Google Play 付的 Twitch 訂閱，Google 付款紀錄（沒有實況主）和 Twitch 付款紀錄
 * （付款方式 GOOGLE_IAB，有實況主）都會有。兩邊都匯入時，同金額、日期相差 ≤ 1 天的配成一對，丟掉 Google 那筆。
 */
export function dropDuplicateGpayTwitch(records, settings) {
  const iab = records.filter((r) => r.platform === 'twitch' && r.paymentProvider === 'GOOGLE_IAB')
    .map((r) => ({ t: new Date(r.time).getTime(), twd: toTWD(r, settings), used: false }));
  if (!iab.length) return records;
  return records.filter((r) => {
    if (r.source !== 'gpay' || r.platform !== 'twitch') return true;
    const t = new Date(r.time).getTime();
    const twd = toTWD(r, settings);
    const m = iab.find((x) => !x.used && x.twd === twd && Math.abs(x.t - t) <= 36 * 3600 * 1000);
    if (!m) return true;
    m.used = true;
    return false;
  });
}

export function level(spent, limit, warnRatio = 0.8) {
  if (!limit) return 'ok';
  if (spent >= limit) return 'over';
  if (spent >= limit * warnRatio) return 'warn';
  return 'ok';
}

/** 實際計入的紀錄：補上聊天室線索的頻道、排除失敗／線索本身、排除未勾選的 Google 付款資料 */
export function countedRecords(records, settings) {
  return dropDuplicateGpayTwitch(resolveHints(records), settings).filter(
    (r) => r.counted !== false && !(r.gpayProfile && settings.gpayProfiles?.[r.gpayProfile] === false),
  );
}

/** 算出指定月份的彙整 */
export function summarize(records, settings, month) {
  const rows = countedRecords(records, settings).filter((r) => monthKey(r.time) === month);
  const byId = new Map(
    settings.streamers.map((s) => [
      s.id,
      { id: s.id, name: s.name, limit: s.limit ?? settings.defaultStreamerLimit, spent: 0, byPlatform: {} },
    ]),
  );
  const unmatched = new Map(); // "platform|channel" -> 金額
  let total = 0;

  for (const r of rows) {
    const twd = toTWD(r, settings);
    total += twd;
    const sid = r.streamerId || matchStreamer(settings, r.platform, r.channel);
    const s = sid && byId.get(sid);
    if (s) {
      s.spent += twd;
      s.byPlatform[r.platform] = (s.byPlatform[r.platform] || 0) + twd;
    } else {
      const k = `${r.platform}|${r.channel || r.note || r.kind || ''}`;
      unmatched.set(k, (unmatched.get(k) || 0) + twd);
    }
  }

  const streamers = [...byId.values()].map((s) => ({ ...s, level: level(s.spent, s.limit, settings.warnRatio) }));
  return {
    month,
    total,
    totalLimit: settings.totalLimit,
    totalLevel: level(total, settings.totalLimit, settings.warnRatio),
    streamers,
    unmatched: [...unmatched].map(([k, spent]) => {
      const [platform, channel] = k.split('|');
      return { platform, channel, spent };
    }).sort((a, b) => b.spent - a.spent),
    count: rows.length,
  };
}

/** 回傳本次新超過的門檻（用來決定要不要發通知） */
export function newAlerts(summary, alreadySent) {
  const out = [];
  const push = (key, msg) => { if (!alreadySent.includes(key)) out.push({ key, msg }); };
  const m = summary.month;
  if (summary.totalLevel !== 'ok')
    push(`${m}:total:${summary.totalLevel}`,
      `本月總額 NT$${summary.total} / ${summary.totalLimit}${summary.totalLevel === 'over' ? '（已超過上限）' : '（接近上限）'}`);
  for (const s of summary.streamers)
    if (s.level !== 'ok')
      push(`${m}:${s.id}:${s.level}`,
        `${s.name} 本月 NT$${s.spent} / ${s.limit}${s.level === 'over' ? '（已超過上限）' : '（接近上限）'}`);
  return out;
}

/**
 * 送出前預覽：這筆（已換成台幣）加上去之後，直播主與總額會變成多少、到哪個等級。
 * channel 對不到直播主時 streamer 為 null，只看總額。
 */
export function previewSpend(summary, settings, platform, channel, twd) {
  const sid = matchStreamer(settings, platform, channel);
  const s = sid && summary.streamers.find((x) => x.id === sid);
  const streamer = s
    ? { name: s.name, spent: s.spent, limit: s.limit, after: s.spent + twd, level: level(s.spent + twd, s.limit, settings.warnRatio) }
    : null;
  const totalAfter = summary.total + twd;
  const totalLevel = level(totalAfter, summary.totalLimit, settings.warnRatio);
  const rank = { ok: 0, warn: 1, over: 2 };
  const worst = streamer && rank[streamer.level] > rank[totalLevel] ? streamer.level : totalLevel;
  return { twd, streamer, total: summary.total, totalLimit: summary.totalLimit, totalAfter, totalLevel, level: worst };
}
