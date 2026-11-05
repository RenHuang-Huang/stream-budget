# 斗內預算管家 隱私權政策

最後更新：2026-11-06

「斗內預算管家」（以下稱本擴充功能）是一個 Chrome 擴充功能，幫使用者整理自己在直播平台的贊助花費，並依使用者設定的每月預算提醒。

## 我們讀取哪些資料

只有在你於設定頁「連結平台」打開某個平台、並在 Chrome 跳出的視窗按「允許」之後，本擴充功能才會讀取該網站。沒有連結的網站完全不讀取。

| 來源 | 讀取內容 |
|---|---|
| HiveBee 交易紀錄頁 | 付費贊助、VIP 訂閱的日期、金額、頻道名稱、方案、付款狀態、交易單號 |
| Google 付款中心（活動） | YouTube 與 Google Play（Twitch）交易的日期、金額、說明；目前選擇的付款資料名稱 |
| YouTube 直播頁與聊天室 | 你自己送出的超級留言的頻道與金額（用來補上付款紀錄缺少的頻道名稱） |
| Twitch 錢包頁 | 付款紀錄（訂閱、贈訂）與 Bits 使用紀錄的日期、金額、頻道 |

另外會儲存你自己輸入的設定：每月上限、直播主名稱與別名、要計入的付款資料、外觀偏好。

## 資料存在哪裡

所有資料只存在你這台電腦的 Chrome 擴充功能儲存空間（`chrome.storage.local`）。

- 本擴充功能**沒有後端伺服器**，也**不會發出任何網路請求**把資料送出去。
- 不使用分析、追蹤或廣告工具。
- 不出售、不分享、不轉移任何資料給第三方。
- 不將資料用於與預算提醒無關的用途，也不用於判斷信用或放款。

## 你可以怎麼管理資料

- **匯出**：設定頁「資料」區按「匯出 JSON」，下載所有設定與紀錄。
- **清除**：設定頁「資料」區按「清除所有交易紀錄」。
- **停止讀取**：設定頁「連結平台」關掉某個平台，會同時收回該網站的存取權限。
- **完全移除**：在 `chrome://extensions` 移除本擴充功能，Chrome 會一併刪除它儲存的所有資料。

## 政策變更

本政策若有變更，會更新本頁並修改上方的「最後更新」日期。

## 聯絡方式

有任何問題請在 GitHub 提出 issue：<https://github.com/RenHuang-Huang/stream-budget/issues>

---

## Privacy Policy (English summary)

Stream Budget (斗內預算管家) reads sponsorship transaction records (date, amount, channel, plan, status, transaction ID) only from the sites the user explicitly connects and grants access to: HiveBee, Google Payments activity (YouTube / Google Play), YouTube live chat, and Twitch wallet. It also stores the user's own budget settings.

All data is stored locally in `chrome.storage.local` on the user's device. The extension has no server, makes no network requests to send data anywhere, uses no analytics or tracking, and never sells, shares, or transfers data to third parties, or uses it for any purpose other than budget reminders or for creditworthiness or lending. Users can export or clear their data from the options page, revoke site access by disconnecting a platform, and remove all data by uninstalling the extension.

Contact: <https://github.com/RenHuang-Huang/stream-budget/issues>
