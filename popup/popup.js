import { monthKey } from '../src/lib/budget.js';

const $ = (s) => document.querySelector(s);
const send = (type, payload = {}) =>
  chrome.runtime.sendMessage({ type, ...payload }).then((r) => (r?.ok ? r.data : Promise.reject(r?.error)));

const PLATFORM_LABEL = { hivebee: 'HiveBee', youtube: 'YouTube', twitch: 'Twitch', manual: '其他' };

function bar(spent, limit, lvl) {
  const pct = limit ? Math.min(100, (spent / limit) * 100) : 0;
  return `<div class="bar ${lvl}"><div style="width:${pct}%"></div></div>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function render() {
  const s = await send('getSummary', { month: $('#month').value });

  $('#total').innerHTML = `
    <div class="row"><span class="name">本月總額</span><span>NT$${s.total} / ${s.totalLimit}</span></div>
    ${bar(s.total, s.totalLimit, s.totalLevel)}
    <div class="sub">剩餘 NT$${Math.max(0, s.totalLimit - s.total)}・共 ${s.count} 筆</div>`;

  $('#streamers').innerHTML = s.streamers.map((x) => `
    <div class="card">
      <div class="row"><span class="name">${esc(x.name)}</span><span>NT$${x.spent} / ${x.limit}</span></div>
      ${bar(x.spent, x.limit, x.level)}
      <div class="sub">${Object.entries(x.byPlatform).map(([p, v]) => `${PLATFORM_LABEL[p] || p} ${v}`).join('・') || '本月尚無紀錄'}</div>
    </div>`).join('');

  $('#unmatchedCount').textContent = s.unmatched.length ? `(${s.unmatched.length})` : '';
  $('#unmatched').innerHTML = s.unmatched
    .map((u) => `<li>${PLATFORM_LABEL[u.platform] || u.platform}：${esc(u.channel || '(無名稱)')} — NT$${u.spent}</li>`).join('')
    || '<li class="sub">無</li>';

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

$('#openStats').addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL('stats/stats.html') }); });
$('#openOptions').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

render();
