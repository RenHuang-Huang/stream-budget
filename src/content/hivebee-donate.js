// HiveBee 付費贊助頁（/{實況主}/donate）— 送出前提醒
// 2026/11/05 對照真實頁面：標題 h1「心 cocor0」、金額 input[name=money]、送出按鈕「立即贊助」（type=submit）
// 在「立即贊助」上方顯示這筆送出後的本月金額（只提醒，不影響送出）。
(() => {
  setInterval(() => {
    const m = location.pathname.match(/^\/([^/]+)\/donate\/?$/);
    const btn = m && [...document.querySelectorAll('button[type=submit]')].find((b) => /贊助/.test(b.innerText));
    const amount = Number(document.querySelector('input[name=money]')?.value);
    if (!btn) return SB.guard(null);
    // 顯示名稱和網址上的帳號都帶上，別名填哪個都對得到
    const channel = [document.querySelector('h1')?.textContent.trim(), decodeURIComponent(m[1])].filter(Boolean).join(' ');
    // 按鈕外層是橫向 flex（置中），插在外層上方，避免提醒框擠在按鈕旁邊
    SB.guard(btn.parentElement, { platform: 'hivebee', channel, amount, currency: 'TWD' });
  }, 700);
})();
