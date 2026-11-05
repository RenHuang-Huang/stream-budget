// 自動化測試／截圖用：把擴充功能複製到暫存資料夾，網站權限改成「安裝時就有」（host_permissions），
// 省掉 Chrome 的授權詢問視窗（自動化點不到）。正式版的 manifest 不受影響。
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', '.git', '.agents', '.claude', 'docs', 'test']);

export function makeTestExtension() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sb-ext-'));
  cpSync(root, dir, { recursive: true, filter: (src) => !SKIP.has(path.relative(root, src).split(path.sep)[0]) });
  const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  m.host_permissions = m.optional_host_permissions;
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  return dir;
}

/** 在擴充功能頁面上把指定平台都設成已連結（等同使用者在設定頁勾選並允許） */
export async function connectAll(page, keys = ['hivebee', 'youtube', 'twitch', 'gpay']) {
  for (const key of keys) await page.evaluate((key) => chrome.runtime.sendMessage({ type: 'setConnected', key, on: true }), key);
}
