import { aliasPlatforms, connectables } from '../src/lib/platforms.js';

const $ = (s) => document.querySelector(s);
const send = (type, payload = {}) =>
  chrome.runtime.sendMessage({ type, ...payload }).then((r) => (r?.ok ? r.data : Promise.reject(r?.error)));

const PLATS = aliasPlatforms().map((p) => p.key);

// 直播主表格：每個支援別名的平台一欄（平台清單見 src/lib/platforms.js）
$('#cols').innerHTML = `<col class="c-name"><col class="c-limit">${'<col>'.repeat(PLATS.length)}<col class="c-del">`;
$('#heads').innerHTML = '<th>名稱</th><th>月上限 NT$</th>' +
  aliasPlatforms().map((p) => `<th><span class="plat"><i style="background:var(${p.color})"></i>${p.label} 別名</span></th>`).join('') +
  '<th aria-label="刪除"></th>';
let settings;
// 刪掉的「自動」直播主的頻道：儲存時加進 autoMatchIgnore，之後不再自動建立
const pendingIgnore = new Set();

function rowHtml(s) {
  const tr = document.createElement('tr');
  tr.dataset.id = s.id;
  if (s.auto) tr.dataset.auto = '1';
  tr.innerHTML = `
    <td><div class="namecell"><input name="name">${s.auto ? '<span class="badge" title="由系統依頻道名稱自動建立">自動</span>' : ''}</div></td>
    <td><input name="limit" type="number" min="0"></td>
    ${PLATS.map((p) => `<td><input name="${p}" placeholder="—"></td>`).join('')}
    <td><button class="del" title="刪除" aria-label="刪除"><svg class="i" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button></td>`;
  tr.querySelector('[name=name]').value = s.name;
  tr.querySelector('[name=limit]').value = s.limit ?? settings.defaultStreamerLimit;
  for (const p of PLATS) tr.querySelector(`[name=${p}]`).value = (s.aliases?.[p] || []).join(', ');
  tr.querySelector('.del').onclick = () => {
    if (s.auto) for (const p of PLATS) for (const a of s.aliases?.[p] || []) pendingIgnore.add(a);
    tr.remove();
    markDirty();
  };
  return tr;
}

function render() {
  for (const k of ['totalLimit', 'defaultStreamerLimit', 'warnRatio', 'bitsToTWD']) $(`#${k}`).value = settings[k];
  $('#autoMatch').checked = settings.autoMatch !== false;
  $('#usdToTWD').value = settings.fxRates?.USD ?? 32;
  $('#syncInterval').value = String(settings.syncInterval ?? 360);
  $('#rows').replaceChildren(...settings.streamers.map(rowHtml));
  const profiles = Object.entries(settings.gpayProfiles || {});
  $('#gpayProfiles').replaceChildren(
    ...(profiles.length
      ? profiles.map(([name, on]) => {
          const l = Object.assign(document.createElement('label'), { className: 'switch' });
          const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: on !== false });
          cb.dataset.name = name;
          l.append(cb, name);
          return l;
        })
      : [Object.assign(document.createElement('span'), { className: 'empty', textContent: '尚未讀到任何付款資料' })]),
  );
}

// ── 儲存列：有改動就提示「尚未儲存」 ──
function setSaveState(state, text) {
  $('#savebar').className = `savebar ${state}`;
  $('#status').textContent = text;
}
function markDirty() { setSaveState('dirty', '有尚未儲存的變更'); }
const markClean = () => setSaveState('', '設定都已儲存');
for (const id of ['#sec-limits', '#sec-streamers', '#sec-gpay']) {
  $(id).addEventListener('input', markDirty);
  $(id).addEventListener('change', markDirty);
}

function collect() {
  const num = (id) => Number($(`#${id}`).value);
  const split = (v) => v.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  return {
    ...settings,
    totalLimit: num('totalLimit'),
    defaultStreamerLimit: num('defaultStreamerLimit'),
    warnRatio: num('warnRatio'),
    bitsToTWD: num('bitsToTWD'),
    autoMatch: $('#autoMatch').checked,
    fxRates: { ...(settings.fxRates || {}), USD: num('usdToTWD') || 32 },
    syncInterval: Number($('#syncInterval').value),
    autoMatchIgnore: [...new Set([...(settings.autoMatchIgnore || []), ...pendingIgnore])],
    gpayProfiles: Object.fromEntries(
      [...document.querySelectorAll('#gpayProfiles input[type=checkbox]')].map((cb) => [cb.dataset.name, cb.checked]),
    ),
    streamers: [...$('#rows').children]
      .map((tr) => ({
        id: tr.dataset.id,
        name: tr.querySelector('[name=name]').value.trim(),
        limit: Number(tr.querySelector('[name=limit]').value),
        aliases: Object.fromEntries(PLATS.map((p) => [p, split(tr.querySelector(`[name=${p}]`).value)])),
        ...(tr.dataset.auto ? { auto: true } : {}),
      }))
      .filter((s) => s.name),
  };
}

