// 打包上架用的 zip（npm run pack）→ dist/stream-budget-<version>.zip
// 只放執行需要的檔案；docs、test、node_modules 等不會進去。
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const include = ['manifest.json', 'icons', 'src', 'popup', 'options', 'stats', 'ui', 'vendor'];

const { version } = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const store = readFileSync(path.join(root, 'CHROMEWEBSTORE.md'), 'utf8');
if (!store.includes(`version\` ${version}`)) {
  console.warn(`⚠ CHROMEWEBSTORE.md 的「對應 manifest version」不是 ${version}，送審前記得更新權限說明與變更紀錄。`);
}
for (const f of include) if (!existsSync(path.join(root, f))) throw new Error(`找不到 ${f}`);

const out = path.join(root, 'dist', `stream-budget-${version}.zip`);
mkdirSync(path.dirname(out), { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-q', '-X', out, ...include, '-x', '*.DS_Store'], { cwd: root, stdio: 'inherit' });
console.log(`已產生 ${path.relative(root, out)}`);
