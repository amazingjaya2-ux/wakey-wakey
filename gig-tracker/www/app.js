'use strict';
/* UI: views, sheets, forms, GPS tracker. Data and math live in store.js, cloud sync in sync.js. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ui = { view: 'home', period: 'week', act: 'shifts', year: new Date().getFullYear() };
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- icons (24px stroke) ---------- */
const svg = (d, w = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  home: svg('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r=".6" fill="currentColor"/><circle cx="3.5" cy="12" r=".6" fill="currentColor"/><circle cx="3.5" cy="18" r=".6" fill="currentColor"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 2.2),
  tax: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9.5 14.5l5-5"/><circle cx="9.5" cy="9.5" r=".8" fill="currentColor"/><circle cx="14.5" cy="14.5" r=".8" fill="currentColor"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  play: svg('<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>', 1.5),
  stop: svg('<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>', 1.5),
  car: svg('<path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v3H3z"/><circle cx="7.5" cy="16" r="1.5"/><circle cx="16.5" cy="16" r="1.5"/>'),
  receipt: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  pin: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
};
$$('.dock-btn').forEach((b) => { b.innerHTML = ICON[{ home: 'home', activity: 'list', taxes: 'tax', account: 'user' }[b.dataset.view]]; });
$('#add-btn').innerHTML = ICON.plus;

/* ---------- small helpers ---------- */
function haptic() { if (Haptics) Haptics.impact({ style: 'LIGHT' }).catch(() => {}); }
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
function animateNumber(el, to, fmt = (v) => money(v)) {
  const from = el._v ?? 0; el._v = to;
  if (REDUCED || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 750;
  cancelAnimationFrame(el._raf);
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
function dayLabel(s) {
  const d = parseYmd(s), today = new Date();
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - d) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

/* segmented control with a sliding thumb */
function seg(el, options, value, onChange) {
  el.innerHTML = '<span class="seg-thumb"></span>' + options.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('');
  const move = () => {
    const on = $('button.on', el), th = $('.seg-thumb', el);
    if (!on || !on.offsetWidth) return;
    th.style.width = on.offsetWidth + 'px'; th.style.transform = `translateX(${on.offsetLeft}px)`;
  };
  el._move = move;
  el.onclick = (e) => {
    const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return;
    $$('button', el).forEach((x) => x.classList.toggle('on', x === b)); move(); haptic(); onChange(b.dataset.v);
  };
  requestAnimationFrame(move);
}
function moveIndicators() {
  $$('.seg').forEach((s) => s._move && s._move());
  const act = $('.dock-btn.active'), ind = $('#dock-ind');
  if (act) { ind.style.width = act.offsetWidth + 'px'; ind.style.transform = `translateX(${act.offsetLeft}px)`; }
}
addEventListener('resize', moveIndicators);

/* ---------- navigation ---------- */
function go(view) {
  if (view === ui.view) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  ui.view = view;
  $$('.dock-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  window.scrollTo(0, 0);
  render();
  haptic();
}
$$('.dock-btn').forEach((b) => b.onclick = () => go(b.dataset.view));

/* ---------- theme ---------- */
function applyTheme() {
  const t = db.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  if (SystemBars) {
    const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    SystemBars.setStyle({ style: dark ? 'DARK' : 'LIGHT' }).catch(() => {});
  }
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* ---------- HOME ---------- */
seg($('#period'), PERIODS, ui.period, (v) => { ui.period = v; renderHome(); });
function renderHome() {
  const range = periodRange(ui.period);
  const shifts = inRange(db.shifts, range), exps = inRange(db.expenses, range);
  const t = summarize(shifts, exps);
  $('#hero-label').textContent = { today: 'Earned today', week: 'Earned this week', month: 'Earned this month', year: 'Earned this year', all: 'Earned all time' }[ui.period];
  animateNumber($('#k-gross'), t.gross);
  $('#k-net').textContent = t.gross || t.spent ? `${money(t.net)} take-home after expenses & taxes` : 'Start a shift or tap + to log one';
  const mpgVal = recentMpg();
  const mpg = mpgVal ? num(mpgVal, 1) : `${num(+db.settings.mpg, 0)}<small> est.</small>`;
  const tiles = [
    ['Hours', num(t.hours)], ['Miles', num(t.miles, 0)], ['Orders', t.orders],
    ['$ / hour', money(safeDiv(t.gross, t.hours))], ['$ / mile', money(safeDiv(t.gross, t.miles))], ['$ / order', money(safeDiv(t.gross, t.orders))],
    ['Miles / hour', num(safeDiv(t.miles, t.hours))], ['Miles / order', num(safeDiv(t.miles, t.orders))], ['Miles / gallon', mpg],
    ['Tips', money(t.tips, 0)], ['Expenses', money(t.spent, 0)], ['Real $ / hour', money(safeDiv(t.gross - t.driveCost, t.hours))],
  ];
  $('#tiles').innerHTML = tiles.map(([k, v], i) => `<div class="tile" style="--i:${i}"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  // weekly chart
  const w0 = startOfWeek(new Date()), weeks = [];
  for (let i = 7; i >= 0; i--) {
    const a = new Date(w0); a.setDate(a.getDate() - 7 * i);
    const b = new Date(a); b.setDate(b.getDate() + 7);
    weeks.push({ a, v: inRange(db.shifts, [a, b]).reduce((s, x) => s + gross(x), 0) });
  }
  const W = 320, H = 150, top = 18, bottom = 20, bw = W / weeks.length, max = Math.max(1, ...weeks.map((w) => w.v));
  $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly earnings for the last 8 weeks">` + weeks.map((w, i) => {
    const h = Math.max(2, (w.v / max) * (H - top - bottom)), x = i * bw + 5, y = H - bottom - h, cx = x + (bw - 10) / 2;
    const lbl = `${w.a.getMonth() + 1}/${w.a.getDate()}`;
    return `<rect class="bar${i === 7 ? ' cur' : ''}" style="animation-delay:${i * 40}ms" x="${x}" y="${y}" width="${bw - 10}" height="${h}" rx="5"><title>Week of ${lbl}: ${money(w.v)}</title></rect>` +
      (w.v ? `<text class="val" x="${cx}" y="${y - 5}" text-anchor="middle">$${Math.round(w.v)}</text>` : '') +
      `<text x="${cx}" y="${H - 5}" text-anchor="middle">${lbl}</text>`;
  }).join('') + '</svg>';

  // by app
  const groups = {};
  for (const s of shifts) (groups[s.platform] ||= []).push(s);
  const rows = Object.entries(groups).map(([p, l]) => [p, summarize(l)]).sort((a, b) => safeDiv(b[1].gross, b[1].hours) - safeDiv(a[1].gross, a[1].hours));
  const best = Math.max(1, ...rows.map(([, s]) => safeDiv(s.gross, s.hours)));
  $('#by-app').innerHTML = rows.length ? rows.map(([p, s]) => `
    <div class="row"><span class="badge">${esc(p[0])}</span>
      <div class="grow"><div class="t">${esc(p)}</div><div class="m">${money(s.gross, 0)} · ${num(s.miles, 0)} mi · ${money(safeDiv(s.gross, s.miles))}/mi</div>
        <div class="bar-track"><span style="width:${safeDiv(s.gross, s.hours) / best * 100}%"></span></div></div>
      <div class="r"><div class="t">${money(safeDiv(s.gross, s.hours))}</div><div class="m">per hour</div></div></div>`).join('')
    : '<p class="fine" style="margin:0">Log shifts from different apps to see which one pays you best.</p>';
}

/* Miles per gallon from logged fill-ups over the last 90 days (a single week is too noisy).
   Falls back to the MPG in settings when there isn't enough data to be believable. */
function recentMpg() {
  const a = new Date(); a.setDate(a.getDate() - 90);
  const b = new Date(); b.setDate(b.getDate() + 1);
  const gal = inRange(db.expenses, [a, b]).reduce((x, e) => x + (e.cat === 'gas' ? +e.gallons || 0 : 0), 0);
  const mi = inRange(db.shifts, [a, b]).reduce((x, s) => x + (+s.miles || 0), 0);
  const v = safeDiv(mi, gal);
  return gal >= 20 && v >= 8 && v <= 80 ? v : 0;
}

/* ---------- ACTIVITY ---------- */
seg($('#act-seg'), [['shifts', 'Shifts'], ['expenses', 'Expenses']], ui.act, (v) => { ui.act = v; renderActivity(); });
function renderActivity() {
  const isShift = ui.act === 'shifts';
  const list = [...(isShift ? db.shifts : db.expenses)].sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!list.length) {
    $('#act-list').innerHTML = `<div class="empty"><b>${isShift ? 'No shifts yet' : 'No expenses yet'}</b>${isShift ? 'Start the tracker on Overview, or tap + to log a shift.' : 'Tap + to log gas, oil changes, tires, your phone bill and more.'}</div>`;
    return;
  }
  let html = '', last = '', i = 0;
  for (const r of list.slice(0, 400)) {
    if (r.date !== last) { last = r.date; html += `<div class="day-h">${dayLabel(r.date)}</div>`; }
    if (isShift) {
      html += `<button class="list-item press" style="--i:${i++}" data-kind="shift" data-id="${esc(r.id)}"><span class="badge">${esc((r.platform || '?')[0])}</span>
        <div class="grow"><div class="t">${esc(r.platform)}</div><div class="m">${num(+r.hours)} h · ${num(+r.miles)} mi · ${+r.orders || 0} orders</div></div>
        <div class="r"><div class="t">${money(gross(r))}</div><div class="m">${money(safeDiv(gross(r), +r.hours))}/hr</div></div></button>`;
    } else {
      const c = CAT[r.cat] || CAT.otherbiz;
      const tag = c.group === 'none' ? 'Personal' : c.group === 'vehicle' && db.settings.method !== 'actual' ? 'In mileage rate' : 'Deductible';
      html += `<button class="list-item press" style="--i:${i++}" data-kind="expense" data-id="${esc(r.id)}"><span class="badge">${c.group.startsWith('vehicle') ? ICON.car : ICON.receipt}</span>
        <div class="grow"><div class="t">${esc(c.name)}</div><div class="m">${tag}${r.note ? ' · ' + esc(r.note) : ''}</div></div>
        <div class="r"><div class="t">${money(+r.amount)}</div>${r.gallons ? `<div class="m">${num(+r.gallons, 2)} gal</div>` : ''}</div></button>`;
    }
  }
  $('#act-list').innerHTML = html;
}
$('#act-list').addEventListener('click', (e) => {
  const b = e.target.closest('.list-item'); if (!b) return;
  if (b.dataset.kind === 'shift') shiftForm(db.shifts.find((s) => s.id === b.dataset.id));
  else expenseForm(db.expenses.find((x) => x.id === b.dataset.id));
});

/* ---------- TAXES ---------- */
function renderTaxes() {
  const years = new Set([new Date().getFullYear(), ...db.shifts.map((s) => +s.date.slice(0, 4)), ...db.expenses.map((s) => +s.date.slice(0, 4))]);
  $('#tax-year').innerHTML = [...years].sort((a, b) => b - a).map((y) => `<option ${y === ui.year ? 'selected' : ''}>${y}</option>`).join('');
  const r = taxYear(ui.year), d = r.d, s = db.settings;
  const other = r.method === 'standard' ? 'actual' : 'standard';
  const diff = d[other] - d[r.method];
  const rateNote = ui.year === 2026 && !(parseFloat(s.rate) > 0) ? '72.5¢ / 76¢' : `${(irsRate(ui.year + '-12-31') * 100).toFixed(1)}¢`;
  const totalMiles = +s.totalMiles[ui.year] || '';

  const cats = Object.entries(d.byCat).map(([id, v]) => [CAT[id] || CAT.otherbiz, v]).sort((a, b) => b[1].amount - a[1].amount);
  $('#tax-body').innerHTML = `
    <div class="seg glass" id="method-seg"></div>
    ${diff > 1 && r.t.miles > 0 ? `<div class="callout">The <b>${other === 'actual' ? 'actual expense' : 'standard mileage'}</b> method would deduct <b>${money(diff, 0)} more</b> this year. Tap it above to compare.</div>` : ''}
    <div class="card">
      <div class="card-h"><span>${r.y} estimate</span></div>
      <table class="kv">
        <tr><td>Earnings</td><td>${money(r.t.gross)}</td></tr>
        <tr class="sub"><td>Business miles</td><td>${num(r.t.miles, 0)}</td></tr>
        ${r.method === 'standard'
          ? `<tr><td>Mileage deduction (${rateNote})</td><td>−${money(d.mileage)}</td></tr>`
          : `<tr><td>Car costs × ${Math.round(d.vehiclePct * 100)}% business</td><td>−${money(d.vehicleCosts * d.vehiclePct)}</td></tr>`}
        ${d.always ? `<tr><td>Tolls & parking</td><td>−${money(d.always)}</td></tr>` : ''}
        ${d.loanInterest ? `<tr><td>Car loan interest × ${Math.round(d.vehiclePct * 100)}%</td><td>−${money(d.loanInterest * d.vehiclePct)}</td></tr>` : ''}
        ${d.other ? `<tr><td>Phone, supplies & other</td><td>−${money(d.other)}</td></tr>` : ''}
        <tr><td><b>Taxable profit</b></td><td>${money(r.profit)}</td></tr>
        <tr class="sub"><td>Self-employment tax</td><td>${money(r.se)}</td></tr>
        <tr class="sub"><td>Federal income tax (~${+s.bracket || 0}%)</td><td>${money(r.fed)}</td></tr>
        <tr class="sub"><td>State income tax (~${+s.state || 0}%)</td><td>${money(r.st)}</td></tr>
        <tr class="total"><td>Estimated tax</td><td>${money(r.total)}</td></tr>
      </table>
    </div>

    <div class="card">
      <div class="card-h"><span>Business use of your car</span></div>
      <label class="field"><span>All miles you drove in ${r.y}, including personal</span>
        <input type="number" inputmode="decimal" id="total-miles" value="${totalMiles}" placeholder="e.g. 18000"></label>
      <p class="fine" style="margin-top:-4px">${totalMiles ? `${Math.round(d.vehiclePct * 100)}% of your driving is for work.` : 'Needed for the actual expense method and car loan interest. Use your odometer: the reading now, minus the reading on Jan 1.'}</p>
    </div>

    <div class="card">
      <div class="card-h"><span>Expenses by category</span><button class="link press" id="add-exp-tax">+ Add</button></div>
      ${cats.length ? cats.map(([c, v]) => `<div class="row"><div class="grow"><div class="t">${esc(c.name)}</div>
        <div class="m">${v.count} logged · ${c.group === 'none' ? 'not deductible' : c.group === 'vehicle' ? (r.method === 'actual' ? `deducted × ${Math.round(d.vehiclePct * 100)}%` : 'covered by mileage rate') : c.group === 'other' ? 'business share deducted' : 'deductible'}</div></div>
        <div class="r"><div class="t">${money(v.amount)}</div></div></div>`).join('')
        : '<p class="fine" style="margin:0">Log oil changes, tires, insurance, your phone bill, delivery bags and more to lower your taxes.</p>'}
    </div>

    <div class="card">
      <div class="card-h"><span>Quarterly payments</span></div>
      ${quarters(r.y).map((q) => {
        const qs = summarize(r.shifts.filter((x) => x.date >= q.a && x.date < q.b), r.expenses.filter((x) => x.date >= q.a && x.date < q.b));
        const past = q.dueKey < ymd(new Date());
        return `<div class="row" style="${past ? 'opacity:.5' : ''}"><div class="grow"><div class="t">${q.name}</div><div class="m">Earned ${money(qs.gross, 0)} · due ${q.due}</div></div>
          <div class="r"><div class="t">${money(qs.setAside, 0)}</div><div class="m">set aside</div></div></div>`;
      }).join('')}
    </div>

    <button class="btn solid press" id="csv-btn">Export for my tax preparer</button>
    <p class="fine">Estimates only, not tax advice. Standard mileage covers gas, oil, tires, repairs, insurance and depreciation, so those are only deducted separately under the actual expense method. Actual expenses here leave out depreciation. If you use the actual method the first year you use a car for work, you can't switch that car to standard mileage later. Ask a tax pro before you file.</p>`;

  seg($('#method-seg'), [['standard', 'Standard mileage'], ['actual', 'Actual expenses']], r.method, (v) => { updateSettings({ method: v }); renderTaxes(); });
  $('#total-miles').onchange = (e) => {
    const v = Math.max(0, +e.target.value || 0);
    const tm = { ...db.settings.totalMiles };
    if (v) tm[ui.year] = v; else delete tm[ui.year];
    updateSettings({ totalMiles: tm });
    renderTaxes(); toast('Saved');
  };
  $('#add-exp-tax').onclick = () => expenseForm();
  $('#csv-btn').onclick = exportCsv;
}
$('#tax-year').onchange = (e) => { ui.year = +e.target.value; renderTaxes(); };

function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
async function exportCsv() {
  const lines = [['type', 'date', 'app_or_category', 'hours', 'miles', 'pay', 'tips', 'gross_or_amount', 'orders', 'gallons', 'business_pct', 'irs_rate', 'mileage_deduction', 'notes']];
  for (const s of [...db.shifts].sort((a, b) => a.date.localeCompare(b.date))) {
    const r = irsRate(s.date);
    lines.push(['shift', s.date, s.platform, s.hours, s.miles, s.pay, s.tips, gross(s).toFixed(2), s.orders, '', '', r, ((+s.miles || 0) * r).toFixed(2), s.notes]);
  }
  for (const e of [...db.expenses].sort((a, b) => a.date.localeCompare(b.date))) {
    const c = CAT[e.cat] || CAT.otherbiz;
    lines.push(['expense', e.date, c.name, '', '', '', '', (+e.amount).toFixed(2), '', e.gallons || '', c.group === 'other' ? (e.pct ?? c.pct) : '', '', '', e.note]);
  }
  await download(`milemoney-${ymd(new Date())}.csv`, lines.map((l) => l.map(csvCell).join(',')).join('\n'), 'text/csv');
}
async function download(name, text, type) {
  if (NATIVE) {
    try {
      const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
      await Share.share({ title: name, files: [uri] });
    } catch (e) { if (!/cancel/i.test(e.message || '')) toast('Could not export: ' + e.message); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- ACCOUNT & SETTINGS ---------- */
let authMode = 'signin';
function renderAccount() {
  const box = $('#account-body');
  if (!Cloud.enabled) {
    box.innerHTML = `<div class="card"><div class="card-h"><span>Cloud backup</span></div>
      <p class="fine" style="margin:0">Accounts and sync aren't switched on in this build. Your data is saved on this phone only, so use Back up below now and then.</p></div>`;
  } else if (!Cloud.user) {
    const up = authMode === 'signup';
    box.innerHTML = `<div class="card">
      <div class="card-h"><span>${up ? 'Create your account' : 'Sign in'}</span></div>
      <p class="fine" style="margin:-4px 2px 14px">Back up your shifts and expenses, and use MileMoney on more than one phone.</p>
      <form id="auth-form">
        <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
        <label class="field"><span>Password</span><input type="password" name="password" minlength="8" autocomplete="${up ? 'new-password' : 'current-password'}" required></label>
        <button class="btn solid press" type="submit">${up ? 'Create account' : 'Sign in'}</button>
      </form>
      <div class="btn-row" style="justify-content:space-between">
        <button class="linkbtn" id="auth-toggle">${up ? 'I already have an account' : 'Create an account'}</button>
        ${up ? '' : '<button class="linkbtn" id="auth-forgot">Forgot password?</button>'}
      </div></div>`;
    $('#auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target)), btn = $('button[type=submit]', e.target);
      btn.disabled = true;
      try {
        if (up) {
          const r = await Cloud.signUp(f.email.trim(), f.password);
          toast(r.needsConfirm ? 'Check your email to confirm, then sign in' : 'Account created');
          if (r.needsConfirm) { authMode = 'signin'; renderAccount(); }
        } else { await Cloud.signIn(f.email.trim(), f.password); toast('Signed in, syncing…'); }
      } catch (err) { toast(err.message); btn.disabled = false; }
    };
    $('#auth-toggle').onclick = () => { authMode = up ? 'signin' : 'signup'; renderAccount(); };
    const fg = $('#auth-forgot');
    if (fg) fg.onclick = async () => {
      const email = $('#auth-form [name=email]').value.trim();
      if (!email) { toast('Type your email first'); return; }
      try { await Cloud.resetPassword(email); toast('Password reset email sent'); } catch (err) { toast(err.message); }
    };
  } else {
    const st = Cloud.status;
    const line = st.state === 'syncing' ? 'Syncing…' : st.state === 'error' ? 'Sync problem: ' + esc(st.error) : st.state === 'offline' ? 'Offline. Changes will sync when you reconnect.'
      : st.at ? `Synced ${timeAgo(st.at)}` : 'Not synced yet';
    box.innerHTML = `<div class="card">
      <div class="row" style="padding-top:0"><span class="badge">${esc(Cloud.user.email[0].toUpperCase())}</span>
        <div class="grow"><div class="t">${esc(Cloud.user.email)}</div><div class="m">${line}</div></div></div>
      <button class="btn press" id="sync-now">Sync now</button>
      <button class="btn ghost press" id="sign-out">Sign out</button>
    </div>`;
    $('#sync-now').onclick = () => Cloud.syncNow();
    $('#sign-out').onclick = async () => {
      if (!confirm('Sign out? Your data stays in your account and is removed from this phone.')) return;
      await Cloud.signOut(); render(); toast('Signed out');
    };
  }
}
function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  return Math.round(s / 3600) + ' h ago';
}
function renderSettings() {
  const s = db.settings;
  const f = (id, label, val, step = 'any') => `<label class="field"><span>${label}</span><input type="number" inputmode="decimal" step="${step}" data-set="${id}" value="${esc(val)}"></label>`;
  $('#settings-body').innerHTML = `
    <div class="card"><div class="card-h"><span>Appearance</span></div><div class="seg glass" id="theme-seg" style="margin:0"></div></div>
    <div class="card"><div class="card-h"><span>Taxes</span></div>
      <div class="grid2">${f('bracket', 'Federal bracket %', s.bracket)}${f('state', 'State tax %', s.state)}</div>
      ${f('rate', 'IRS rate override ($/mi)', s.rate)}
      <p class="fine" style="margin-top:-4px">Leave the rate blank to use the official IRS rate for each date.</p></div>
    <div class="card"><div class="card-h"><span>Your car</span></div>
      <div class="grid2">${f('gas', 'Gas $/gallon', s.gas)}${f('mpg', 'Miles per gallon', s.mpg)}</div>
      ${f('wear', 'Wear & maintenance $/mile', s.wear)}
      <p class="fine" style="margin-top:-4px">Used for "Real $ / hour" and for MPG until you log gallons with your gas.</p></div>
    <div class="card"><div class="card-h"><span>Data</span></div>
      <button class="btn press" id="backup-btn">Back up to a file</button>
      <label class="btn press">Restore from a file<input type="file" id="restore" accept="application/json" hidden></label>
      <button class="btn press" id="demo-btn">Load demo data</button>
      <button class="btn danger press" id="wipe-btn">Delete all my data</button>
      ${Cloud.enabled && Cloud.user ? '<button class="btn danger press" id="delete-acct">Delete my account</button>' : ''}
    </div>
    <p class="fine" style="text-align:center">MileMoney 2.0</p>`;
  seg($('#theme-seg'), [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], s.theme, (v) => { updateSettings({ theme: v }); applyTheme(); });
  $$('[data-set]').forEach((inp) => inp.onchange = () => { updateSettings({ [inp.dataset.set]: inp.value }); toast('Saved'); });
  $('#backup-btn').onclick = () => download(`milemoney-backup-${ymd(new Date())}.json`,
    JSON.stringify({ v: 2, shifts: db.shifts, expenses: db.expenses, settings: db.settings }, null, 2), 'application/json');
  $('#restore').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!Array.isArray(d.shifts)) throw new Error('This file has no MileMoney data');
      if (!confirm(`Replace your data with ${d.shifts.length} shifts and ${(d.expenses || []).length} expenses from this backup?`)) return;
      const keep = db.sync;
      const fresh = normalize(d);
      for (const x of db.shifts) if (!fresh.shifts.some((y) => y.id === x.id)) keep.deleted[x.id] = 'shift';
      for (const x of db.expenses) if (!fresh.expenses.some((y) => y.id === x.id)) keep.deleted[x.id] = 'expense';
      db = { ...fresh, sync: keep };
      markAllDirty(); save(); Cloud.schedule(); applyTheme(); render(); toast('Backup restored');
    } catch (err) { toast('Could not restore: ' + err.message); }
    e.target.value = '';
  };
  $('#wipe-btn').onclick = () => {
    if (!confirm(`Delete every shift and expense${Cloud.user ? ' on this phone and in your account' : ''}? This can't be undone.`)) return;
    for (const x of db.shifts) db.sync.deleted[x.id] = 'shift';
    for (const x of db.expenses) db.sync.deleted[x.id] = 'expense';
    db.shifts = []; db.expenses = []; db.sync.dirty = {}; db.track = null;
    save(); Cloud.schedule(); render(); toast('All data deleted');
  };
  $('#demo-btn').onclick = loadDemo;
  const del = $('#delete-acct');
  if (del) del.onclick = async () => {
    if (!confirm('Permanently delete your account and everything in it? This cannot be undone.')) return;
    try { await Cloud.deleteAccount(); render(); toast('Account deleted'); } catch (err) { toast(err.message); }
  };
}

function loadDemo() {
  if ((db.shifts.length || db.expenses.length) && !confirm('Add demo shifts and expenses on top of your data?')) return;
  const apps = [['DoorDash', 1.0], ['Uber Eats', 1.1], ['Instacart', 1.3], ['Grubhub', 0.9]];
  const today = new Date();
  const day = (i) => { const d = new Date(today); d.setDate(d.getDate() - i); return ymd(d); };
  const add = (kind, r) => { r.id = 'demo-' + uid(); r.updatedAt = Date.now(); (kind === 'shift' ? db.shifts : db.expenses).push(r); db.sync.dirty[r.id] = kind; };
  for (let i = 0; i < 70; i++) {
    if (Math.random() < 0.35) continue;
    for (let j = 0, n = 1 + (Math.random() < 0.4); j < n; j++) {
      const [p, m] = apps[Math.floor(Math.random() * apps.length)];
      const hours = +(2 + Math.random() * 4).toFixed(2), orders = Math.round(hours * (1.6 + Math.random()));
      const miles = +(hours * (11 + Math.random() * 8)).toFixed(1);
      add('shift', { date: day(i), platform: p, hours, miles, orders, pay: +(orders * (3.5 + Math.random() * 3) * m).toFixed(2), tips: +(orders * (2 + Math.random() * 4)).toFixed(2), notes: 'demo' });
    }
    if (i % 4 === 0) { const g = +(9 + Math.random() * 4).toFixed(2); add('expense', { date: day(i), cat: 'gas', amount: +(g * 3.29).toFixed(2), gallons: g, note: 'demo' }); }
    if (i % 9 === 0) add('expense', { date: day(i), cat: 'meals', amount: +(8 + Math.random() * 10).toFixed(2), note: 'demo' });
  }
  add('expense', { date: day(20), cat: 'oil', amount: 64.99, note: 'demo' });
  add('expense', { date: day(45), cat: 'tires', amount: 412.0, note: 'demo' });
  add('expense', { date: day(10), cat: 'phone', amount: 75, pct: 60, note: 'demo' });
  add('expense', { date: day(40), cat: 'phone', amount: 75, pct: 60, note: 'demo' });
  add('expense', { date: day(30), cat: 'bags', amount: 34.99, note: 'demo' });
  add('expense', { date: day(5), cat: 'tolls', amount: 6.5, note: 'demo' });
  add('expense', { date: day(60), cat: 'insurance', amount: 690, note: 'demo' });
  save(); Cloud.schedule(); render(); toast('Demo data added');
}

/* ---------- sheets ---------- */
function openSheet(html, mount) {
  const w = $('#sheet');
  $('#sheet-body').innerHTML = html;
  $('.sheet').scrollTop = 0;
  w.hidden = false; w.classList.remove('closing');
  requestAnimationFrame(() => requestAnimationFrame(() => w.classList.add('open')));
  if (mount) mount($('#sheet-body'));
  haptic();
}
function closeSheet() {
  const w = $('#sheet'); if (w.hidden) return;
  w.classList.add('closing'); w.classList.remove('open');
  $('#add-btn').classList.remove('open');
  setTimeout(() => { if (!w.classList.contains('open')) { w.hidden = true; w.classList.remove('closing'); } }, REDUCED ? 0 : 320);
}
$('#sheet').addEventListener('click', (e) => { if (e.target.hasAttribute('data-close')) closeSheet(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
// drag the sheet down to dismiss
(() => {
  const sheet = $('.sheet'); let y0 = null, dy = 0;
  sheet.addEventListener('touchstart', (e) => { if (sheet.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (y0 === null) return; dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (y0 === null) return; sheet.style.transition = ''; sheet.style.transform = '';
    if (dy > 110) closeSheet(); y0 = null;
  });
})();

$('#add-btn').onclick = () => {
  $('#add-btn').classList.add('open');
  const on = !!db.track;
  openSheet(`<h2>Add</h2>
    <button class="menu-btn press" data-a="track"><span class="badge">${on ? ICON.stop : ICON.play}</span><div><b>${on ? 'End shift' : 'Start shift'}</b><span>${on ? 'Stop GPS and save the shift' : 'Count miles with GPS while you drive'}</span></div></button>
    <button class="menu-btn press" data-a="shift"><span class="badge">${ICON.pin}</span><div><b>Log a shift</b><span>Earnings, hours and miles</span></div></button>
    <button class="menu-btn press" data-a="expense"><span class="badge">${ICON.receipt}</span><div><b>Add an expense</b><span>Gas, oil change, tires, phone bill…</span></div></button>`, (b) => {
    b.onclick = (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      closeSheet();
      setTimeout(() => (a.dataset.a === 'track' ? toggleTracker() : a.dataset.a === 'shift' ? shiftForm() : expenseForm()), REDUCED ? 0 : 280);
    };
  });
};

function chips(name, options, value) {
  return `<div class="chips" data-chips="${name}">${options.map(([v, l]) => `<button type="button" class="chip press${v === value ? ' on' : ''}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
}
function bindChips(root, name, onPick) {
  const box = $(`[data-chips="${name}"]`, root);
  box.onclick = (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    $$('.chip', box).forEach((x) => x.classList.toggle('on', x === c)); haptic(); onPick(c.dataset.v);
  };
}
const field = (name, label, val = '', type = 'number', extra = '') =>
  `<label class="field"><span>${label}</span><input name="${name}" type="${type}" ${type === 'number' ? 'inputmode="decimal" step="any" min="0"' : ''} value="${esc(val)}" ${extra}></label>`;
const lastPlatform = () => (db.shifts.length ? [...db.shifts].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].platform : 'DoorDash');

function shiftForm(s) {
  const r = s || { date: ymd(new Date()), platform: lastPlatform() };
  let platform = r.platform;
  openSheet(`<h2>${s && s.id ? 'Edit shift' : 'Log a shift'}</h2>
    <form id="shift-form">
      ${chips('platform', PLATFORMS.map((p) => [p, p]), platform)}
      ${field('date', 'Date', r.date, 'date', 'required')}
      <div class="grid2">${field('pay', 'Pay from app ($)', r.pay ?? '', 'number', 'required')}${field('tips', 'Tips ($)', r.tips ?? '')}</div>
      <div class="grid2">${field('hours', 'Hours', r.hours ?? '', 'number', 'required')}${field('miles', 'Miles', r.miles ?? '', 'number', 'required')}</div>
      <div class="grid2">${field('orders', 'Orders / trips', r.orders ?? '')}${field('notes', 'Note', r.notes ?? '', 'text', 'maxlength="120"')}</div>
      <button class="btn solid press" type="submit">Save shift</button>
      ${s && s.id ? '<button class="btn danger press" type="button" id="del">Delete shift</button>' : ''}
    </form>`, (b) => {
    bindChips(b, 'platform', (v) => { platform = v; });
    $('#shift-form', b).onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      putRecord('shift', { id: s && s.id, date: f.date, platform, hours: +f.hours || 0, miles: +f.miles || 0, pay: +f.pay || 0,
        tips: +f.tips || 0, orders: Math.round(+f.orders || 0), notes: f.notes || '', ...(s && s.gas ? { gas: s.gas } : {}), ...(s && s.tolls ? { tolls: s.tolls } : {}) });
      closeSheet(); render(); toast('Shift saved');
    };
    const del = $('#del', b);
    if (del) del.onclick = () => { if (confirm('Delete this shift?')) { removeRecord('shift', s.id); closeSheet(); render(); toast('Shift deleted'); } };
  });
}

function expenseForm(x) {
  const r = x || { date: ymd(new Date()), cat: 'gas' };
  let cat = r.cat;
  openSheet(`<h2>${x ? 'Edit expense' : 'Add an expense'}</h2>
    <form id="exp-form">
      ${chips('cat', CATS.map((c) => [c.id, c.name]), cat)}
      <button type="button" class="linkbtn" id="more-cats" style="margin:-8px 0 8px">More categories</button>
      <p class="hint" id="rule"></p>
      <div class="grid2">${field('amount', 'Amount ($)', r.amount ?? '', 'number', 'required')}${field('date', 'Date', r.date, 'date', 'required')}</div>
      <div id="gal-wrap">${field('gallons', 'Gallons (for miles per gallon)', r.gallons ?? '')}</div>
      <div id="pct-wrap">${field('pct', 'Business use %', r.pct ?? '', 'number', 'max="100"')}</div>
      ${field('note', 'Note', r.note ?? '', 'text', 'maxlength="120" placeholder="e.g. Jiffy Lube, 5W-30"')}
      <button class="btn solid press" type="submit">Save expense</button>
      ${x ? '<button class="btn danger press" type="button" id="del">Delete expense</button>' : ''}
    </form>`, (b) => {
    const update = () => {
      const c = CAT[cat];
      $('#rule', b).textContent = deductRule(cat, db.settings.method);
      $('#gal-wrap', b).hidden = cat !== 'gas';
      $('#pct-wrap', b).hidden = c.group !== 'other';
      if (c.group === 'other' && (!x || x.cat !== cat)) $('[name=pct]', b).value = c.pct ?? 100;
    };
    bindChips(b, 'cat', (v) => { cat = v; update(); });
    // keep the sheet short: everyday categories first, the rest behind "More categories"
    const COMMON = ['gas', 'oil', 'tires', 'repairs', 'phone', 'tolls', 'parking', 'meals'];
    const more = $('#more-cats', b);
    const showAll = (all) => {
      $$('[data-chips=cat] .chip', b).forEach((c) => { c.hidden = !all && !COMMON.includes(c.dataset.v) && c.dataset.v !== cat; });
      more.hidden = all;
    };
    more.onclick = () => showAll(true);
    showAll(false);
    update();
    $('#exp-form', b).onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const c = CAT[cat];
      putRecord('expense', { id: x && x.id, date: f.date, cat, amount: +f.amount || 0, note: f.note || '',
        ...(cat === 'gas' && +f.gallons ? { gallons: +f.gallons } : {}),
        ...(c.group === 'other' ? { pct: Math.min(100, Math.max(0, +f.pct || 0)) } : {}) });
      closeSheet(); render(); toast('Expense saved');
    };
    const del = $('#del', b);
    if (del) del.onclick = () => { if (confirm('Delete this expense?')) { removeRecord('expense', x.id); closeSheet(); render(); toast('Expense deleted'); } };
  });
}

/* ---------- GPS tracker ---------- */
let watchId = null, nativeWatcher = null, wakeLock = null;
function haversineMi(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function onPos({ lat, lon, accuracy, ts }) {
  const t = db.track; if (!t) return;
  if (accuracy > 50) return; // ignore poor fixes
  const pt = { lat, lon, ts };
  if (t.last) {
    const d = haversineMi(t.last, pt), hrs = (pt.ts - t.last.ts) / 3.6e6;
    if (d < 0.01) return;                 // jitter while parked (~16 m)
    if (hrs > 0 && d / hrs > 100) return; // impossible jump
    t.miles += d;
  }
  t.last = pt; save(); renderTracker();
}
async function startNativeWatch() {
  if (Cap.getPlatform() === 'android' && LocalNotifications) {
    try { await LocalNotifications.requestPermissions(); } catch (_) { /* optional */ }
  }
  nativeWatcher = await BgGeo.addWatcher({
    backgroundTitle: 'MileMoney is tracking your miles',
    backgroundMessage: 'Tap End shift in the app when you are done driving.',
    requestPermissions: true, stale: false, distanceFilter: 15,
  }, (loc, err) => {
    if (err) {
      if (err.code === 'NOT_AUTHORIZED' && confirm('MileMoney needs location access to count your miles. Open settings now?')) BgGeo.openSettings();
      else $('#trk-status').textContent = 'GPS error: ' + err.message;
      return;
    }
    if (loc) onPos({ lat: loc.latitude, lon: loc.longitude, accuracy: loc.accuracy, ts: loc.time || Date.now() });
  });
  return true;
}
async function startWatch() {
  if (BgGeo) {
    try { return await startNativeWatch(); } catch (e) { toast('Could not start GPS: ' + e.message); return false; }
  }
  if (!('geolocation' in navigator)) { toast('GPS is not available on this device'); return false; }
  watchId = navigator.geolocation.watchPosition((p) => onPos({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, ts: p.timestamp }),
    (err) => { $('#trk-status').textContent = 'GPS error: ' + err.message; }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (_) { /* optional */ }
  return true;
}
async function stopWatch() {
  if (nativeWatcher !== null) { try { await BgGeo.removeWatcher({ id: nativeWatcher }); } catch (_) { /* ignore */ } }
  nativeWatcher = null;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  try { await wakeLock?.release(); } catch (_) { /* ignore */ }
  wakeLock = null;
}
function renderTracker() {
  const t = db.track;
  $('#tracker').classList.toggle('on', !!t);
  $('#trk-icon').innerHTML = t ? ICON.stop : ICON.play;
  $('#trk-title').textContent = t ? 'On shift' : 'Start shift';
  if (!t) { $('#trk-status').textContent = 'Counts your miles with GPS'; return; }
  const mins = Math.floor((Date.now() - t.start) / 60000);
  $('#trk-status').textContent = `${num(t.miles, 2)} mi · ${Math.floor(mins / 60)}h ${pad(mins % 60)}m · tap to end`;
}
async function toggleTracker() {
  haptic();
  if (!db.track) {
    db.track = { start: Date.now(), miles: 0, last: null }; save(); renderTracker();
    if (!(await startWatch())) { db.track = null; save(); }
    renderTracker();
    return;
  }
  const t = db.track;
  await stopWatch();
  db.track = null; save(); renderTracker();
  shiftForm({ date: ymd(new Date(t.start)), hours: ((Date.now() - t.start) / 3.6e6).toFixed(2), miles: t.miles.toFixed(1), platform: lastPlatform() });
}
$('#tracker').onclick = toggleTracker;
$('#tracker').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTracker(); } };
setInterval(() => db.track && renderTracker(), 30000);
document.addEventListener('visibilitychange', async () => {
  if (!NATIVE && document.visibilityState === 'visible' && db.track && navigator.wakeLock) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) { /* ignore */ }
  }
});

/* ---------- render & boot ---------- */
function renderSyncPill() {
  const p = $('#sync-pill');
  if (!Cloud.enabled || !Cloud.user) { p.hidden = true; return; }
  const st = Cloud.status; p.hidden = false;
  p.classList.toggle('busy', st.state === 'syncing');
  p.textContent = st.state === 'syncing' ? 'Syncing' : st.state === 'error' ? 'Sync issue' : st.state === 'offline' ? 'Offline' : 'Synced';
}
function render() {
  renderTracker(); renderSyncPill();
  if (ui.view === 'home') renderHome();
  else if (ui.view === 'activity') renderActivity();
  else if (ui.view === 'taxes') renderTaxes();
  else { renderAccount(); renderSettings(); }
  requestAnimationFrame(moveIndicators);
}
let lastUser = null;
Cloud.on(() => {
  renderSyncPill();
  const u = Cloud.user && Cloud.user.id;
  if (u !== lastUser) { lastUser = u; if (ui.view === 'account') renderSettings(); } // show or hide "Delete my account"
  if (ui.view === 'account') renderAccount();
});
Cloud.onRemoteChange = () => { applyTheme(); render(); };

(async function boot() {
  if (NATIVE) { document.documentElement.classList.add('native'); await loadNative(); }
  applyTheme();
  render();
  if (db.track) startWatch(); // resume a shift after the app was closed
  await Cloud.init();
  if (!NATIVE && 'serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