$('#add').onclick = () => {
  const tr = rowHtml({ id: `s${Date.now()}`, name: '', limit: Number($('#defaultStreamerLimit').value) });
  $('#rows').appendChild(tr);
  tr.querySelector('[name=name]').focus();
  markDirty();
};

$('#runAutoMatch').onclick = async () => {
  // 先存下目前表單，避免對應完重畫時把還沒儲存的修改蓋掉
  settings = collect();
  await send('saveSettings', { settings });
  pendingIgnore.clear();
  const r = await send('runAutoMatch');
  settings = await send('getSettings');
  render();
  markClean();
  $('#autoMatchStatus').textContent =
    r.added.length || r.extended.length
      ? `新增 ${r.added.length} 位${r.added.length ? `（${r.added.join('、')}）` : ''}；補別名 ${r.extended.length} 位`
      : '沒有可以自動對應的頻道';
};

$('#save').onclick = async () => {
  settings = collect();
  pendingIgnore.clear();
  await send('saveSettings', { settings });
  setSaveState('saved', '已儲存');
  setTimeout(() => $('#savebar').classList.contains('saved') && markClean(), 2000);
};

$('#export').onclick = async () => {
  const data = await send('exportData');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `stream-budget-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
};

$('#import').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  await send('importData', { data: { settings: data.settings, records: data.records || {} } });
  settings = await send('getSettings');
  render();
  markClean();
};

$('#clear').onclick = async () => {
  // 不用 confirm()：彈窗會卡住自動化測試，改成按兩次確認
  const b = $('#clear');
  if (b.dataset.armed) { await send('clearRecords'); b.textContent = '已清除'; delete b.dataset.armed; return; }
  b.dataset.armed = '1';
  b.textContent = '再按一次確認清除';
};

// ── 自動更新 ──
async function renderSync() {
  const st = await send('getSyncStatus');
  const last = st.lastSyncAt ? new Date(st.lastSyncAt).toLocaleString('zh-TW') : '尚未更新過';
  let next = '';
  if (st.interval) {
    const due = st.lastSyncAt + st.interval * 60000;
    next = due <= Date.now()
      ? (st.platformOpen ? '・即將更新' : '・已到更新時間，打開 HiveBee／YouTube／Twitch 任一頁面時執行')
      : `・下次約 ${new Date(due).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  }
  $('#syncStatus').textContent = `上次更新：${last}${next}`;
}
$('#syncInterval').onchange = async () => {
  settings = { ...settings, syncInterval: Number($('#syncInterval').value) };
  await send('saveSettings', { settings });
  renderSync();
};
$('#syncNow').onclick = async () => {
  const r = await send('syncNow');
  $('#syncStatus').textContent = r.started ? '更新中…（背景分頁完成後會自動關閉）'
    : r.reason === 'busy' ? '目前已有匯入／更新在進行'
    : r.reason === 'noConnection' ? '請先在上方連結至少一個平台' : '無法開始';
  renderBackfill();
  setTimeout(renderSync, 4000);
};

// ── 匯入過去紀錄 ──
const fmtDate = (s) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString('zh-TW') : '—');
let pollTimer;
async function renderBackfill() {
  const bf = await send('getBackfillStatus');
  const running = !!bf?.running;
  $('#backfillStart').disabled = !!running;
  $('#backfillStart').textContent = running ? '匯入中…' : '開始匯入';
  if (!running && !Object.values(connections).some(Boolean)) $('#backfillStart').disabled = true;
  const items = Object.entries(bf?.progress || {}).filter(([k, p]) => k !== 'gpay' && p.label);
  $('#backfillProgress').replaceChildren(
    ...items.map(([, p]) => {
      const li = document.createElement('li');
      li.className = p.done ? 'done' : '';
      const dot = Object.assign(document.createElement('span'), { className: 'dot' });
      const text = Object.assign(document.createElement('span'), {
        textContent: `${p.label}${p.done ? '（完成）' : ''}：已讀 ${p.count ?? 0} 筆，最舊到 ${fmtDate(p.oldest)}`,
      });
      li.append(dot, text);
      return li;
    }),
  );
  if (bf?.finishedAt) {
    const li = Object.assign(document.createElement('li'), { className: 'summary' });
    li.textContent = bf.kind === 'sync'
      ? `自動更新完成（${new Date(bf.finishedAt).toLocaleString('zh-TW')}）`
      : `匯入結束（${new Date(bf.finishedAt).toLocaleString('zh-TW')}，${bf.months ? `近 ${bf.months} 個月` : '全部'}）`;
    $('#backfillProgress').appendChild(li);
  }
  clearTimeout(pollTimer);
  if (running) pollTimer = setTimeout(renderBackfill, 1500);
  // 付款資料清單可能多了；表單有還沒儲存的修改時不重畫，免得蓋掉
  else if (bf?.finishedAt && !$('#savebar').classList.contains('dirty')) { settings = await send('getSettings'); render(); renderSync(); }
}

