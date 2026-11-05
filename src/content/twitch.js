// Twitch：錢包頁的付款紀錄（訂閱、贈訂）與 Bits 使用紀錄（Cheering、Power-ups）
// 資料由 twitch-main.js（網頁環境）寫在 <tr data-sb>；這裡讀取、轉成紀錄、送出，匯入／自動更新時自動翻頁。
//
// - 訂閱：實況主取 product.owner.login（商品名稱是實況主自訂的方案名，可能不含頻道）；金額依幣別換算（USD 用選項頁匯率）
// - 購買 Bits：不計入（Bits 在「使用」時才算到實況主，避免買和用重複計算）
// - 手機 App 透過 Google Play 付的（provider GOOGLE_IAB）也會出現在這裡，和 Google 付款紀錄的重複由 budget.js 去掉
(() => {
  const TAB = () => new URL(location.href).searchParams.get('tab');

  function toRecord(x) {
    if (x.kind === 'payment') {
      const bits = x.type === 'BITS';
      const tier = { 1000: 'Tier 1', 2000: 'Tier 2', 3000: 'Tier 3' }[x.tier] || '';
      return {
        id: `twitch:${x.id}`,
        platform: 'twitch',
        source: 'twitch',
        kind: bits ? 'bits-purchase' : x.isGift ? 'gift-sub' : 'sub',
        channel: x.login || x.name || '',
        note: [x.name, tier, x.quantity > 1 ? `×${x.quantity}` : '', x.recipient ? `→ ${x.recipient}` : ''].filter(Boolean).join(' '),
        amount: x.amount,
        currency: x.currency || 'USD',
        time: x.time,
        paymentProvider: x.provider,
        status: '完成',
        counted: !bits,
      };
    }
    return {
      id: `twitch:bits:${x.id}`,
      platform: 'twitch',
      source: 'twitch',
      kind: x.type === 'GIVE_BITS_TO_BROADCASTER' ? 'cheer' : 'power-up',
      // 「顯示名稱 (帳號)」：別名填哪一個都對得到，自動對應也能用中文名跨平台比對
      channel: x.displayName && x.displayName.toLowerCase() !== x.login ? `${x.displayName} (${x.login})` : x.login || '',
      note: x.type === 'GIVE_BITS_TO_BROADCASTER' ? 'Cheering' : 'Power-ups',
      amount: x.amount,
      currency: 'BITS',
      time: x.time,
      status: '完成',
      counted: true,
    };
  }

  function read() {
    return [...document.querySelectorAll('table tbody tr[data-sb]')]
      .map((tr) => { try { return toRecord(JSON.parse(tr.dataset.sb)); } catch { return null; } })
      .filter((r) => r?.time);
  }

  // ── 匯入過去紀錄／自動更新：付款紀錄按「下一頁」，Bits 紀錄捲到底載入更多 ──
  let lastKey = '';
  let stall = 0;
  async function backfillStep(rows) {
    const tab = TAB();
    if (!/^(purchase-history|bits-usage-history)$/.test(tab)) return;
    const bf = await SB.backfill();
    const key = tab === 'purchase-history' ? 'twitch:purchases' : 'twitch:bits';
    if (!bf || bf.progress?.[key]?.done) return;
    if (!rows.length && !/No (transactions|results)|沒有/.test(document.querySelector('main')?.innerText || '')) return; // 還沒載入

    const pageKey = `${rows[0]?.id}|${rows.length}`;
    if (pageKey === lastKey) {
      // Bits 捲到底沒有更多：連續幾次沒變化就當作結束
      if (tab === 'bits-usage-history' && ++stall >= 3) return SB.send('backfillDone', { key });
      return;
    }
    lastKey = pageKey;
    stall = 0;
    const oldest = rows.reduce((m, r) => (r.time < m ? r.time : m), rows[0]?.time || '');
    const count = (bf.progress?.[key]?.count || 0) + (tab === 'purchase-history' ? rows.length : 0);
    await SB.send('backfillProgress', {
      key,
      info: { label: tab === 'purchase-history' ? 'Twitch 付款紀錄' : 'Twitch Bits 紀錄', count: tab === 'purchase-history' ? count : rows.length, oldest },
    });
    if (!rows.length || oldest < bf.since) return SB.send('backfillDone', { key });

    if (tab === 'purchase-history') {
      const next = document.querySelector('button[aria-label="Next payment history page"]');
      if (!next || next.disabled) return SB.send('backfillDone', { key });
      next.click();
    } else {
      let s = document.querySelector('table')?.parentElement;
      while (s && !(s.scrollHeight > s.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
      if (!s) return SB.send('backfillDone', { key });
      s.scrollTop = s.scrollHeight;
    }
  }

  let lastSent = '';
  async function tick() {
    if (location.pathname === '/wallet') {
      const rows = read();
      const sig = rows.map((r) => r.id).join();
      if (sig && sig !== lastSent) {
        lastSent = sig;
        SB.log(`Twitch ${TAB() || 'wallet'} 解析到 ${rows.length} 筆`);
        await SB.report(rows);
      }
      backfillStep(rows);
      return;
    }
    // 頻道頁（/頻道名稱）顯示本月狀態
    if (/^\/[A-Za-z0-9_]+$/.test(location.pathname) && location.pathname !== lastBanner) {
      lastBanner = location.pathname;
      SB.showBanner(await SB.send('getSummary'), 'left');
    }
  }
  let lastBanner = '';

  // Twitch 是 SPA，沒有公開的換頁事件，用輪詢
  setInterval(tick, 1500);
  tick();

  // ── 送出前提醒：聊天輸入框裡有 Cheer（例如「Cheer100」）時，顯示送出後的金額 ──
  // 點小奇點按鈕選的 Cheer 也是插入成這種文字，再按「聊天」或 Enter 送出。
  // 只認 Twitch 全站通用的 Cheermote 前綴；頻道自訂的前綴認不到。
  // 輸入框上方會浮出 Twitch 的 Cheer 面板，所以提醒放在輸入框下面、按鈕列（小奇點餘額、聊天）上面。
  const CHEER = /(?:^|\s)(?:cheer|doodlecheer|biblethump|cheerwhal|corgo|uni|showlove|party|seemsgood|pride|kappa|frankerz|heyguys|dansgame|elegiggle|trihard|kreygasm|4head|swiftrage|notlikethis|failfish|vohiyo|pjsalt|mrdestructoid|bday|ripcheer|shamrock|streamlabs|muxy)(\d+)(?=\s|$)/gi;
  setInterval(() => {
    const input = document.querySelector('[data-a-target="chat-input"]');
    const text = input?.textContent || '';
    const bits = [...text.matchAll(CHEER)].reduce((s, m) => s + Number(m[1]), 0);
    const parts = location.pathname.split('/').filter(Boolean);
    const login = parts[0] === 'popout' ? parts[1] : parts[0];
    const anchor = input?.closest('.chat-input')?.querySelector('.chat-input__buttons-container');
    if (!bits || !anchor || !login) return SB.guard(null);
    // 頁面標題「星野晴晴 - Chat - Twitch」「星野晴晴 - Twitch」開頭是顯示名稱；和 Bits 紀錄一樣用「顯示名稱 (帳號)」，
    // 別名只填了中文名或只填了帳號都對得到
    const name = document.title.replace(/^\(\d+\)\s*/, '').split(' - ')[0].trim();
    const channel = name && name.toLowerCase() !== login.toLowerCase() ? `${name} (${login})` : login;
    SB.guard(anchor, { platform: 'twitch', channel, amount: bits, currency: 'BITS' });
  }, 700);
})();
