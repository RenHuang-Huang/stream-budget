// 各平台 content script 共用（manifest 裡排在平台腳本之前載入）
globalThis.SB = (() => {
  const log = (...a) => console.log('[SB]', ...a);

  const send = (type, payload = {}) =>
    new Promise((resolve) =>
      chrome.runtime.sendMessage({ type, ...payload }, (res) => resolve(res?.ok ? res.data : null)),
    );

  /** "1,234" / "NT$ 100" / "$7000 / $10000"（取第一個數字）-> 數字 */
  const parseNumber = (s) => {
    const m = String(s || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  };

  /** "2026/11/03 19:48:50"（中間可能換行）-> ISO 字串，以瀏覽器本地時區解讀 */
  const parseTime = (s) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim().replace(/-/g, '/');
    const d = new Date(t);
    return isNaN(d) ? null : d.toISOString();
  };

  const sentIds = new Set();
  /** 只送出還沒送過的紀錄 */
  async function report(records) {
    const fresh = records.filter((r) => !sentIds.has(r.id));
    if (!fresh.length) return null;
    fresh.forEach((r) => sentIds.add(r.id));
    const res = await send('ingest', { records: fresh });
    log(`送出 ${fresh.length} 筆，新增 ${res?.added ?? '?'} 筆`);
    if (res) showBanner(res.summary);
    return res;
  }

  /**
   * 角落的本月狀態條。side：YouTube／Twitch 的聊天室在右邊，放左下角才不會蓋到送出按鈕
   * 本月還沒有任何金額時不顯示（已經顯示的也收掉）
   */
  function showBanner(summary, side = 'right') {
    if (!summary || window !== window.top) return; // 聊天室等 iframe 裡不顯示，避免同一頁出現兩個
    let el = document.getElementById('sb-banner');
    if (!summary.total) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'sb-banner';
      el.style.cssText =
        'position:fixed;bottom:16px;z-index:2147483647;padding:10px 14px;border-radius:10px;' +
        'font:13px/1.5 system-ui,sans-serif;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer;max-width:320px';
      el.title = '點擊關閉';
      el.onclick = () => el.remove();
      document.body.appendChild(el);
    }
    el.style.left = side === 'left' ? '16px' : '';
    el.style.right = side === 'left' ? '' : '16px';
    const bg = { ok: '#2e7d32', warn: '#e69500', over: '#c62828' };
    el.style.background = bg[summary.totalLevel];
    const lines = [`本月總額 NT$${summary.total} / ${summary.totalLimit}`];
    for (const s of summary.streamers)
      if (s.spent) lines.push(`${s.level === 'over' ? '⛔' : s.level === 'warn' ? '⚠️' : '•'} ${s.name} NT$${s.spent} / ${s.limit}`);
    el.textContent = '';
    lines.forEach((l, i) => {
      const div = document.createElement('div');
      div.textContent = l;
      if (i === 0) div.style.fontWeight = '600';
      el.appendChild(div);
    });
  }

  /** DOM 變動時（SPA 換頁、分頁載入）重新解析 */
  function watch(fn, delay = 800) {
    let timer;
    const run = () => { clearTimeout(timer); timer = setTimeout(fn, delay); };
    new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
    run();
  }

  /** 合成完整的滑鼠事件序列（Google 的按鈕只聽 mousedown/mouseup，單純 .click() 沒反應） */
  function press(el) {
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
      el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
  }

  /** 進行中的「匯入過去紀錄」任務，沒有則為 null */
  const backfill = () => send('getBackfill');

  // ── 送出前提醒（只顯示，不攔截、不改變網站的任何操作）──
  // guard(anchor, query)：在 anchor 前面顯示這筆送出後的本月金額；query = { platform, channel, amount, currency }。
  // 傳 null 清掉。各平台定時呼叫，參數沒變就不重新查詢。
  let gEl = null, gSig = '', gRes = null;
  async function guard(anchor, query) {
    if (!anchor || !query || !(query.amount > 0)) {
      if (gEl) gEl.remove();
      gSig = ''; gRes = null;
      return;
    }
    const sig = JSON.stringify(query);
    if (sig === gSig) {
      if (gEl && gRes && gEl.nextElementSibling !== anchor) anchor.before(gEl); // 平台重繪後補回去
      return;
    }
    gSig = sig;
    const res = await send('checkSpend', query);
    if (sig !== gSig || !res) return;
    gRes = res;
    if (!gEl) {
      gEl = document.createElement('div');
      gEl.id = 'sb-guard';
      gEl.style.cssText = 'margin:8px 0;padding:8px 10px;border-radius:8px;font:13px/1.5 system-ui,sans-serif;color:#fff;text-align:left;';
    }
    if (gEl.nextElementSibling !== anchor) anchor.before(gEl);
    renderGuard();
  }

  function renderGuard() {
    const r = gRes;
    gEl.style.background = { ok: '#2e7d32', warn: '#b26a00', over: '#c62828' }[r.level];
    const icon = { ok: '•', warn: '⚠️', over: '⛔' };
    const lines = [`這筆 NT$${r.twd}，送出後：`];
    lines.push(r.streamer
      ? `${icon[r.streamer.level]} ${r.streamer.name} NT$${r.streamer.after} / ${r.streamer.limit}`
      : '• 這個頻道還沒對應到直播主');
    lines.push(`${icon[r.totalLevel]} 本月總額 NT$${r.totalAfter} / ${r.totalLimit}`);
    const note = r.level === 'over' ? '送出後會超過上限' : '';
    if (note) lines.push(note);
    gEl.textContent = '';
    lines.forEach((l, i) => {
      const div = document.createElement('div');
      div.textContent = l;
      if (note && i === lines.length - 1) div.style.fontWeight = '600';
      gEl.appendChild(div);
    });
  }

  return { log, send, parseNumber, parseTime, report, showBanner, watch, press, backfill, guard };
})();
