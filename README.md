# 斗內預算管家（Chrome Extension, MV3）

依直播主設定每月抖內上限（預設每人 NT$1000、總額 NT$3000），彙整 HiveBee / YouTube / Twitch 的贊助紀錄。

## 安裝
1. `chrome://extensions` → 開啟「開發人員模式」
2. 「載入未封裝項目」→ 選這個資料夾
3. 改程式碼後在同一頁按 ⟳ 重新載入

## 結構
| 檔案 | 說明 |
|---|---|
| `src/lib/budget.js` | 純邏輯：別名對應、月份彙總、上限判斷、通知門檻 |
| `src/background.js` | 存資料（chrome.storage.local）、徽章%、超額通知 |
| `src/content/common.js` | 內容腳本共用：送資料、右下角狀態條 |
| `src/content/hivebee.js` | ✅ 交易紀錄表格解析（依表頭文字對欄位） |
| `src/content/gpay.js`、`gpay-top.js`、`src/lib/gpay.js` | ✅ Google 付款中心「活動」：YouTube 會員／禮贈會籍／Super Chat／寶石、手機 App 付的 Twitch 贈訂 |
| `src/content/ytchat.js` | ✅ 直播聊天室偵測自己送出的 Super Chat，補付款紀錄缺的頻道（已實際送出 Super Chat 驗證）；超級留言面板的送出前提醒 |
| `src/content/hivebee-donate.js` | 🧪 HiveBee 贊助頁（`/{實況主}/donate`）的送出前提醒 |
| `src/content/youtube.js` | 直播頁顯示本月狀態 |
| `src/content/twitch.js`、`twitch-main.js` | ✅ Twitch 錢包：付款紀錄（訂閱、贈訂）、Bits 使用紀錄（Cheering、Power-ups） |
| `ui/` | 三個頁面共用的配色（深淺兩組色票）與元件；`theme.js` 處理深淺色：預設跟隨系統，可在設定頁選「跟隨系統／淺色／深色」，彈出視窗與圖表頁右上角有切換鈕（依 modern-web-guidance 的 dark-mode-toggle 做法） |
| `popup/` | 本月總覽（總額、各直播主進度與狀態）、未對應頻道、手動新增、開啟圖表／設定 |
| `stats/`、`src/lib/stats.js` | 統計儀表板（依 ui-ux-pro-max 建議）：指標卡＋走勢線、每月趨勢面積圖、直播主預算進度、各平台堆疊長條、依直播主／平台環圈圖、每日花費日曆熱力圖、最近交易、表格檢視 |
| `vendor/` | Chart.js 4.4.1、D3 7.8.5（MIT，擴充功能不能從 CDN 載入，所以放本地） |
| `options/` | 左側導覽的設定頁：匯入過去紀錄、自動更新、上限與匯率、直播主別名、Google 付款資料、外觀、資料匯出入；有未儲存的變更時底部提示 |

## 對應規則
未設定的頻道會自動對應（`src/lib/automatch.js`，選項頁可關閉）：頻道名稱拆成片段（中日韓文字一段、英文一段，去掉 ch／official／頻道等常見字），有共同片段的頻道跨平台歸成同一人；和既有直播主重疊就補別名，否則新增標示「自動」的直播主。刪除自動直播主後該頻道列入 `autoMatchIgnore` 不再建立。沒有頻道名稱的紀錄（網頁付的「YouTube 超級留言」、Google Play 的 Twitch 贈訂）無法自動對應。

直播主可在三個平台各設別名，交易的頻道名稱「包含」別名即計入（忽略大小寫、符號、emoji）。
只計入付款狀態為「成功／完成」的紀錄，以交易單號去重。

## 測試
```
npm test          # 單元測試
npm run e2e       # 在 Chromium 載入 extension，用 fixture 模擬 HiveBee 頁面
```

## 待辦
- [x] 確認 HiveBee 真實頁面的表格結構與分頁（2026/11/05 已對照）
  - 付費贊助 `?tab=sponsorship`、VIP 訂閱 `?tab=subscription` 皆為 `<table>`＋`<thead>`；頁籤與分頁都是按鈕（SPA），翻頁網址不變，靠 MutationObserver 重新解析
  - 每頁預設 20 筆，可選到 50；要匯入舊紀錄需逐頁點過
  - VIP 金額欄為「實際付款/方案費用」（`$7000 / $10000`），取第一個數字
  - 購買記錄／點數使用／金主空投不計入（用點數抖內已出現在付費贊助）
  - 頻道名稱前的愛心實際文字是「心」（網站字型畫成愛心），別名用包含比對不受影響
