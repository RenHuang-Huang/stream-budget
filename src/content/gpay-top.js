// pay.google.com 外層：
// 1. 把目前選的付款資料名稱（右上角下拉選單，例如「王小明」）傳給活動 iframe
// 2. 顯示 iframe 傳來的狀態條
// 3. 匯入過去紀錄時，一個付款資料做完就切到下一個；全部做完切回原本的付款資料，再通知背景關分頁
//
// 2026/11/05 真實頁面：選單是 [role=option]，選中的 aria-selected=true，第一個文字節點是名稱，
// 後面接「台灣」「付款資料 ID：xxxx」。點選項（送完整滑鼠事件）會切換付款資料並重新載入整頁。
// 右上角按鈕 aria-labelledby="chip_… dropdown_…" 作為讀名稱的備援。
(() => {
  const optionName = (opt) =>
    [...opt.querySelectorAll('*')].find((e) => !e.children.length && e.textContent.trim())?.textContent.trim() || '';
  const options = () => [...document.querySelectorAll('[role=option]')].filter((o) => optionName(o));

  function name() {
    const opt = document.querySelector('[role=option][aria-selected=true]');
    if (opt) return optionName(opt);
    const chip = [...document.querySelectorAll('button[aria-labelledby^="chip_"]')].find((b) => b.offsetParent);
    return chip?.textContent.replace(/arrow_drop_down\S*/g, '').trim() || '';
  }

  function post() {
    const n = name();
    if (!n) return;
    for (const f of document.querySelectorAll('iframe')) {
      if (!f.src.includes('/timelineview')) continue;
      f.contentWindow?.postMessage({ sb: 'gpayProfile', name: n }, 'https://payments.google.com');
    }
  }

  let switching = false;
  function pick(n) {
    const opt = options().find((o) => optionName(o) === n);
    if (!opt || switching) return;
    switching = true;
    SB.log(`匯入過去紀錄：切換到付款資料「${n}」`);
    SB.press(opt);
  }

  async function advance() {
    const bf = await SB.backfill();
    if (!bf || bf.progress?.gpay?.done) return;
    const cur = name();
    if (!cur) return;
    if (!bf.progress?.gpay?.origin) await SB.send('backfillProgress', { key: 'gpay', info: { origin: cur } });
    if (!bf.progress?.[`gpay:${cur}`]?.done) return; // 目前這個付款資料還在匯入
    const todo = options().map(optionName).find((n) => !bf.progress?.[`gpay:${n}`]?.done);
    if (todo) return pick(todo);
    const origin = bf.progress?.gpay?.origin || cur;
    if (cur !== origin) return pick(origin);
    SB.send('backfillDone', { key: 'gpay' });
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== 'https://payments.google.com') return;
    if (e.data?.sb === 'banner') SB.showBanner(e.data.summary);
    if (e.data?.sb === 'gpayDone') advance();
  });

  // 切換付款資料、iframe 重新載入時都會觸發 DOM 變動；另外每 2 秒補送一次，確保 iframe 載入後收得到
  new MutationObserver(post).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
  setInterval(post, 2000);
  post();
  setTimeout(advance, 3000); // 切換付款資料重新載入後，若目前這個已做完（例如切回原本的），接著往下
})();
