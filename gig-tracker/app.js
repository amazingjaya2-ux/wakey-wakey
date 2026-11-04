'use strict';

/* ---------- storage ---------- */
const KEY = 'milemoney.v1';
const DEFAULT_SETTINGS = { bracket: 12, state: 0, rate: '', gas: 3.25, mpg: 28, wear: 0.10 };

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.shifts)) return { shifts: d.shifts, settings: { ...DEFAULT_SETTINGS, ...d.settings }, track: d.track || null };
  } catch (_) { /* fall through */ }
  return { shifts: [], settings: { ...DEFAULT_SETTINGS }, track: null };
}
let db = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { alert('Could not save on this device: ' + e.message); }
}

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const money = (n, d = 2) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const num = (n, d = 1) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const safeDiv = (a, b) => (b > 0 ? a / b : 0);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function startOfWeek(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; } // Monday
const gross = (s) => (+s.pay || 0) + (+s.tips || 0);

/* IRS business standard mileage rate. 2026 had a mid-year change (Announcement 2026-11). */
function irsRate(dateStr) {
  const o = parseFloat(db.settings.rate);
  if (!isNaN(o) && o > 0) return o;
  const y = +dateStr.slice(0, 4);
  if (y <= 2022) return 0.585;
  if (y === 2023) return 0.655;
  if (y === 2024) return 0.67;
  if (y === 2025) return 0.70;
  if (y === 2026) return dateStr < '2026-07-01' ? 0.725 : 0.76;
  return 0.76; // latest known; update when the IRS publishes a new rate
}

function costPerMile() {
  const s = db.settings;
  return safeDiv(+s.gas, +s.mpg) + (+s.wear || 0);
}
function taxRate() {
  const s = db.settings;
  // SE tax + income tax on (profit − ½ SE tax), roughly
  const se = 0.9235 * 0.153;
  return se + ((+s.bracket || 0) + (+s.state || 0)) / 100 * (1 - se / 2);
}

/* ---------- period filter ---------- */
function periodRange(p) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  switch (p) {
    case 'today': return [today, add(today, 1)];
    case 'week': { const s = startOfWeek(today); return [s, add(s, 7)]; }
    case 'lastweek': { const s = add(startOfWeek(today), -7); return [s, add(s, 7)]; }
    case 'month': return [new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 1)];
    case 'year': return [new Date(today.getFullYear(), 0, 1), new Date(today.getFullYear() + 1, 0, 1)];
    default: return [new Date(1970, 0, 1), new Date(3000, 0, 1)];
  }
}
function inRange(shifts, [a, b]) { const A = ymd(a), B = ymd(b); return shifts.filter((s) => s.date >= A && s.date < B); }

function summarize(shifts) {
  const t = { gross: 0, pay: 0, tips: 0, hours: 0, miles: 0, orders: 0, gas: 0, tolls: 0, deduction: 0 };
  for (const s of shifts) {
    t.gross += gross(s); t.pay += +s.pay || 0; t.tips += +s.tips || 0;
    t.hours += +s.hours || 0; t.miles += +s.miles || 0; t.orders += +s.orders || 0;
    t.gas += +s.gas || 0; t.tolls += +s.tolls || 0;
    t.deduction += (+s.miles || 0) * irsRate(s.date);
  }
  t.profit = t.gross - t.deduction - t.tolls;
  t.setAside = Math.max(0, t.profit) * taxRate();
  t.driveCost = t.miles * costPerMile();
  t.net = t.gross - t.driveCost - t.tolls - t.setAside;
  return t;
}

/* ---------- dashboard ---------- */
function renderDash() {
  const shifts = inRange(db.shifts, periodRange($('#period').value));
  const t = summarize(shifts);
  $('#k-gross').textContent = money(t.gross);
  $('#k-net').textContent = money(t.net);
  $('#k-hours').textContent = num(t.hours);
  $('#k-miles').textContent = num(t.miles, 0);
  $('#k-hr').textContent = money(safeDiv(t.gross, t.hours));
  $('#k-mi').textContent = money(safeDiv(t.gross, t.miles));
  $('#k-mph').textContent = num(safeDiv(t.miles, t.hours));
  $('#k-mpd').textContent = num(safeDiv(t.miles, t.gross), 2);
  $('#k-orders').textContent = t.orders;
  $('#k-per').textContent = money(safeDiv(t.gross, t.orders));
  $('#k-tips').textContent = money(t.tips, 0);
  $('#k-tipshare').textContent = Math.round(safeDiv(t.tips, t.gross) * 100) + '%';
  $('#k-cost').textContent = money(t.driveCost, 0);
  $('#k-realhr').textContent = money(safeDiv(t.gross - t.driveCost - t.tolls, t.hours));

  // by app
  const groups = {};
  for (const s of shifts) (groups[s.platform] ||= []).push(s);
  const rows = Object.entries(groups).map(([p, list]) => [p, summarize(list)]).sort((a, b) => b[1].gross - a[1].gross);
  $('#by-app').innerHTML = rows.length
    ? '<tr><th>App</th><th>Earned</th><th>$/hr</th><th>$/mi</th><th>Miles</th></tr>' +
      rows.map(([p, s]) => `<tr><td>${esc(p)}</td><td>${money(s.gross, 0)}</td><td>${money(safeDiv(s.gross, s.hours))}</td><td>${money(safeDiv(s.gross, s.miles))}</td><td>${num(s.miles, 0)}</td></tr>`).join('')
    : '<tr><td class="fine">No shifts in this period yet.</td></tr>';

  renderChart();
}

