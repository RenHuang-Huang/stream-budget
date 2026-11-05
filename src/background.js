import { DEFAULT_SETTINGS, summarize, monthKey, newAlerts, toTWD, previewSpend } from './lib/budget.js';
import { autoMatch } from './lib/automatch.js';

const get = (keys) => chrome.storage.local.get(keys);
const set = (obj) => chrome.storage.local.set(obj);

async function getSettings() {
  const { settings } = await get('settings');
  return settings || DEFAULT_SETTINGS;
}

async function getRecords() {
  const { records } = await get('records');
  return records || {};
}

async function currentSummary(month = monthKey(new Date())) {
  const [settings, records] = await Promise.all([getSettings(), getRecords()]);
  return summarize(Object.values(records), settings, month);
}

async function refreshBadgeAndAlerts() {
  const summary = await currentSummary();
  const pct = summary.totalLimit ? Math.round((summary.total / summary.totalLimit) * 100) : 0;
  const color = { ok: '#2e7d32', warn: '#f5a000', over: '#d32f2f' }[summary.totalLevel];
  await chrome.action.setBadgeText({ text: `${pct}%` });
  await chrome.action.setBadgeBackgroundColor({ color });

  const { alertsSent = [] } = await get('alertsSent');
  const alerts = newAlerts(summary, alertsSent);
  for (const a of alerts) {
    chrome.notifications.create(a.key, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '斗內預算提醒',
      message: a.msg,
    });
  }
  if (alerts.length) await set({ alertsSent: [...alertsSent, ...alerts.map((a) => a.key)] });
  return summary;
}

/** 第一次看到的 Google 付款資料加進設定（預設計入），讓使用者在選項頁勾選 */
async function rememberGpayProfiles(list) {
  const names = [...new Set(list.map((r) => r?.gpayProfile).filter(Boolean))];
  if (!names.length) return;
  const settings = await getSettings();
  const profiles = { ...(settings.gpayProfiles || {}) };
  if (names.some((n) => n !== '未知')) delete profiles['未知'];
  const fresh = names.filter((n) => !(n in profiles));
  if (!fresh.length) return;
  fresh.forEach((n) => (profiles[n] = true));
  await set({ settings: { ...settings, gpayProfiles: profiles } });
}

// 多個分頁同時送資料時，storage 的「讀→改→寫」會互相覆蓋，所以全部排隊依序執行
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

async function ingest(list) {
  await rememberGpayProfiles(list);
  const records = await getRecords();
  // 讀不到付款資料名稱時暫存為「未知」；一旦有真名稱的紀錄進來，這些就是重複的，清掉
  if (list.some((r) => r?.gpayProfile && r.gpayProfile !== '未知'))
    for (const [id, r] of Object.entries(records)) if (r.gpayProfile === '未知') delete records[id];
  let added = 0;
  for (const r of list) {
    if (!r?.id || !Number.isFinite(r.amount)) continue;
    if (!records[r.id]) added++;
    records[r.id] = { ...records[r.id], ...r };
  }
  await set({ records });
  if (added) await runAutoMatch(records);
  const summary = await refreshBadgeAndAlerts();
  return { added, summary };
}

/** 把未對應的頻道自動歸到直播主（補別名或新增），設定有變才寫回 */
async function runAutoMatch(records, { force = false } = {}) {
  const settings = await getSettings();
  if (settings.autoMatch === false && !force) return { added: [], extended: [] };
  const channels = Object.values(records || (await getRecords())).map((r) => ({ platform: r.platform, channel: r.channel }));
  const res = autoMatch(channels, settings);
  if (res.added.length || res.extended.length) {
    await set({ settings: res.settings });
    console.log('[SB] 自動對應：新增', res.added, '補別名', res.extended);
  }
  return { added: res.added, extended: res.extended };
}

// ── 匯入過去紀錄 ──
// 開背景分頁到各平台的紀錄頁，由各頁的 content script 自動翻頁；進度記在 storage.backfill
const BACKFILL_TTL = 30 * 60 * 1000; // 超過 30 分鐘視為結束（例如分頁被關掉、沒登入卡住）
const BACKFILL_URLS = [
  'https://www.hivebee.com.tw/member/history?tab=sponsorship',
  'https://www.hivebee.com.tw/member/history?tab=subscription',
  'https://pay.google.com/gp/w/home/activity',
  'https://www.twitch.tv/wallet?tab=purchase-history',
  'https://www.twitch.tv/wallet?tab=bits-usage-history',
];

async function getBackfill() {
  const { backfill } = await get('backfill');
  if (!backfill || backfill.finishedAt || Date.now() - backfill.startedAt > BACKFILL_TTL) return null;
  return backfill;
}

