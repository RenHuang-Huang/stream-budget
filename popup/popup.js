import { monthKey } from '../src/lib/budget.js';

const $ = (s) => document.querySelector(s);
const send = (type, payload = {}) =>
  chrome.runtime.sendMessage({ type, ...payload }).then((r) => (r?.ok ? r.data : Promise.reject(r?.error)));

const PLATFORM_LABEL = { hivebee: 'HiveBee', youtube: 'YouTube', twitch: 'Twitch', manual: '其他' };

function meter(spent, limit, lvl) {
  const pct = limit ? Math.min(100, (spent / limit) * 100) : 0;
  return `<div class="meter ${lvl}" role="progressbar" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${spent}"><span style="width:${pct}%"></span></div>`;
}
const fmt = (n) => Math.round(n).toLocaleString('zh-TW');
const STATUS = { warn: '接近上限', over: '超過上限' };
const status = (lvl) => (STATUS[lvl] ? `<span class="status ${lvl}">${STATUS[lvl]}</span>` : '');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function render() {
  const s = await send('getSummary', { month: $('#month').value });

  const left = s.totalLimit - s.total;
  $('#total').innerHTML = `
    <div class="k"><span>本月總額</span>${status(s.totalLevel)}</div>
    <div class="v num"><b>NT$${fmt(s.total)}</b><span>/ ${fmt(s.totalLimit)}</span></div>
    ${meter(s.total, s.totalLimit, s.totalLevel)}
    <div class="d"><span>${left >= 0 ? `剩餘 NT$${fmt(left)}` : `超出 NT$${fmt(-left)}`}</span><span>共 ${s.count} 筆</span></div>`;

  // 花最多的排前面；本月還沒花的淡化、不畫進度條
  const list = [...s.streamers].sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name));
  $('#streamerCount').textContent = `${list.filter((x) => x.spent).length} / ${list.length} 位有花費`;
  $('#streamers').innerHTML = list.map((x) => `
    <li class="${x.spent ? '' : 'zero'}">
      <div class="row"><span class="name">${esc(x.name)}</span>${status(x.level)}<span class="amt num"><b>${fmt(x.spent)}</b> / ${fmt(x.limit)}</span></div>
      ${meter(x.spent, x.limit, x.level)}
      ${x.spent ? `<div class="plat">${Object.entries(x.byPlatform).map(([p, v]) => `${PLATFORM_LABEL[p] || p} ${fmt(v)}`).join('・')}</div>` : ''}
    </li>`).join('') || '<li class="empty">還沒有設定直播主</li>';

  $('#unmatchedCount').textContent = s.unmatched.length || '';
  $('#unmatched').innerHTML = s.unmatched
    .map((u) => `<li><span class="chip">${PLATFORM_LABEL[u.platform] || u.platform}</span><span class="ch">${esc(u.channel || '(無名稱)')}</span><span class="amt num">NT$${fmt(u.spent)}</span></li>`).join('')
    || '<li class="muted">沒有未對應的頻道</li>';

  $('#manualStreamer').innerHTML = s.streamers.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
}

$('#month').value = monthKey(new Date());
$('#month').addEventListener('change', render);
document.querySelector('[name=date]').valueAsDate = new Date();

$('#manual').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const streamer = [...$('#manualStreamer').options].find((o) => o.value === f.streamerId);
  await send('addManual', {
    record: {
      platform: f.platform,
      streamerId: f.streamerId,
      channel: streamer?.textContent || '',
      kind: f.kind,
      amount: Number(f.amount),
      currency: 'TWD',
      time: new Date(`${f.date}T12:00:00`).toISOString(),
    },
  });
  e.target.amount.value = '';
  render();
});

$('#openStats').addEventListener('click', () => { chrome.tabs.create({ url: chrome.runtime.getURL('stats/stats.html') }); });
$('#openOptions').addEventListener('click', () => { chrome.runtime.openOptionsPage(); });

render();
