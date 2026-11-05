// pay.google.com 外層：
// 1. 活動 iframe 來問時，回覆目前選的付款資料名稱（右上角下拉選單，例如「王小明」）
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
    // 活動 iframe 來問目前的付款資料名稱：回給發問的視窗，targetOrigin 用它實際的 origin，不會對不上
    if (e.data?.sb === 'gpayAsk') {
      const n = name();
      if (n) e.source?.postMessage({ sb: 'gpayProfile', name: n }, e.origin);
    }
    if (e.data?.sb === 'banner') SB.showBanner(e.data.summary);
    if (e.data?.sb === 'gpayDone') advance();
  });

  setTimeout(advance, 3000); // 切換付款資料重新載入後，若目前這個已做完（例如切回原本的），接著往下
})();