// ── 連結平台 ──
// 勾選：先向使用者要網站權限（chrome.permissions.request 要在點擊當下呼叫，前面不能有 await），允許後才記下並註冊
// 取消：收回網站權限。實際狀態以背景回傳的 getConnections 為準（使用者也可能從 chrome://extensions 收回）。
let connections = {};
const hostOf = (o) => o.replace(/^https:\/\//, '').replace(/\/\*$/, '');
function renderConnections() {
  $('#connectList').replaceChildren(...connectables().map((item) => {
    const on = !!connections[item.key];
    const li = document.createElement('li');
    li.className = on ? 'on' : '';
    li.innerHTML = `
      <label class="switch"><input type="checkbox" ${on ? 'checked' : ''} aria-label="連結 ${item.label}"></label>
      <div><div class="name">${item.color ? `<i style="background:var(${item.color})"></i>` : ''}${item.label}<span class="state">${on ? '已連結' : '未連結'}</span></div>
      <div class="about">${item.connect.desc}</div></div>
      <div class="sites">${[...new Set(item.connect.origins.map(hostOf))].join('、')}</div>`;
    li.querySelector('input').onchange = (e) => toggleConnection(item, e.target.checked, e.target);
    return li;
  }));
  $('#backfillStart').title = Object.values(connections).some(Boolean) ? '' : '請先在上方連結至少一個平台';
}

function toggleConnection(item, on, input) {
  const origins = item.connect.origins;
  const ask = on ? chrome.permissions.request({ origins }) : chrome.permissions.remove({ origins });
  ask.then(async (ok) => {
    if (on && !ok) { input.checked = false; return; } // 使用者在 Chrome 的詢問視窗按了拒絕
    connections = await send('setConnected', { key: item.key, on });
    renderConnections();
    renderBackfill();
  }).catch((e) => { input.checked = !on; alertLine(`連結 ${item.label} 失敗：${e.message || e}`); });
}
const alertLine = (msg) => $('#connectList').after(Object.assign(document.createElement('p'), { className: 'hint', role: 'alert', textContent: msg }));

$('#backfillStart').onclick = async () => {
  $('#welcome').hidden = true;
  $('#backfillSkip').hidden = true;
  await send('startBackfill', { months: Number($('#backfillMonths').value) });
  renderBackfill();
};
$('#backfillSkip').onclick = async () => {
  await send('skipSetup');
  $('#welcome').hidden = true;
  $('#backfillSkip').hidden = true;
};

settings = await send('getSettings');
render();
connections = await send('getConnections');
renderConnections();
if (!(await send('getSetupDone'))) {
  $('#connectWelcome').hidden = Object.values(connections).some(Boolean);
  $('#welcome').hidden = false;
  $('#backfillSkip').hidden = false;
}
renderBackfill();
renderSync();

// ── 左側導覽：捲到哪一區就標示哪一項 ──
const navLinks = [...document.querySelectorAll('.nav a')];
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      navLinks.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`));
    }
  },
  { rootMargin: '-20% 0px -70% 0px' },
);
document.querySelectorAll('.main > section').forEach((sec) => io.observe(sec));
navLinks[0]?.classList.add('on');
// 最後幾區太短、到不了偵測線：捲到底時直接標示最後一區
addEventListener('scroll', () => {
  if (innerHeight + scrollY < document.documentElement.scrollHeight - 4) return;
  navLinks.forEach((a, i) => a.classList.toggle('on', i === navLinks.length - 1));
}, { passive: true });

// ── 外觀：跟隨系統／淺色／深色（存在 localStorage，三個頁面共用，見 ui/theme.js）──
function renderTheme() {
  const pref = window.SBTheme.get();
  for (const b of $('#themePick').children) b.setAttribute('aria-checked', String(b.dataset.v === pref));
  const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
  $('#themeSys').textContent = `（目前${sysDark ? '深色' : '淺色'}）`;
}
$('#themePick').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) window.SBTheme.set(b.dataset.v);
});
addEventListener('sb-themechange', renderTheme);
renderTheme();