function renderChart() {
  const w0 = startOfWeek(new Date());
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const a = new Date(w0); a.setDate(a.getDate() - 7 * i);
    const b = new Date(a); b.setDate(b.getDate() + 7);
    weeks.push({ a, total: summarize(inRange(db.shifts, [a, b])).gross });
  }
  const W = 320, H = 150, top = 16, bottom = 20, bw = W / weeks.length;
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const bars = weeks.map((w, i) => {
    const h = (w.total / max) * (H - top - bottom);
    const x = i * bw + 4, y = H - bottom - h;
    const lbl = `${w.a.getMonth() + 1}/${w.a.getDate()}`;
    return `<rect class="bar${i === weeks.length - 1 ? ' cur' : ''}" x="${x}" y="${y}" width="${bw - 8}" height="${Math.max(h, 1)}" rx="3"><title>Week of ${lbl}: ${money(w.total)}</title></rect>` +
      (w.total ? `<text x="${x + (bw - 8) / 2}" y="${y - 4}" text-anchor="middle">$${Math.round(w.total)}</text>` : '') +
      `<text x="${x + (bw - 8) / 2}" y="${H - 6}" text-anchor="middle">${lbl}</text>`;
  }).join('');
  $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly earnings, last 8 weeks">${bars}</svg>`;
}

/* ---------- shift log ---------- */
function renderLog() {
  const list = [...db.shifts].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  if (!list.length) { $('#log-list').innerHTML = '<div class="empty">No shifts yet. Tap "Add shift", or start the GPS tracker on the dashboard.</div>'; return; }
  let html = '', last = '';
  for (const s of list) {
    if (s.date !== last) {
      last = s.date;
      html += `<div class="day-h">${parseYmd(s.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>`;
    }
    html += `<div class="shift" data-id="${esc(s.id)}">
      <div><div><b>${esc(s.platform)}</b></div>
      <div class="meta">${num(+s.hours)} h · ${num(+s.miles)} mi · ${+s.orders || 0} orders</div></div>
      <div><div class="amt">${money(gross(s))}</div><div class="meta">${money(safeDiv(gross(s), +s.hours))}/hr</div></div></div>`;
  }
  $('#log-list').innerHTML = html;
}

const dlg = $('#shift-dlg'), form = $('#shift-form');
function openShift(s) {
  form.reset();
  const d = s || { date: ymd(new Date()), platform: lastPlatform() };
  for (const [k, v] of Object.entries(d)) if (form.elements[k]) form.elements[k].value = v;
  $('#dlg-title').textContent = s && s.id ? 'Edit shift' : 'Add shift';
  $('#dlg-delete').hidden = !(s && s.id);
  dlg.showModal();
}
function lastPlatform() { return db.shifts.length ? db.shifts[db.shifts.length - 1].platform : 'DoorDash'; }

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const shift = {
    id: f.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: f.date, platform: f.platform,
    hours: +f.hours || 0, miles: +f.miles || 0, pay: +f.pay || 0, tips: +f.tips || 0,
    orders: +f.orders || 0, gas: +f.gas || 0, tolls: +f.tolls || 0, notes: f.notes || '',
  };
  const i = db.shifts.findIndex((s) => s.id === shift.id);
  if (i >= 0) db.shifts[i] = shift; else db.shifts.push(shift);
  save(); dlg.close(); renderAll();
});
$('#dlg-cancel').onclick = () => dlg.close();
$('#dlg-delete').onclick = () => {
  const id = form.elements.id.value;
  if (!confirm('Delete this shift?')) return;
  db.shifts = db.shifts.filter((s) => s.id !== id);
  save(); dlg.close(); renderAll();
};
$('#add-btn').onclick = () => openShift();
$('#log-list').addEventListener('click', (e) => {
  const el = e.target.closest('.shift'); if (!el) return;
  openShift(db.shifts.find((s) => s.id === el.dataset.id));
});

