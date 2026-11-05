// YouTube：會員（購買／贈送）、Super Chat / Super Thanks、鑽石（Jewels）
//
// ⚠️ 骨架階段：以下解析器的選擇器尚未在真實頁面驗證，需要在本機 session 用 Claude in Chrome 對照 DOM 補完。
//
// 資料來源候選：
//   1. https://www.youtube.com/paid_memberships  —— 目前有效的會員（只有月費，沒有歷史）
//   2. https://pay.google.com/gp/w/home/activity  —— Google 付款紀錄，Super Chat / 會員 / 贈送會員 / 鑽石 都會出現
//      （最完整，但頁面在 iframe 裡，需另外加 matches 與 all_frames）
//   3. 直播聊天室中自己送出的 Super Chat（即時攔截，可做「送出前提醒」）
(() => {
  const PAGES = {
    '/paid_memberships': parseMemberships,
  };

  function parseMemberships() {
    // TODO: 驗證實際 DOM。預期每個會員卡片有：頻道名稱、月費金額、下次扣款日。
    // 月費會員本身不是「交易紀錄」，可在每月扣款日產生一筆 kind='membership' 的紀錄。
    return [];
  }

  let lastPath = '';
  async function tick() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    const parser = PAGES[location.pathname];
    if (parser) {
      const rows = parser();
      SB.log(`YouTube ${location.pathname} 解析到 ${rows.length} 筆（解析器尚未完成）`);
      if (rows.length) return SB.report(rows);
    }
    // 在直播／影片頁顯示本月狀態，提醒自己
    if (location.pathname === '/watch' || /^\/live(\/|$)/.test(location.pathname)) {
      SB.showBanner(await SB.send('getSummary'), 'left');
    }
  }

  // YouTube 是 SPA，用 yt-navigate-finish 事件偵測換頁
  window.addEventListener('yt-navigate-finish', tick);
  tick();
})();
