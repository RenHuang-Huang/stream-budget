// 斗內統計儀表板：Chart.js（趨勢、堆疊長條、環圈）＋ D3（日曆熱力圖）
// Chart / d3 由 ../vendor/ 的 UMD 檔以全域變數提供（擴充功能頁不能從 CDN 載入程式）
import { monthsBack, buildStats, lineSeries, recipientsOf, platformsOf, dailyTotals, recentRecords, PLATFORM_LABEL } from '../src/lib/stats.js';
import { level } from '../src/lib/budget.js';
import { localDate } from '../src/lib/gpay.js';

const { Chart, d3 } = window;
const $ = (s) => document.querySelector(s);
const root = $('.viz-root');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (n) => `NT$${Math.round(n).toLocaleString('zh-TW')}`;
const short = (n) => (n >= 10000 ? `${+(n / 10000).toFixed(1)}萬` : Math.round(n).toLocaleString('zh-TW'));
const monthShort = (m) => `${Number(m.slice(5))}月`;
const monthLong = (m) => `${m.slice(0, 4)} 年 ${Number(m.slice(5))} 月`;
const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();
const send = (type, payload = {}) =>
  chrome.runtime.sendMessage({ type, ...payload }).then((r) => (r?.ok ? r.data : Promise.reject(r?.error)));

const PLATFORMS = ['hivebee', 'youtube', 'twitch', 'manual'];
const PLATFORM_VAR = { hivebee: '--series-1', youtube: '--series-2', twitch: '--series-3', manual: '--series-4' };
const KIND_LABEL = {
  superchat: 'Super Chat', membership: '會員', 'gift-membership': '贈送會員', jewels: '寶石', 'gift-sub': '贈訂', sub: '訂閱',
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = { range: 12, month: '', table: false };
let records = [];
let settings;
let colorOf = () => css('--other');
const charts = {};

// ───────────── Chart.js 全域樣式 ─────────────
function themeChartDefaults() {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 11;
  Chart.defaults.color = css('--text-muted');
  Chart.defaults.borderColor = css('--grid');
  // 只改屬性，不要整個換掉 defaults.animation（會弄掉內部設定，動畫時拋 this._fn is not a function）
  Chart.defaults.animation.duration = reduceMotion ? 0 : 450;
  Chart.defaults.animation.easing = 'easeOutCubic';
  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: css('--surface-2'),
    borderColor: css('--border'),
    borderWidth: 1,
    titleColor: css('--text-primary'),
    bodyColor: css('--text-secondary'),
    footerColor: css('--text-primary'),
    padding: 10,
    cornerRadius: 10,
    boxPadding: 4,
    usePointStyle: true,
  });
  Chart.defaults.plugins.legend.display = false;
}

const remake = (id, config) => {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById(id), config);
  return charts[id];
};

// ───────────── 指標卡 ─────────────
const ICON = {
  wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 2 2V2l-2 2-3-2-3 2-3-2-3 2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  avg: '<path d="M3 3v18h18"/><path d="m7 17 4-6 4 3 4-7"/>',
  sum: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
};

