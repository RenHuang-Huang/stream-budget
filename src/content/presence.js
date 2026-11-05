// HiveBee／YouTube／Twitch 任一頁面打開時回報背景：自動更新只在使用者開著平台頁面時才執行
chrome.runtime.sendMessage({ type: 'platformOpen' }).catch(() => {});