/* ---------- taxes ---------- */
function quarters(y) {
  return [
    { name: 'Q1 Jan–Mar', a: `${y}-01-01`, b: `${y}-04-01`, due: 'Apr 15', dueKey: `${y}-04-15` },
    { name: 'Q2 Apr–May', a: `${y}-04-01`, b: `${y}-06-01`, due: 'Jun 15', dueKey: `${y}-06-15` },
    { name: 'Q3 Jun–Aug', a: `${y}-06-01`, b: `${y}-09-01`, due: 'Sep 15', dueKey: `${y}-09-15` },
    { name: 'Q4 Sep–Dec', a: `${y}-09-01`, b: `${y + 1}-01-01`, due: `Jan 15 '${String(y + 1).slice(2)}`, dueKey: `${y + 1}-01-15` },
  ];
}
function renderTax() {
  const sel = $('#tax-year');
  const years = new Set([new Date().getFullYear(), ...db.shifts.map((s) => +s.date.slice(0, 4))]);
  const cur = +sel.value || new Date().getFullYear();
  sel.innerHTML = [...years].sort((a, b) => b - a).map((y) => `<option ${y === cur ? 'selected' : ''}>${y}</option>`).join('');
  const y = +sel.value;
  const shifts = db.shifts.filter((s) => s.date.startsWith(y + '-'));
  const t = summarize(shifts);
  const s = db.settings;
  const se = Math.max(0, t.profit) * 0.9235 * 0.153;
  const taxable = Math.max(0, t.profit - se / 2);
  const fed = taxable * (+s.bracket || 0) / 100;
  const st = taxable * (+s.state || 0) / 100;
  const rateNote = y === 2026 && !(parseFloat(s.rate) > 0) ? '72.5¢ Jan–Jun, 76¢ Jul–Dec' : `${(irsRate(y + '-12-31') * 100).toFixed(1)}¢/mi`;
  const rows = [
    ['Gross income (pay + tips)', money(t.gross)],
    ['Business miles', num(t.miles)],
    [`Mileage deduction (${rateNote})`, '−' + money(t.deduction)],
    ['Tolls + parking', '−' + money(t.tolls)],
    ['Net profit (Schedule C)', money(t.profit)],
    ['Self-employment tax (15.3%)', money(se)],
    [`Federal income tax (~${+s.bracket || 0}%)`, money(fed)],
    [`State income tax (~${+s.state || 0}%)`, money(st)],
  ];
  $('#tax-tbl').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('') +
    `<tr class="total"><td>Estimated total tax</td><td>${money(se + fed + st)}</td></tr>` +
    `<tr><td class="fine" colspan="2">That's ${Math.round(safeDiv(se + fed + st, t.gross) * 100)}% of gross. Gas you logged (${money(t.gas)}) is covered by the mileage rate. Your standard deduction and the QBI deduction can lower the income tax part.</td></tr>`;

  const today = ymd(new Date());
  $('#q-tbl').innerHTML = '<tr><th>Period</th><th>Earned</th><th>Set aside</th><th>Due</th></tr>' +
    quarters(y).map((q) => {
      const qs = summarize(shifts.filter((x) => x.date >= q.a && x.date < q.b));
      return `<tr class="${q.dueKey < today ? 'past' : ''}"><td>${q.name}</td><td>${money(qs.gross, 0)}</td><td>${money(qs.setAside, 0)}</td><td>${q.due}</td></tr>`;
    }).join('');
}
$('#tax-year').onchange = renderTax;

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#csv-btn').onclick = () => {
  const cols = ['date', 'platform', 'hours', 'miles', 'pay', 'tips', 'gross', 'orders', 'gas', 'tolls', 'irs_rate', 'mileage_deduction', 'notes'];
  const q = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  const lines = [...db.shifts].sort((a, b) => a.date.localeCompare(b.date)).map((s) => {
    const r = irsRate(s.date);
    return [s.date, s.platform, s.hours, s.miles, s.pay, s.tips, gross(s).toFixed(2), s.orders, s.gas, s.tolls, r, (s.miles * r).toFixed(2), s.notes].map(q).join(',');
  });
  download(`milemoney-${ymd(new Date())}.csv`, [cols.join(','), ...lines].join('\n'), 'text/csv');
};

