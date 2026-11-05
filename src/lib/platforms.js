// 平台登錄檔：所有「有哪些平台」的地方都從這裡讀，新增平台時只改這裡（加上該平台自己的 content script 與 manifest）。
//
// 欄位：
// - key       紀錄的 platform 值，也是 settings.streamers[].aliases 的 key
// - label     介面顯示名稱
// - color     圖表／標記用的色票 token（ui/theme.css 的 CSS 變數）
// - aliases   設定頁的直播主表格是否有這個平台的「別名」欄
// - manual    彈出視窗「手動新增一筆」能不能選
// - backfill  「匯入過去紀錄／自動更新」要在背景打開的紀錄頁
// - connect   使用者在設定頁勾選「連結」後才會要求的網站權限（origins）與要註冊的 content scripts；
//             沒勾選的平台，擴充功能完全不碰它的網站。desc 是設定頁上給使用者看的說明。
//
// 「平台」是錢送去哪裡（直播主在哪收的）；「來源」是從哪裡讀到紀錄（例如 Google 付款紀錄 source: 'gpay'
// 讀出來的是 YouTube／Twitch 的紀錄）。來源見下方 SOURCES。

export const PLATFORMS = [
  {
    key: 'hivebee', label: 'HiveBee', color: '--series-1', aliases: true, manual: true,
    backfill: [
      'https://www.hivebee.com.tw/member/history?tab=sponsorship',
      'https://www.hivebee.com.tw/member/history?tab=subscription',
    ],
    connect: {
      desc: '讀取交易紀錄頁的付費贊助與 VIP 訂閱；在贊助頁顯示送出前提醒。',
      origins: ['https://www.hivebee.com.tw/*', 'https://hivebee.com.tw/*'],
      scripts: [
        { id: 'presence', js: ['src/content/presence.js'] },
        { id: 'history', matches: ['https://www.hivebee.com.tw/member/history*', 'https://hivebee.com.tw/member/history*'],
          js: ['src/content/common.js', 'src/content/hivebee.js'] },
        { id: 'donate', excludeMatches: ['https://www.hivebee.com.tw/member/history*', 'https://hivebee.com.tw/member/history*'],
          js: ['src/content/common.js', 'src/content/hivebee-donate.js'] },
      ],
    },
  },
  {
    key: 'youtube', label: 'YouTube', color: '--series-2', aliases: true, manual: true, backfill: [],
    connect: {
      desc: '在直播聊天室認出你自己送的 Super Chat（補上付款紀錄缺的頻道名稱），並在 Super Chat 面板顯示送出前提醒。YouTube 的付款紀錄要另外連結「Google 付款紀錄」。',
      origins: ['https://www.youtube.com/*'],
      scripts: [
        { id: 'presence', js: ['src/content/presence.js'] },
        { id: 'page', js: ['src/content/common.js', 'src/content/youtube.js'] },
        { id: 'chat', matches: ['https://www.youtube.com/live_chat?*'], js: ['src/content/common.js', 'src/content/ytchat.js'], allFrames: true },
      ],
    },
  },
  {
    key: 'twitch', label: 'Twitch', color: '--series-3', aliases: true, manual: true,
    backfill: [
      'https://www.twitch.tv/wallet?tab=purchase-history',
      'https://www.twitch.tv/wallet?tab=bits-usage-history',
    ],
    connect: {
      desc: '讀取錢包頁的付款紀錄與 Bits 使用紀錄；在聊天室顯示 Cheer 的送出前提醒。',
      origins: ['https://www.twitch.tv/*'],
      scripts: [
        { id: 'presence', js: ['src/content/presence.js'] },
        { id: 'page', js: ['src/content/common.js', 'src/content/twitch.js'] },
        { id: 'main', js: ['src/content/twitch-main.js'], world: 'MAIN' },
      ],
    },
  },
  // 不屬於任何已支援平台的手動紀錄；要放最後
  { key: 'manual', label: '其他', color: '--series-4', aliases: false, manual: true, backfill: [] },
];

/**
 * 紀錄來源（不是平台本身、但會產生紀錄的地方）。
 * doneKey：該來源整個分頁讀完時送出的 backfillDone key；平台的分頁則是送「平台 key:…」。
 */
export const SOURCES = [
  {
    key: 'gpay', label: 'Google 付款紀錄', doneKey: 'gpay', backfill: ['https://pay.google.com/gp/w/home/activity'],
    connect: {
      desc: '讀取 Google 付款中心「活動」裡的 YouTube 會員、Super Chat、寶石，以及手機 App 付的 Twitch。',
      origins: ['https://pay.google.com/*', 'https://payments.google.com/*'],
      scripts: [
        { id: 'top', matches: ['https://pay.google.com/gp/w/*'], js: ['src/content/common.js', 'src/content/gpay-top.js'] },
        { id: 'timeline', matches: ['https://payments.google.com/payments/u/*/timelineview*'],
          js: ['src/content/common.js', 'src/content/gpay.js'], allFrames: true },
      ],
    },
  },
];

const byKey = new Map(PLATFORMS.map((p) => [p.key, p]));

export const platform = (key) => byKey.get(key);
export const platformLabel = (key) => byKey.get(key)?.label || key;
export const platformColor = (key) => byKey.get(key)?.color || '--other';
export const aliasPlatforms = () => PLATFORMS.filter((p) => p.aliases);
export const manualPlatforms = () => PLATFORMS.filter((p) => p.manual);

/** 可以連結的項目（有網站要存取的平台與來源），設定頁「連結平台」依這個順序列出 */
export const connectables = () => [...PLATFORMS, ...SOURCES].filter((x) => x.connect);

/**
 * 某個連結項目要註冊的 content scripts（chrome.scripting.registerContentScripts 的格式）。
 * 沒寫 matches 的 script 套用該項目全部 origins；id 加上項目 key 當前綴，避免不同平台撞名。
 */
export const contentScriptsOf = (item) =>
  item.connect.scripts.map(({ id, matches, ...rest }) => ({
    id: `${item.key}-${id}`,
    matches: matches || item.connect.origins,
    runAt: 'document_idle',
    persistAcrossSessions: true,
    ...rest,
  }));

/** 匯入過去紀錄要打開的紀錄頁（依 PLATFORMS、SOURCES 的順序）；給 connected 時只取已連結的 */
export const backfillUrls = (connected) =>
  [...PLATFORMS, ...SOURCES].filter((x) => !connected || connected[x.key]).flatMap((x) => x.backfill || []);

/** backfillDone 的 key 是否代表「這個分頁做完了，可以關」 */
export function isTabDoneKey(key) {
  if (SOURCES.some((s) => s.doneKey === key)) return true;
  const prefix = String(key).split(':')[0];
  return String(key).includes(':') && (byKey.get(prefix)?.backfill.length ?? 0) > 0;
}