/**
 * 開背景分頁開始抓紀錄。
 * - 匯入過去紀錄：months 個月前到現在（kind = 'backfill'）
 * - 自動更新：since 指定起點（上次更新的前一天），只抓最近的（kind = 'sync'），分頁開在使用者那個平台頁面的視窗
 */
async function startBackfill({ months = 6, since, kind = 'backfill', windowId, index } = {}) {
  if (!since) {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    d.setHours(0, 0, 0, 0);
    since = d.toISOString();
  }
  const backfill = { kind, months, since, startedAt: Date.now(), tabIds: [], progress: {} };
  await set({ backfill, ...(kind === 'backfill' ? { setupDone: true } : {}) });
  for (const [i, url] of BACKFILL_URLS.entries()) {
    const opts = { url, active: false };
    if (windowId != null) Object.assign(opts, { windowId }, index != null ? { index: index + 1 + i } : {});
    const tab = await chrome.tabs.create(opts).catch(() => chrome.tabs.create({ url, active: false }));
    backfill.tabIds.push(tab.id);
    await set({ backfill }); // 每開一個就存，分頁載入後問 getBackfill 時才認得自己
  }
  return backfill;
}

// ── 自動更新 ──
// 每 15 分鐘檢查一次是否到期（設定的間隔）；到期了也要「使用者正開著 HiveBee／YouTube／Twitch 任一頁面」才跑，
// 否則等下次打開平台頁面（presence.js 回報）時再跑。平常不會自己開分頁。
const SYNC_ALARM = 'sync-check';
// 已存在就不要重建：service worker 常被喚醒，每次重建都會把計時歸零，可能永遠不觸發
chrome.alarms.get(SYNC_ALARM).then((a) => a || chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 15 }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === SYNC_ALARM) serial(() => maybeSync()); });

/** 目前開著的平台頁面（presence.js 回報的分頁，確認還存在） */
async function livePlatformTab() {
  const { presence = {} } = await chrome.storage.session.get('presence');
  for (const id of Object.keys(presence).map(Number)) {
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (tab) return tab;
    delete presence[id];
  }
  await chrome.storage.session.set({ presence });
  return null;
}

async function maybeSync({ force = false, tab } = {}) {
  const settings = await getSettings();
  const interval = settings.syncInterval ?? DEFAULT_SETTINGS.syncInterval; // 分鐘，0 = 關閉
  if (!force && !interval) return { started: false, reason: 'off' };
  const { lastSyncAt = 0 } = await get('lastSyncAt');
  if (!force && Date.now() - lastSyncAt < interval * 60 * 1000) return { started: false, reason: 'notDue' };
  if (await getBackfill()) return { started: false, reason: 'busy' };
  const host = tab || (await livePlatformTab());
  if (!host && !force) return { started: false, reason: 'noPlatformTab' };
  // 從上次更新的前一天抓起（第一次則抓 7 天），各頁讀到比這更舊就停
  const since = new Date((lastSyncAt || Date.now() - 6 * 86400000) - 86400000).toISOString();
  await set({ lastSyncAt: Date.now() });
  await startBackfill({ kind: 'sync', since, windowId: host?.windowId, index: host?.index });
  return { started: true };
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { presence = {} } = await chrome.storage.session.get('presence');
  if (presence[tabId]) { delete presence[tabId]; await chrome.storage.session.set({ presence }); }
});

async function backfillProgress({ key, info }) {
  const { backfill } = await get('backfill');
  if (!backfill) return null;
  backfill.progress[key] = { ...backfill.progress[key], ...info, at: Date.now() };
  await set({ backfill });
  return backfill;
}

async function backfillDone({ key }, sender) {
  const { backfill } = await get('backfill');
  if (!backfill) return null;
  backfill.progress[key] = { ...backfill.progress[key], done: true, at: Date.now() };
  // HiveBee／Twitch 一個分頁一個 key；Google 分頁要等全部付款資料做完（key = 'gpay'）才關
  const tabId = sender?.tab?.id;
  if (tabId != null && backfill.tabIds.includes(tabId) && (key.startsWith('hivebee:') || key.startsWith('twitch:') || key === 'gpay')) {
    backfill.tabIds = backfill.tabIds.filter((id) => id !== tabId);
    chrome.tabs.remove(tabId).catch(() => {});
  }
  if (!backfill.tabIds.length) backfill.finishedAt = Date.now();
  await set({ backfill });
  return backfill;
}

