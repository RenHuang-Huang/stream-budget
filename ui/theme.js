// 深淺色設定（依 modern-web-guidance dark-mode-toggle）
// 在 <head> 裡、緊接 <meta name="color-scheme"> 之後用一般 <script>（不要 module / defer）載入，
// 頁面畫出來前就套好，避免先閃一下錯的配色。擴充功能頁不允許內嵌 script，所以獨立成檔。
//
// 狀態：localStorage "color-scheme" 不存在 = 跟隨系統；"light" / "dark" = 使用者指定。
// 三個頁面同屬擴充功能，localStorage 共用；一頁切換，其他開著的頁面透過 storage 事件同步。
(() => {
  const KEY = 'color-scheme';
  const meta = document.querySelector('meta[name="color-scheme"]');
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const apply = (v) => {
    meta.content = v || 'light dark';
    dispatchEvent(new CustomEvent('sb-themechange', { detail: { pref: v || 'system', resolved: resolved() } }));
  };
  const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = () => (meta.content === 'dark' || (meta.content !== 'light' && systemDark()) ? 'dark' : 'light');

  meta.content = read() || 'light dark';

  /** 指定 'system' | 'light' | 'dark'（設定頁的三選一） */
  function set(pref) {
    try {
      if (pref === 'light' || pref === 'dark') localStorage.setItem(KEY, pref);
      else localStorage.removeItem(KEY);
    } catch { /* 存不了也照樣套用到這一頁 */ }
    apply(pref === 'light' || pref === 'dark' ? pref : null);
  }

  /** 兩段式切換鈕：切到「目前看到的」相反配色；和系統一樣時就回到跟隨系統（不要把它存下來釘死） */
  function toggle() {
    const target = resolved() === 'dark' ? 'light' : 'dark';
    set((target === 'dark') === systemDark() ? 'system' : target);
  }

  addEventListener('storage', (e) => { if (e.key === KEY || e.key === null) apply(read()); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => apply(read()));

  // 頁面上所有 .theme-toggle 按鈕
  document.addEventListener('click', (e) => { if (e.target.closest('.theme-toggle')) toggle(); });

  window.SBTheme = { get: () => read() || 'system', set, toggle, resolved };
})();
