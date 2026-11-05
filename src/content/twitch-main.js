// Twitch 錢包頁（/wallet）— 跑在網頁本身的環境（manifest "world": "MAIN"）
// 擴充功能的 content script 在隔離環境，讀不到 React 掛在 DOM 上的資料；這支腳本把每列交易的資料
// 寫到 <tr data-sb="…JSON…">，再由 twitch.js（隔離環境）讀取。只讀，不改畫面。
//
// 2026/11/05 對照真實頁面：
// - 付款紀錄（?tab=purchase-history）：每列的 React props 有 paymentTransactionNodes[0]
//   { id, purchasedAt, product{type,name,tier,owner{login}}, grossAmount, grossAmountDivisor, currency,
//     quantity, isGift, recipient{login}, paymentMethod{provider} }
// - Bits 紀錄（?tab=bits-usage-history）：每列的 props 有 bitsEventNode
//   { id, amount, type (GIVE_BITS_TO_BROADCASTER / CREATE_HOLD), updatedAt, channel{login,displayName} }
(() => {
  function nodeOf(tr) {
    const key = Object.keys(tr).find((k) => k.startsWith('__reactFiber'));
    let f = key && tr[key];
    for (let i = 0; i < 8 && f; i++, f = f.return) {
      const p = f.memoizedProps;
      if (p?.paymentTransactionNodes?.[0]) return { kind: 'payment', n: p.paymentTransactionNodes[0] };
      if (p?.bitsEventNode) return { kind: 'bits', n: p.bitsEventNode };
    }
    return null;
  }

  function pick({ kind, n }) {
    if (kind === 'payment')
      return {
        kind, id: n.id, time: n.purchasedAt, type: n.product?.type, name: n.product?.name, tier: n.product?.tier,
        login: n.product?.owner?.login, amount: n.grossAmount / (n.grossAmountDivisor || 100), currency: n.currency,
        quantity: n.quantity, isGift: !!n.isGift, recipient: n.recipient?.login || '', provider: n.paymentMethod?.provider || '',
      };
    return {
      kind, id: n.id, time: n.updatedAt, type: n.type, amount: n.amount,
      login: n.channel?.login, displayName: n.channel?.displayName,
    };
  }

  function annotate() {
    if (location.pathname !== '/wallet') return;
    for (const tr of document.querySelectorAll('table tbody tr')) {
      const x = nodeOf(tr);
      if (!x) continue;
      const json = JSON.stringify(pick(x));
      // React 換頁時可能重用 <tr>，所以每次都比對、有變才更新
      if (tr.dataset.sb !== json) tr.dataset.sb = json;
    }
  }

  setInterval(annotate, 1000);
  annotate();
})();