// 匯入中的分頁被使用者關掉：從清單移除，全部關掉就結束
chrome.tabs.onRemoved.addListener((tabId) =>
  serial(async () => {
    const { backfill } = await get('backfill');
    if (!backfill?.tabIds?.includes(tabId) || backfill.finishedAt) return;
    backfill.tabIds = backfill.tabIds.filter((id) => id !== tabId);
    if (!backfill.tabIds.length) backfill.finishedAt = Date.now();
    await set({ backfill });
  }),
);

const handlers = {
  ingest: ({ records }) => serial(() => ingest(records)),
  gpaySeen: ({ profile }) => serial(() => rememberGpayProfiles([{ gpayProfile: profile }])),
  // 只回給「匯入／自動更新自己開的分頁」；使用者自己開著的紀錄頁不要被自動翻頁
  getBackfill: async (_msg, sender) => {
    const bf = await getBackfill();
    return bf && sender?.tab && bf.tabIds.includes(sender.tab.id) ? bf : null;
  },
  getBackfillStatus: async () => (await get('backfill')).backfill || null,
  startBackfill: (msg) => serial(() => startBackfill(msg)),
  backfillProgress: (msg) => serial(() => backfillProgress(msg)),
  backfillDone: (msg, sender) => serial(() => backfillDone(msg, sender)),
  runAutoMatch: () => serial(async () => { const r = await runAutoMatch(null, { force: true }); await refreshBadgeAndAlerts(); return r; }),
  platformOpen: async (_msg, sender) => {
    const id = sender?.tab?.id;
    if (id == null) return null;
    const { presence = {} } = await chrome.storage.session.get('presence');
    presence[id] = Date.now();
    await chrome.storage.session.set({ presence });
    // 自動更新自己開的分頁不算（避免連鎖觸發）
    const { backfill } = await get('backfill');
    if (backfill?.tabIds?.includes(id)) return null;
    return serial(() => maybeSync({ tab: sender.tab }));
  },
  syncNow: () => serial(() => maybeSync({ force: true })),
  getSyncStatus: async () => {
    const [{ lastSyncAt = 0 }, settings] = await Promise.all([get('lastSyncAt'), getSettings()]);
    return { lastSyncAt, interval: settings.syncInterval ?? DEFAULT_SETTINGS.syncInterval, platformOpen: !!(await livePlatformTab()) };
  },
  getSetupDone: async () => !!(await get('setupDone')).setupDone,
  skipSetup: () => set({ setupDone: true }),
  getSummary: ({ month }) => currentSummary(month),
  // 送出前提醒：這筆送出去之後會不會超過上限
  checkSpend: async ({ platform, channel, amount, currency }) => {
    const [settings, summary] = await Promise.all([getSettings(), currentSummary()]);
    return previewSpend(summary, settings, platform, channel, toTWD({ amount, currency }, settings));
  },
  getSettings: () => getSettings(),
  saveSettings: ({ settings }) => serial(async () => { await set({ settings }); return refreshBadgeAndAlerts(); }),
  getRecords: async ({ month }) => {
    const all = Object.values(await getRecords());
    return (month ? all.filter((r) => monthKey(r.time) === month) : all).sort((a, b) => b.time.localeCompare(a.time));
  },
  addManual: ({ record }) =>
    serial(() => ingest([{ ...record, id: `manual:${Date.now()}`, platform: record.platform || 'manual', counted: true }])),
  deleteRecord: async ({ id }) => {
    const records = await getRecords();
    delete records[id];
    await set({ records });
    return refreshBadgeAndAlerts();
  },
  importData: async ({ data }) => { await set(data); return refreshBadgeAndAlerts(); },
  exportData: () => get(['settings', 'records']),
  clearRecords: async () => { await set({ records: {}, alertsSent: [] }); return refreshBadgeAndAlerts(); },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fn = handlers[msg?.type];
  if (!fn) return false;
  Promise.resolve(fn(msg, sender))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async response
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { settings } = await get('settings');
  if (!settings) await set({ settings: DEFAULT_SETTINGS });
  await serial(dropBadHints);
  await serial(() => runAutoMatch()); // 安裝／更新後，把既有紀錄裡的未對應頻道也對應一次
  await refreshBadgeAndAlerts();
  // 第一次安裝：打開選項頁，詢問要不要匯入過去紀錄
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(refreshBadgeAndAlerts);

// 0.1.0 的 ytchat.js 會把「傳送超級留言」面板裡的預覽卡當成已送出，而且每秒記一筆
// （預覽卡沒有訊息 ID，退而用「金額|現在時間」當 key）。真的訊息一定有 ID，key 不含「|」。
async function dropBadHints() {
  const records = await getRecords();
  let n = 0;
  for (const [id, r] of Object.entries(records))
    if (r.hint && id.startsWith('youtube:schint:') && id.includes('|')) { delete records[id]; n++; }
  if (n) await set({ records });
}
