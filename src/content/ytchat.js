// YouTube 直播聊天室（www.youtube.com/live_chat，內嵌 iframe 或彈出視窗）
// 偵測「自己送出的」Super Chat／超級貼圖，記成線索（hint），之後用來補 Google 付款紀錄裡
// 「YouTube 超級留言」缺的頻道名稱。線索本身不計入金額（counted: false），避免重複計算。
//
// 2026/11/05 實際送出 Super Chat 驗證：輸入框上方的名稱和 Super Chat 作者都是「@帳號」；台幣顯示為「$15.00」；
// 時間戳依介面語言可能是「下午1:42」或「1:42 PM」。
// 「傳送超級留言」面板裡的預覽卡也是 yt-live-chat-paid-message-renderer，但沒有訊息 ID、不在訊息列表裡，要排除。
(() => {
  // 只看訊息列表（#items）裡的，排除送出面板的預覽卡
  const PAID = ['yt-live-chat-paid-message-renderer', 'yt-live-chat-paid-sticker-renderer']
    .map((t) => `yt-live-chat-item-list-renderer #items ${t}`).join(', ');
  const norm = (s) => (s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

  /** 「$15.00」「NT$150」是台幣（台灣介面的台幣顯示成 $），其他取符號，例如「¥」「US$」 */
  const currencyOf = (t) => (/NT\$|^\$/.test(t) ? 'TWD' : /US\$/.test(t) ? 'USD' : t.replace(/[\d.,\s]/g, '') || 'TWD');

  /** 自己的名稱：聊天輸入框上方顯示的作者名稱 */
  const myName = () => document.querySelector('yt-live-chat-message-input-renderer #author-name')?.textContent.trim();

  /** 直播頻道名稱：聊天室 iframe 和直播頁同源，可讀上層；彈出視窗則讀 opener */
  function channelName() {
    for (const w of [window.top, window.opener]) {
      try {
        const doc = w?.document;
        const n =
          doc?.querySelector('ytd-watch-metadata ytd-channel-name a, ytd-video-owner-renderer ytd-channel-name a')?.textContent ||
          doc?.querySelector('link[itemprop="name"]')?.getAttribute('content');
        if (n?.trim()) return n.trim();
      } catch { /* 跨來源 */ }
    }
    return '';
  }

  /** 聊天室時間戳（「下午7:29」「7:29 PM」「19:29」）→ 今天該時刻；讀不到用現在 */
  function msgTime(el) {
    const t = el.querySelector('#timestamp')?.textContent.trim() || '';
    const m = t.match(/(\d{1,2}):(\d{2})/);
    const d = new Date();
    if (!m) return d.toISOString();
    let h = Number(m[1]);
    const pm = /下午|晚上|PM/i.test(t), am = /上午|凌晨|早上|AM/i.test(t);
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    d.setHours(h, Number(m[2]), 0, 0);
    if (d > new Date()) d.setDate(d.getDate() - 1); // 例如凌晨看到昨晚的訊息
    return d.toISOString();
  }

  const done = new Set();
  function scan() {
    const me = norm(myName());
    if (!me) return;
    const hints = [];
    for (const el of document.querySelectorAll(PAID)) {
      const key = el.id; // 真的訊息一定有 ID；沒有的（預覽卡等）不記
      if (!key) continue;
      const author = norm(el.querySelector('#author-name')?.textContent);
      if (author !== me) continue;
      if (done.has(key)) continue;
      done.add(key);
      const amountText = el.querySelector('#purchase-amount, #purchase-amount-chip')?.textContent.trim() || '';
      const amount = SB.parseNumber(amountText);
      if (!Number.isFinite(amount)) continue;
      hints.push({
        id: `youtube:schint:${key}`,
        platform: 'youtube',
        kind: 'superchat-hint',
        hint: true,
        counted: false,
        channel: channelName(),
        note: amountText,
        amount,
        currency: currencyOf(amountText),
        time: msgTime(el),
      });
    }
    if (hints.length) {
      SB.log(`記下 ${hints.length} 筆自己送出的 Super Chat 線索`, hints);
      SB.report(hints);
    }
  }

  let timer;
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 500); })
    .observe(document.body, { childList: true, subtree: true });

  // ── 送出前提醒：「傳送超級留言」面板開著時，在「購買並傳送」上方顯示送出後的金額 ──
  // 面板是 yt-live-chat-message-buy-flow-renderer；金額讀面板裡預覽卡的 #purchase-amount（「$30.00」）
  setInterval(() => {
    const flow = document.querySelector('yt-live-chat-message-buy-flow-renderer');
    const btn = flow && [...flow.querySelectorAll('#preview > yt-button-shape > button')].find((b) => b.offsetParent);
    if (!btn) return SB.guard(null);
    const text = flow.querySelector('#purchase-amount, #purchase-amount-chip')?.textContent.trim() || '';
    SB.guard(btn.closest('yt-button-shape'), {
      platform: 'youtube', channel: channelName(), amount: SB.parseNumber(text), currency: currencyOf(text),
    });
  }, 700);
})();