- [x] YouTube：從 Google 付款紀錄解析（2026/11/05 已對照真實頁面）
  - 資料在 `pay.google.com/gp/w/home/activity` 內的 iframe `payments.google.com/payments/u/N/timelineview`；每列 `tr.b3-widget-table-data-row`
  - 列表日期沒有年份、沒有交易 ID → 依順序推算年份；去重 ID = 付款資料＋日期＋說明＋金額＋當日序號（列表未載到底時略過最後一天）
  - 「查看更多交易」一次多載 20 筆，要匯入舊紀錄就一直按
  - 有多個付款資料時要各切換過去一次；選項頁可勾選哪些付款資料計入
  - 網頁付的 Super Chat 只寫「YouTube 超級留言」，沒有頻道 → 計入總額、列在未對應；若在直播聊天室送出時有被 `ytchat.js` 記到，會用金額＋日期（±1 天）補上頻道
  - 心可可的 YouTube 頻道在付款紀錄顯示為「心 cocor0」，預設別名 `cocor0` 對得到
- [x] 匯入過去紀錄（選項頁，第一次安裝時會詢問；預設近 6 個月）
  - 背景開 HiveBee 付費贊助／VIP 訂閱、Google 付款中心分頁，content script 自動翻頁，做完自動關閉；進度記在 `storage.backfill`，30 分鐘逾時
  - HiveBee：每頁改 50 筆，按分頁列右側箭頭（`button.min-w-7` 父層的下一個兄弟），disabled 即最後一頁
  - Google：按「查看更多交易」（div.jfk-button，需送 mousedown/mouseup，`SB.press`）；一個付款資料做完由 `gpay-top.js` 切下一個（點 `[role=option]` 會重新載入整頁），最後切回原本的付款資料
  - 背景的 storage 寫入全部排隊（`serial`），避免多個分頁同時送資料互相覆蓋
- [x] 自動更新（選項頁：關閉／1 小時／6 小時／每天，預設 6 小時；「立即更新」）
  - `chrome.alarms` 每 15 分鐘檢查是否到期；到期且使用者開著 HiveBee／YouTube／Twitch 任一頁面（`presence.js` 回報到 `storage.session`）才執行，否則等下次打開平台頁面
  - 沿用匯入流程（kind = 'sync'），從上次更新前一天抓起，分頁開在該平台頁面的視窗背景
  - 只有匯入／更新自己開的分頁會自動翻頁（`getBackfill` 依 sender.tab 判斷），使用者自己開的紀錄頁不受影響
- [x] 實測 `ytchat.js`：實際送一筆 Super Chat 確認比對自己、讀金額與頻道；修正把送出面板的預覽卡當成已送出、`1:42 PM` 時間格式、聊天室 iframe 裡多一個狀態框
- [ ] 實測 Google 付款紀錄出現該筆超級留言後，線索有補上頻道
- [x] Twitch（2026/11/05 對照真實頁面）
  - 資料在 React props：付款紀錄 `paymentTransactionNodes[0]`、Bits 紀錄 `bitsEventNode`；content script 在隔離環境讀不到，所以 `twitch-main.js` 以 `"world": "MAIN"` 跑在網頁環境，把資料寫到 `<tr data-sb>`，再由 `twitch.js` 讀取
  - 實況主取 `product.owner.login`（商品名稱是實況主自訂的方案名，可能不含頻道，例如「小鹿方案」）；Bits 頻道記成「顯示名稱 (帳號)」
  - 金額多為 USD，依選項頁匯率（預設 1 USD = NT$32）換算；購買 Bits 不計入，Bits 在使用時依「1 小奇點 = NT$」算到實況主
  - 手機 App 用 Google Play 付的訂閱在這裡是 provider `GOOGLE_IAB`（TWD），和 Google 付款紀錄重複 → `dropDuplicateGpayTwitch` 以 Twitch 這筆為準
  - 付款紀錄一頁 15 筆，按 `button[aria-label="Next payment history page"]`；Bits 紀錄捲動到底載入更多
  - 付款紀錄預設日期範圍約 6 個月，用程式改日期輸入框不會重新查詢，所以匯入超過 6 個月時 Twitch 只會到 6 個月前
- [x] 送出前提醒：HiveBee「立即贊助」、YouTube「購買並傳送」、Twitch 聊天室 Cheer 上方顯示送出後的金額（只提醒，不攔截）。`common.js` 的 `SB.guard`、`budget.js` 的 `previewSpend`
  - [x] HiveBee、YouTube 實際頁面驗證（2026/11/05）；YouTube／Twitch 的本月狀態框改在左下角，避免蓋到聊天室的送出按鈕
  - [ ] Twitch：提醒移到輸入框下方（避開 Cheer 面板）、改用「顯示名稱 (帳號)」比對，待重新載入後驗證
  - Twitch 只認全站通用的 Cheermote 前綴；HiveBee VIP 訂閱頁、YouTube 會員／贈送會員、Twitch 訂閱尚未加提醒
