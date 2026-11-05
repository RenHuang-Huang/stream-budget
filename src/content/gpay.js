// Google 付款中心「活動」iframe（payments.google.com/payments/u/N/timelineview）
// 解析邏輯在 src/lib/gpay.js；這裡只負責讀 DOM、取得付款資料名稱、送出、匯入過去紀錄時自動載入更多。
// 付款資料名稱在外層 pay.google.com：這裡每 2 秒用 postMessage 問一次（gpayAsk），gpay-top.js 回覆給發問的視窗。
// 由 iframe 主動問而不是外層主動送：外層看不到跨網域 iframe 當下實際的網址（Google 會把它導來導去），
// 指定的 targetOrigin 一對不上 Chrome 就會報「target origin … does not match」錯誤。
(async () => {
  const TOP = 'https://pay.google.com';
  const ancestors = location.ancestorOrigins || [];
  // 只在嵌在 pay.google.com 裡的 iframe 跑（直接開這個網址時讀不到付款資料名稱）
  if (window.top === window || ancestors[ancestors.length - 1] !== TOP) return;
  const toTop = (msg) => window.top.postMessage(msg, TOP);
  const { parseGpayRows, rowDates } = await import(chrome.runtime.getURL('src/lib/gpay.js'));

  let profile = null;
  window.addEventListener('message', (e) => {
    if (e.origin !== TOP || e.data?.sb !== 'gpayProfile') return;
    if (e.data.name && e.data.name !== profile) {
      profile = e.data.name;
      SB.send('gpaySeen', { profile }); // 沒有任何紀錄的付款資料也要出現在選項頁
      run();
    }
  });

  function readRows() {
    return [...document.querySelectorAll('tr.b3-widget-table-data-row')]
      .filter((tr) => tr.children.length === 3)
      .map((tr) => {
        const lines = tr.children[1].innerText.split('\n').map((s) => s.trim()).filter(Boolean);
        return { title: lines[0], line: lines[1], amount: tr.children[2].innerText.trim() };
      });
  }

  // 「查看更多交易」是 div.jfk-button，要用 SB.press 送完整滑鼠事件
  const moreButton = () =>
    [...document.querySelectorAll('[role=button],button')].find((b) => b.innerText.trim() === '查看更多交易');

  // ── 匯入過去紀錄：一直按「查看更多交易」直到比起始日更舊或沒有更多；完成後通知外層切下一個付款資料 ──
  let lastCount = -1;
  async function backfillStep(raw) {
    const bf = await SB.backfill();
    const key = `gpay:${profile}`;
    if (!bf || bf.progress?.[key]?.done) return;
    if (!raw.length && !/目前沒有任何活動/.test(document.body.innerText)) return; // 列表還沒載入
    if (raw.length === lastCount) return; // 還在等下一批載入
    lastCount = raw.length;

    const dates = rowDates(raw).map((d) => d.date).filter(Boolean);
    const oldest = dates[dates.length - 1] || '';
    const more = moreButton();
    const since = bf.since.slice(0, 10);
    await SB.send('backfillProgress', { key, info: { label: `Google 付款資料「${profile}」`, count: raw.length, oldest } });
    if (!more || (oldest && oldest < since)) {
      await SB.send('backfillDone', { key });
      toTop({ sb: 'gpayDone', profile });
      return;
    }
    SB.press(more);
  }

  let timer;
  let gaveUp = false;
  function run() {
    if (!profile && !gaveUp) return; // 還沒收到付款資料名稱，先不送，避免 ID 用錯名稱
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const raw = readRows();
      const rows = parseGpayRows(raw, { profile: profile || '未知', complete: !moreButton() });
      SB.log(`Google 付款紀錄（${profile || '未知'}）解析到 ${rows.length} 筆 YouTube／Twitch 交易`);
      // iframe 很長，狀態條畫在 iframe 裡會落在看不到的底部 → 交給外層 gpay-top.js 顯示
      if (rows.length) {
        const res = await SB.report(rows);
        document.getElementById('sb-banner')?.remove();
        if (res?.summary) toTop({ sb: 'banner', summary: res.summary });
      }
      if (profile) backfillStep(raw);
    }, 800);
  }

  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
  const ask = () => toTop({ sb: 'gpayAsk' });
  setInterval(ask, 2000);
  ask();
  // 等外層傳付款資料名稱；8 秒內沒收到就用「未知」（之後收到真名稱時，背景會清掉「未知」的重複紀錄）
  setTimeout(() => { if (!profile) { gaveUp = true; run(); } }, 8000);
})();