function sparkline(values) {
  const w = 96, h = 34, max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i * w) / Math.max(values.length - 1, 1), h - 3 - (v / max) * (h - 6)]);
  const line = d3.line().curve(d3.curveMonotoneX)(pts);
  const area = d3.area().curve(d3.curveMonotoneX).y0(h)(pts);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path class="a" d="${area}"/><path class="l" d="${line}"/></svg>`;
}

function renderKpis(stats) {
  const i = stats.months.indexOf(state.month);
  const cur = stats.summaries[i];
  const prev = stats.summaries[i - 1];
  const totals = stats.summaries.map((s) => s.total);
  const counts = stats.summaries.map((s) => s.count);
  const active = totals.filter(Boolean);
  const avg = active.length ? active.reduce((a, b) => a + b, 0) / active.length : 0;
  const sum = totals.reduce((a, b) => a + b, 0);
  const lv = level(cur.total, cur.totalLimit, settings.warnRatio);
  const pct = cur.totalLimit ? Math.min(100, (cur.total / cur.totalLimit) * 100) : 0;
  let delta = '';
  if (prev?.total) {
    const d = ((cur.total - prev.total) / prev.total) * 100;
    delta = `<span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}%</span>比上月`;
  }
  const card = (icon, k, v, d, extra = '', spark = '') =>
    `<article class="kpi"><div class="k"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[icon]}</svg>${k}</div>
     <div class="v num">${v}</div><div class="d">${d}</div>${extra}${spark}</article>`;
  $('#kpis').innerHTML = [
    card('wallet', `${esc(monthLong(state.month))}總額`, money(cur.total), delta || `上限 ${money(cur.totalLimit)}`,
      `<div class="bar ${lv}" title="${pct.toFixed(0)}% / 上限 ${money(cur.totalLimit)}"><span style="width:${pct}%"></span></div>`, sparkline(totals)),
    card('receipt', '本月筆數', `${cur.count}`, `${cur.unmatched.length} 個未對應頻道`, '', sparkline(counts)),
    card('avg', '期間月平均', money(avg), `${active.length} 個月有紀錄`),
    card('sum', `近 ${state.range} 個月合計`, money(sum), `${counts.reduce((a, b) => a + b, 0)} 筆`),
  ].join('');
}

// ───────────── 趨勢面積圖 ─────────────
function renderTrend(stats) {
  const series = lineSeries(stats, 3);
  const labels = stats.months.map((m, i) => (i === 0 || m.endsWith('-01') ? [monthShort(m), m.slice(0, 4)] : monthShort(m)));
  const ink = css('--ink-series');
  const accent = css('--accent');
  const limit = settings.totalLimit || 0;
  const datasets = series.map((s, i) => {
    const color = s.key === 'total' ? ink : colorOf(s.key);
    return {
      label: s.name,
      data: s.values,
      borderColor: color,
      backgroundColor: color,
      borderWidth: i === 0 ? 2.5 : 2,
      cubicInterpolationMode: 'monotone', // 平滑但不會超出資料點（一般 tension 會畫出不存在的高峰）
      pointRadius: 3,
      pointHoverRadius: 6,
      pointBackgroundColor: color,
      pointBorderColor: css('--surface-1'),
      pointBorderWidth: 2,
      order: i === 0 ? 0 : 1,
      fill: false,
    };
  });
  // 總額下方的漸層面積
  datasets[0].fill = 'origin';
  datasets[0].backgroundColor = (ctx) => {
    const { chart } = ctx;
    if (!chart.chartArea) return 'transparent';
    const g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
    g.addColorStop(0, `${accent}59`); // 35%
    g.addColorStop(1, `${accent}00`);
    return g;
  };
  if (limit)
    datasets.push({
      label: '總額上限', data: stats.months.map(() => limit), borderColor: css('--text-muted'), backgroundColor: css('--text-muted'),
      borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, fill: false, order: 2,
    });

  remake('trend', {
    type: 'line',
    data: { labels, datasets },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true, position: 'top', align: 'end',
          labels: {
            usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14, color: css('--text-secondary'),
            // 總額的 backgroundColor 是漸層函式，圖例改用線色畫圓點；上限用虛線
            generateLabels: (chart) => chart.data.datasets.map((d, i) => ({
              text: d.label, datasetIndex: i, hidden: !chart.isDatasetVisible(i), fontColor: css('--text-secondary'),
              fillStyle: d.borderColor, strokeStyle: d.borderColor, lineWidth: d.borderDash ? 1.5 : 0,
              lineDash: d.borderDash, pointStyle: d.borderDash ? 'line' : 'circle',
            })),
          },
        },
        tooltip: {
          callbacks: {
            title: (it) => monthLong(stats.months[it[0].dataIndex]),
            label: (it) => ` ${it.dataset.label}  ${money(it.parsed.y)}`,
            labelColor: (it) => ({ borderColor: it.dataset.borderColor, backgroundColor: it.dataset.borderColor, borderRadius: 4 }),
          },
          filter: (it) => it.dataset.label !== '總額上限',
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: css('--text-muted'), maxRotation: 0, autoSkipPadding: 12 } },
        y: { beginAtZero: true, border: { display: false }, grid: { color: css('--grid') }, ticks: { callback: (v) => short(v), maxTicksLimit: 6 } },
      },
    },
  });

  $('#trendTable').innerHTML = `<table><thead><tr><th>月份</th>${series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${stats.months
    .map((m, i) => `<tr><td>${esc(monthLong(m))}</td>${series.map((s) => `<td class="num">${money(s.values[i])}</td>`).join('')}</tr>`)
    .reverse().join('')}</tbody></table>`;
  $('#trendTable').hidden = !state.table;
}

// ───────────── 直播主預算進度 ─────────────
function renderMeters(sum) {
  $('#budgetSub').textContent = `${monthLong(state.month)}・依上限比例排序`;
  const list = [...sum.streamers].sort((a, b) => b.spent / (b.limit || 1) - a.spent / (a.limit || 1));
  if (!list.length) {
    $('#meters').innerHTML = '<li class="empty">尚未設定直播主，到「選項」新增</li>';
    return;
  }
  $('#meters').innerHTML =
    list.map((s) => {
      const pct = s.limit ? Math.min(100, (s.spent / s.limit) * 100) : 0;
      const badge = s.level === 'over' ? '<span class="status over">超過上限</span>' : s.level === 'warn' ? '<span class="status warn">接近上限</span>' : '';
      return `<li><div class="row"><span class="name"><i class="sw" style="background:${colorOf(`s:${s.id}`)}"></i><span>${esc(s.name)}</span>${badge}</span>
        <span class="amt num">${money(s.spent)} / ${short(s.limit)}</span></div>
        <div class="bar ${s.level}"><span style="width:${pct}%"></span></div></li>`;
    }).join('') +
    (sum.unmatched.length ? `<li class="more">另有 ${sum.unmatched.length} 個未對應頻道，共 ${money(sum.unmatched.reduce((a, u) => a + u.spent, 0))}（到選項頁設定別名）</li>` : '');
}

// ───────────── 各平台堆疊長條 ─────────────
function renderPlatBars(stats) {
  const per = stats.summaries.map((s) => Object.fromEntries(platformsOf(s).map((p) => [p.key.slice(2), p.spent])));
  const used = PLATFORMS.filter((p) => per.some((x) => x[p]));
  remake('platBars', {
    type: 'bar',
    data: {
      labels: stats.months.map(monthShort),
      datasets: used.map((p) => ({
        label: PLATFORM_LABEL[p],
        data: per.map((x) => x[p] || 0),
        backgroundColor: css(PLATFORM_VAR[p]),
        borderColor: css('--surface-1'),
        borderWidth: { top: 2 },
        borderRadius: 4,
        borderSkipped: 'bottom',
        maxBarThickness: 28,
      })),
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, padding: 14, color: css('--text-secondary') } },
        tooltip: {
          callbacks: {
            title: (it) => monthLong(stats.months[it[0].dataIndex]),
            label: (it) => ` ${it.dataset.label}  ${money(it.parsed.y)}`,
            footer: (it) => `合計 ${money(it.reduce((a, b) => a + b.parsed.y, 0))}`,
          },
          filter: (it) => it.parsed.y > 0,
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 8 } },
        y: { stacked: true, beginAtZero: true, border: { display: false }, grid: { color: css('--grid') }, ticks: { callback: (v) => short(v), maxTicksLimit: 5 } },
      },
    },
  });
}

// ───────────── 環圈圖 ─────────────
const centerText = {
  id: 'centerText',
  afterDraw(chart, _a, opts) {
    const { ctx, chartArea: a } = chart;
    if (!a || !opts?.value) return;
    const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = css('--text-muted');
    ctx.font = `11px ${Chart.defaults.font.family}`;
    if (opts.label) ctx.fillText(opts.label, x, y - 9);
    ctx.fillStyle = css('--text-primary');
    ctx.font = opts.label ? '600 15px ui-monospace, "SF Mono", Menlo, monospace' : `12px ${Chart.defaults.font.family}`;
    ctx.fillText(opts.value, x, opts.label ? y + 11 : y + 4);
    ctx.restore();
  },
};

function renderDonut(id, listEl, items, colorFn) {
  const total = items.reduce((a, b) => a + b.spent, 0);
  const colors = items.map(colorFn);
  const chart = remake(id, {
    type: 'doughnut',
    data: {
      labels: total ? items.map((i) => i.name) : [''],
      datasets: [{
        data: total ? items.map((i) => i.spent) : [1],
        backgroundColor: total ? colors : [css('--grid')],
        borderColor: css('--surface-1'),
        borderWidth: 2,
        hoverOffset: total ? 6 : 0,
        borderRadius: 4,
      }],
    },
    options: {
      maintainAspectRatio: false,
      cutout: '70%',
      layout: { padding: 6 },
      plugins: {
        tooltip: {
          enabled: !!total,
          callbacks: { label: (it) => ` ${money(it.parsed)}・${((it.parsed / total) * 100).toFixed(1)}%` },
        },
        centerText: { label: total ? '合計' : '', value: total ? money(total) : '這個月沒有紀錄' },
      },
    },
    plugins: [centerText],
  });
  listEl.innerHTML = items
    .map((it, i) => `<li data-i="${i}"><i class="sw" style="background:${colors[i]}"></i><span class="n" title="${esc(it.name)}">${esc(it.name)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span><span class="num">${money(it.spent)}</span><span class="p num">${((it.spent / total) * 100).toFixed(1)}%</span></li>`)
    .join('');
  // 滑過清單項目時凸顯對應的那一塊
  const activate = (i) => {
    const act = i == null ? [] : [{ datasetIndex: 0, index: i }];
    chart.setActiveElements(act);
    const a = chart.chartArea;
    chart.tooltip.setActiveElements(act, { x: (a.left + a.right) / 2, y: (a.top + a.bottom) / 2 });
    chart.update();
  };
  listEl.onmouseover = (e) => { const li = e.target.closest('li'); if (li) activate(Number(li.dataset.i)); };
  listEl.onmouseleave = () => activate(null);
}

function renderDonuts(sum) {
  // 前 5 名各一塊，其餘併成灰色「其他」。顏色：期間前 6 名用固定色槽（跟其他圖一致）；
  // 這個月出現、但期間排不進前 6 的對象，借用這個月沒被用到的色槽，避免大塊變成灰色。
  const other = css('--other');
  const all = recipientsOf(sum).sort((a, b) => b.spent - a.spent);
  const top = all.slice(0, all.length > 6 ? 5 : 6);
  const rest = all.slice(top.length);
  const recips = rest.length
    ? [...top, { key: 'other', name: `其他 ${rest.length} 個`, spent: rest.reduce((a, b) => a + b.spent, 0), other: true }]
    : top;
  const usedSlots = new Set(top.map((r) => colorOf(r.key)).filter((c) => c !== other));
  const spare = [1, 2, 3, 4, 5, 6].map((i) => css(`--series-${i}`)).filter((c) => !usedSlots.has(c));
  const local = new Map(top.filter((r) => colorOf(r.key) === other).map((r) => [r.key, spare.shift() || other]));
  $('#recipSub').textContent = `${monthLong(state.month)}・含未設別名的頻道`;
  renderDonut('recipDonut', $('#recipList'), recips, (it) => (it.other ? other : local.get(it.key) || colorOf(it.key)));

  const plats = platformsOf(sum);
  $('#platSub').textContent = monthLong(state.month);
  renderDonut('platDonut', $('#platList'), plats, (it) => css(PLATFORM_VAR[it.key.slice(2)] || '--other'));
}

// ───────────── 日曆熱力圖（D3）─────────────
function renderHeat() {
  const months = Math.min(state.range, 12);
  const end = d3.timeDay.floor(new Date());
  const start = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1);
  const startMon = d3.timeMonday.floor(start);
  const days = d3.timeDays(startMon, d3.timeDay.offset(end, 1));
  const data = dailyTotals(records, settings, localDate(start), localDate(end));
  const vals = [...data.values()].filter((v) => v > 0);
  const steps = ['--heat-1', '--heat-2', '--heat-3', '--heat-4'].map(css);
  const q = vals.length ? d3.scaleQuantile().domain(vals).range(steps) : () => steps[0];
  const empty = css('--heat-0');
  const color = (d) => (d < start ? 'transparent' : data.get(localDate(d)) ? q(data.get(localDate(d))) : empty);

  const cell = 13, gap = 3, left = 22, top = 18;
  const weeks = d3.timeMonday.count(startMon, end) + 1;
  const width = left + weeks * (cell + gap), height = top + 7 * (cell + gap);
  const svg = d3.create('svg').attr('width', width).attr('height', height).attr('role', 'img').attr('aria-label', '每日花費日曆熱力圖');
  const dow = (d) => (d.getDay() + 6) % 7; // 週一 = 0
  const col = (d) => d3.timeMonday.count(startMon, d);

  svg.append('g').selectAll('text').data(['一', '三', '五']).join('text')
    .attr('x', 0).attr('y', (_d, i) => top + i * 2 * (cell + gap) + cell - 2).text((d) => d);
  svg.append('g').selectAll('text').data(d3.timeMonths(start, d3.timeDay.offset(end, 1))).join('text')
    .attr('x', (d) => left + col(d) * (cell + gap)).attr('y', 11)
    .text((d) => (d.getMonth() === 0 || +d === +start ? `${d.getFullYear()}/${d.getMonth() + 1}月` : `${d.getMonth() + 1}月`));

  const tip = $('#tip');
  svg.append('g').selectAll('rect').data(days).join('rect')
    .attr('class', 'c')
    .attr('width', cell).attr('height', cell).attr('rx', 3)
    .attr('x', (d) => left + col(d) * (cell + gap))
    .attr('y', (d) => top + dow(d) * (cell + gap))
    .attr('fill', color)
    .on('mousemove', (ev, d) => {
      if (d < start) return;
      const v = data.get(localDate(d)) || 0;
      tip.innerHTML = `<b>${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）</b><span class="num">${v ? money(v) : '沒有花費'}</span>`;
      tip.hidden = false;
      tip.style.left = `${Math.min(ev.clientX + 12, innerWidth - tip.offsetWidth - 8)}px`;
      tip.style.top = `${ev.clientY + 14}px`;
    })
    .on('mouseleave', () => (tip.hidden = true));

  $('#heat').replaceChildren(svg.node());
  $('#heat').scrollLeft = width;
  $('#heatSub').textContent = `近 ${months} 個月・${vals.length} 天有花費${vals.length ? `・單日最高 ${money(Math.max(...vals))}` : ''}`;
  $('#heatLegend').innerHTML = `少 ${['--heat-0', '--heat-1', '--heat-2', '--heat-3', '--heat-4'].map((v) => `<i style="background:${css(v)}"></i>`).join('')} 多`;
}

// ───────────── 最近交易 ─────────────
function renderRecent() {
  const list = recentRecords(records, settings, state.month, 8);
  $('#recentSub').textContent = `${monthLong(state.month)}・最新 ${list.length} 筆`;
  $('#recent').innerHTML = list.length
    ? list.map((r) => {
        const d = new Date(r.time);
        const plat = `<span class="chip" style="color:${css(PLATFORM_VAR[r.platform] || '--other')}">${esc(PLATFORM_LABEL[r.platform] || r.platform)}</span>`;
        const kind = KIND_LABEL[r.kind] || r.kind || '';
        return `<li><span class="date num">${d.getMonth() + 1}/${d.getDate()}</span>
          <span class="who"><b title="${esc(r.who)}">${esc(r.who)}</b><small>${plat}${esc(kind)}${r.matched ? '' : '・未對應'}</small></span>
          <span class="amt num">${money(r.twd)}</span></li>`;
      }).join('')
    : '<li class="empty">這個月還沒有紀錄</li>';
}

// ───────────── 整頁 ─────────────
function render() {
  themeChartDefaults();
  const months = monthsBack(state.range);
  const stats = buildStats(records, settings, months);
  const slot = new Map(stats.order.slice(0, 6).map((o, i) => [o.key, css(`--series-${i + 1}`)]));
  colorOf = (key) => slot.get(key) || css('--other');

  // 月份選單：預設最近一個有紀錄的月份（月初本月常常還是空的）
  const sel = $('#month');
  sel.innerHTML = [...months].reverse().map((m) => `<option value="${m}">${esc(monthLong(m))}</option>`).join('');
  const latest = [...months].reverse().find((_m, i) => stats.summaries[months.length - 1 - i].total) || months.at(-1);
  if (!months.includes(state.month)) state.month = latest;
  sel.value = state.month;
  const sum = stats.summaries[months.indexOf(state.month)];

  $('#asof').textContent = `更新於 ${new Date().toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })}・共 ${records.length} 筆紀錄`;
  renderKpis(stats);
  renderTrend(stats);
  renderMeters(sum);
  renderPlatBars(stats);
  renderDonuts(sum);
  renderHeat();
  renderRecent();
}

// ───────────── 事件 ─────────────
$('#range').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.range = Number(b.dataset.v);
  for (const x of $('#range').children) x.setAttribute('aria-checked', String(x === b));
  render();
});
$('#month').addEventListener('change', (e) => { state.month = e.target.value; render(); });
$('#showTable').addEventListener('click', (e) => {
  state.table = !state.table;
  e.currentTarget.setAttribute('aria-pressed', String(state.table));
  $('#trendTable').hidden = !state.table;
});
matchMedia('(prefers-color-scheme: light)').addEventListener('change', render);
// 其他分頁（例如匯入過去紀錄）更新資料時跟著重畫；短時間大量更新只重畫一次
let pending;
chrome.storage.onChanged.addListener((ch) => {
  if (!ch.records && !ch.settings) return;
  clearTimeout(pending);
  pending = setTimeout(async () => {
    [records, settings] = await Promise.all([send('getRecords'), send('getSettings')]);
    render();
  }, 600);
});

[records, settings] = await Promise.all([send('getRecords'), send('getSettings')]);
render();