/* ---------- settings ---------- */
const SET_FIELDS = ['bracket', 'state', 'rate', 'gas', 'mpg', 'wear'];
function renderSettings() { for (const k of SET_FIELDS) $('#s-' + k).value = db.settings[k]; }
$('#s-save').onclick = () => {
  for (const k of SET_FIELDS) db.settings[k] = $('#s-' + k).value;
  save(); renderAll(); alert('Settings saved.');
};
$('#backup-btn').onclick = () => download(`milemoney-backup-${ymd(new Date())}.json`, JSON.stringify(db, null, 2), 'application/json');
$('#restore').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.shifts)) throw new Error('No shifts found in file');
    if (!confirm(`Replace current data with ${d.shifts.length} shifts from backup?`)) return;
    db = { shifts: d.shifts, settings: { ...DEFAULT_SETTINGS, ...d.settings }, track: null };
    save(); renderAll();
  } catch (err) { alert('Could not restore: ' + err.message); }
  e.target.value = '';
};
$('#wipe-btn').onclick = () => {
  if (!confirm('Delete ALL shifts and settings? This cannot be undone.')) return;
  db = { shifts: [], settings: { ...DEFAULT_SETTINGS }, track: null };
  save(); renderAll();
};
$('#demo-btn').onclick = () => {
  if (db.shifts.length && !confirm('Add demo shifts on top of your data?')) return;
  const apps = [['DoorDash', 1.0], ['Uber Eats', 1.1], ['Instacart', 1.3], ['Grubhub', 0.9]];
  const today = new Date();
  for (let i = 0; i < 70; i++) {
    if (Math.random() < 0.35) continue;
    const d = new Date(today); d.setDate(d.getDate() - i);
    const n = 1 + (Math.random() < 0.4);
    for (let j = 0; j < n; j++) {
      const [p, m] = apps[Math.floor(Math.random() * apps.length)];
      const hours = +(2 + Math.random() * 4).toFixed(2);
      const orders = Math.round(hours * (1.6 + Math.random()));
      const miles = +(hours * (11 + Math.random() * 8)).toFixed(1);
      const pay = +(orders * (3.5 + Math.random() * 3) * m).toFixed(2);
      const tips = +(orders * (2 + Math.random() * 4)).toFixed(2);
      db.shifts.push({ id: 'demo' + i + j + Math.random().toString(36).slice(2, 6), date: ymd(d), platform: p, hours, miles, pay, tips, orders,
        gas: +(miles / 28 * 3.25).toFixed(2), tolls: Math.random() < 0.1 ? 6.5 : 0, notes: 'demo' });
    }
  }
  save(); renderAll();
};

/* ---------- GPS tracker ---------- */
let watchId = null, wakeLock = null;
function haversineMi(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function onPos(p) {
  const t = db.track; if (!t) return;
  const { latitude: lat, longitude: lon, accuracy } = p.coords;
  if (accuracy > 50) return; // ignore poor fixes
  const pt = { lat, lon, ts: p.timestamp };
  if (t.last) {
    const d = haversineMi(t.last, pt);
    const hrs = (pt.ts - t.last.ts) / 3.6e6;
    if (d < 0.01) return;                 // jitter while parked (~16 m)
    if (hrs > 0 && d / hrs > 100) return; // impossible jump
    t.miles += d;
  }
  t.last = pt; save(); renderTracker();
}
async function startWatch() {
  if (!('geolocation' in navigator)) { alert('GPS is not available on this device.'); return false; }
  watchId = navigator.geolocation.watchPosition(onPos, (err) => {
    $('#trk-status').textContent = 'GPS error: ' + err.message;
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (_) { /* optional */ }
  return true;
}
function renderTracker() {
  const t = db.track;
  $('#tracker').classList.toggle('on', !!t);
  $('#trk-btn').textContent = t ? 'End shift' : 'Start shift';
  if (!t) { $('#trk-status').textContent = 'Not tracking'; return; }
  const mins = Math.floor((Date.now() - t.start) / 60000);
  $('#trk-status').textContent = `${num(t.miles, 2)} mi · ${Math.floor(mins / 60)}h ${pad(mins % 60)}m`;
}
$('#trk-btn').onclick = async () => {
  if (!db.track) {
    db.track = { start: Date.now(), miles: 0, last: null };
    save();
    if (!(await startWatch())) { db.track = null; save(); }
    renderTracker();
    return;
  }
  const t = db.track;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  try { await wakeLock?.release(); } catch (_) { /* ignore */ }
  db.track = null; save(); renderTracker();
  openShift({ date: ymd(new Date(t.start)), platform: lastPlatform(), hours: ((Date.now() - t.start) / 3.6e6).toFixed(2), miles: t.miles.toFixed(1) });
};
setInterval(() => db.track && renderTracker(), 30000);
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && db.track && navigator.wakeLock) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) { /* ignore */ }
  }
});

/* ---------- tabs & boot ---------- */
document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.id === 'tab-' + b.dataset.tab));
  $('#period').style.visibility = b.dataset.tab === 'dash' ? 'visible' : 'hidden';
  window.scrollTo(0, 0);
});
$('#period').onchange = renderDash;

function renderAll() { renderDash(); renderLog(); renderTax(); renderSettings(); renderTracker(); }
renderAll();
if (db.track) startWatch(); // resume a shift after reload
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
