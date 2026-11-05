// HiveBee 交易紀錄頁：https://www.hivebee.com.tw/member/history?tab=sponsorship
// 以「表頭文字」對欄位，不依賴 class 名稱，其他分頁（VIP 訂閱等）只要表頭類似也能解析。
(() => {
  const COLS = {
    channel: [/贊助頻道/, /頻道|創作者|賣場/],
    time: [/贊助時間/, /時間|日期/],
    kind: [/贊助類型/, /類型|方案/],
    note: [/留言/, /方案名稱/],
    status: [/付款狀態/, /狀態/],
    // VIP 訂閱頁表頭為「實際付款/方案費用」，值像 "$7000 / $10000"，取實際付款
    amount: [/金額/, /實際付款/],
    txId: [/交易單號|單號/],
  };

  function columnIndex(headers) {
    const idx = {};
    for (const [key, patterns] of Object.entries(COLS)) {
      for (const re of patterns) {
        const i = headers.findIndex((h) => re.test(h));
        if (i >= 0) { idx[key] = i; break; }
      }
    }
    return idx;
  }

  function parse() {
    const tab = new URL(location.href).searchParams.get('tab') || 'purchase';
    const out = [];
    // 購買點數／點數使用／金主空投不是給直播主的支出（用點數抖內會出現在付費贊助），避免重複計入
    if (/^(purchase|purchaseRecord|used|drops)$/.test(tab)) return out;
    for (const table of document.querySelectorAll('table')) {
      const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      const idx = columnIndex(headers);
      if (idx.amount == null || idx.txId == null) continue;

      for (const tr of table.querySelectorAll('tbody tr')) {
        const cells = [...tr.children].map((td) => td.innerText.trim());
        const txId = cells[idx.txId];
        const amount = SB.parseNumber(cells[idx.amount]);
        const time = SB.parseTime(cells[idx.time]);
        if (!txId || !Number.isFinite(amount) || !time) continue;
        const status = cells[idx.status] || '';
        out.push({
          id: `hivebee:${txId}`,
          platform: 'hivebee',
          tab,
          kind: cells[idx.kind] || tab,
          channel: cells[idx.channel] || '',
          note: cells[idx.note] || '',
          amount,
          currency: 'TWD',
          time,
          status,
          counted: !status || /成功|完成/.test(status),
        });
      }
    }
    return out;
  }

  // ── 匯入過去紀錄：每頁改 50 筆，一直按「下一頁」直到比起始日更舊或到最後一頁 ──
  // 2026/11/05 真實頁面：頁碼按鈕 button.min-w-7 放在一個 div 裡，前後各一個箭頭 button.button，
  // 頁碼只顯示 1 2 3 4 5 … 22 這種視窗，所以用「下一頁」箭頭；最後一頁時箭頭 disabled。
  let lastPageKey = '';
  async function backfillStep(rows) {
    const tab = new URL(location.href).searchParams.get('tab');
    if (!/^(sponsorship|subscription)$/.test(tab)) return;
    const bf = await SB.backfill();
    const key = `hivebee:${tab}`;
    if (!bf || bf.progress?.[key]?.done) return;

    const size = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === '50'));
    if (size && size.value !== '50') {
      size.value = '50';
      size.dispatchEvent(new Event('change', { bubbles: true }));
      return; // 換筆數後表格會重繪，下一輪再繼續
    }
    if (!rows.length && !/目前沒有資料/.test(document.body.innerText)) return; // 表格還沒載入

    const pageKey = rows[0]?.id || 'empty';
    if (pageKey === lastPageKey) return; // 這頁處理過了，等換頁
    lastPageKey = pageKey;

    const pager = document.querySelector('button.min-w-7')?.parentElement;
    const page = Number(pager?.querySelector('.bg-primary-normal')?.textContent) || 1;
    const next = pager?.nextElementSibling;
    const oldest = rows.reduce((m, r) => (r.time < m ? r.time : m), rows[0]?.time || '');
    const finished = !rows.length || oldest < bf.since || !next || next.disabled;
    const count = (bf.progress?.[key]?.count || 0) + rows.length;
    await SB.send('backfillProgress', { key, info: { label: tab === 'subscription' ? 'HiveBee VIP 訂閱' : 'HiveBee 付費贊助', page, count, oldest } });
    if (finished) return SB.send('backfillDone', { key });
    next.click();
  }

  SB.watch(async () => {
    const rows = parse();
    SB.log(`HiveBee 解析到 ${rows.length} 筆`);
    if (rows.length) await SB.report(rows);
    backfillStep(rows);
  });
})();
