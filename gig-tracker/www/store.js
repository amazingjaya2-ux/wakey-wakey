'use strict';
/* Data model, persistence and all money/tax math. No DOM code in this file. */

/* ---------- native bridge (Capacitor) ---------- */
const Cap = window.Capacitor;
const NATIVE = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const plugin = (name) => (NATIVE ? Cap.registerPlugin(name) : null);
const Preferences = plugin('Preferences');
const Filesystem = plugin('Filesystem');
const Share = plugin('Share');
const BgGeo = plugin('BackgroundGeolocation');
const LocalNotifications = plugin('LocalNotifications');
const Haptics = plugin('Haptics');
const SystemBars = plugin('SystemBars');

/* ---------- expense categories ----------
   group decides how a category is deducted:
   vehicle       car running costs: covered by the per-mile rate (standard) or deducted x business-use % (actual)
   vehicleAlways deducted x business-use % with either method (car loan interest)
   always        fully deductible with either method (tolls, parking)
   other         deducted x the business % entered on the expense
   none          personal, not deductible (logged for your own budget) */
const CATS = [
  { id: 'gas', name: 'Gas', group: 'vehicle' },
  { id: 'oil', name: 'Oil change', group: 'vehicle' },
  { id: 'tires', name: 'Tires', group: 'vehicle' },
  { id: 'repairs', name: 'Repairs & maintenance', group: 'vehicle' },
  { id: 'carwash', name: 'Car wash', group: 'vehicle' },
  { id: 'insurance', name: 'Car insurance', group: 'vehicle' },
  { id: 'registration', name: 'Registration & fees', group: 'vehicle' },
  { id: 'lease', name: 'Car lease payment', group: 'vehicle' },
  { id: 'loaninterest', name: 'Car loan interest', group: 'vehicleAlways' },
  { id: 'tolls', name: 'Tolls', group: 'always' },
  { id: 'parking', name: 'Parking', group: 'always' },
  { id: 'phone', name: 'Phone & data plan', group: 'other', pct: 50 },
  { id: 'gear', name: 'Phone mount & chargers', group: 'other', pct: 100 },
  { id: 'bags', name: 'Delivery bags & supplies', group: 'other', pct: 100 },
  { id: 'riders', name: 'Water & snacks for riders', group: 'other', pct: 100 },
  { id: 'software', name: 'Apps & tax software', group: 'other', pct: 100 },
  { id: 'fees', name: 'Cash-out & bank fees', group: 'other', pct: 100 },
  { id: 'otherbiz', name: 'Other business expense', group: 'other', pct: 100 },
  { id: 'meals', name: 'Your own food', group: 'none' },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
const PLATFORMS = ['DoorDash', 'Uber Eats', 'Instacart', 'Grubhub', 'Amazon Flex', 'Spark', 'Uber', 'Lyft', 'Shipt', 'Other'];

function deductRule(catId, method) {
  const c = CAT[catId]; if (!c) return '';
  switch (c.group) {
    case 'vehicle': return method === 'actual'
      ? 'Deductible: your business-use share of car costs (actual expense method).'
      : 'Already covered by the IRS per-mile rate, so it is not deducted separately. Still worth logging: switch to the actual expense method on the Taxes tab to compare.';
    case 'vehicleAlways': return 'Deductible: your business-use share, with either method.';
    case 'always': return 'Fully deductible with either method.';
    case 'other': return 'Deductible: the business-use share you enter below.';
    default: return 'Usually not deductible. Meals while driving locally are personal, but logging them shows your true take-home.';
  }
}

/* ---------- storage ---------- */
const KEY = 'milemoney.v1';
const DEFAULT_SETTINGS = {
  bracket: 12, state: 0, rate: '', gas: 3.25, mpg: 28, wear: 0.10,
  method: 'standard', theme: 'system', totalMiles: {}, updatedAt: 0,
};
function emptyDb() {
  return { v: 2, shifts: [], expenses: [], settings: { ...DEFAULT_SETTINGS }, track: null, auto: null, drives: [],
    sync: { userId: null, lastPull: null, dirty: {}, deleted: {} } };
}
function normalize(d) {
  const out = emptyDb();
  if (!d || !Array.isArray(d.shifts)) return out;
  out.shifts = d.shifts.map((s) => ({ updatedAt: 0, ...s }));
  out.expenses = Array.isArray(d.expenses) ? d.expenses : [];
  out.settings = { ...DEFAULT_SETTINGS, ...d.settings, totalMiles: { ...(d.settings && d.settings.totalMiles) } };
  out.track = d.track || null;
  out.auto = d.auto || null;                                  // automatic drive detection state (this phone only)
  out.drives = Array.isArray(d.drives) ? d.drives : [];       // detected drives waiting for review
  const s = d.sync || {};
  out.sync = { userId: s.userId || null, lastPull: s.lastPull || null, dirty: { ...s.dirty }, deleted: { ...s.deleted } };
  return out;
}
function loadLocal() {
  try { return normalize(JSON.parse(localStorage.getItem(KEY))); } catch (_) { return emptyDb(); }
}
let db = loadLocal();

const changeListeners = new Set();
function save() {
  const json = JSON.stringify(db);
  try { localStorage.setItem(KEY, json); } catch (_) { /* quota or private mode */ }
  // The OS can clear WebView storage, so native builds keep a durable copy too.
  if (Preferences) Preferences.set({ key: KEY, value: json }).catch(() => {});
}
async function loadNative() {
  if (!Preferences) return;
  try {
    const { value } = await Preferences.get({ key: KEY });
    if (value) db = normalize(JSON.parse(value));
    else save();
  } catch (_) { /* keep the localStorage copy */ }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* user edits go through these, so cloud sync knows what changed */
function touched(id, kind) {
  db.sync.dirty[id] = kind;
  delete db.sync.deleted[id];
  save();
  changeListeners.forEach((f) => f());
}
function putRecord(kind, rec) {
  const list = kind === 'shift' ? db.shifts : db.expenses;
  rec.id = rec.id || uid();
  rec.updatedAt = Date.now();
  const i = list.findIndex((x) => x.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
  touched(rec.id, kind);
}
function removeRecord(kind, id) {
  const key = kind === 'shift' ? 'shifts' : 'expenses';
  db[key] = db[key].filter((x) => x.id !== id);
  delete db.sync.dirty[id];
  db.sync.deleted[id] = kind;
  save();
  changeListeners.forEach((f) => f());
}
function updateSettings(patch) {
  Object.assign(db.settings, patch, { updatedAt: Date.now() });
  touched('settings', 'settings');
}
function markAllDirty() {
  db.shifts.forEach((s) => { db.sync.dirty[s.id] = 'shift'; });
  db.expenses.forEach((e) => { db.sync.dirty[e.id] = 'expense'; });
  db.sync.dirty.settings = 'settings';
}

/* ---------- formatting ---------- */
const money = (n, d = 2) => (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const num = (n, d = 1) => (+n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const safeDiv = (a, b) => (b > 0 ? a / b : 0);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function startOfWeek(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
const gross = (s) => (+s.pay || 0) + (+s.tips || 0);

/* ---------- rates ---------- */
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
  return 0.76; // latest known rate; update when the IRS announces a new one
}
const costPerMile = () => safeDiv(+db.settings.gas, +db.settings.mpg) + (+db.settings.wear || 0);
function taxRate() {
  const se = 0.9235 * 0.153;
  return se + ((+db.settings.bracket || 0) + (+db.settings.state || 0)) / 100 * (1 - se / 2);
}

/* ---------- periods ---------- */
const PERIODS = [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['all', 'All']];
function periodRange(p) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  switch (p) {
    case 'today': return [today, add(today, 1)];
    case 'week': { const s = startOfWeek(today); return [s, add(s, 7)]; }
    case 'month': return [new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 1)];
    case 'year': return [new Date(today.getFullYear(), 0, 1), new Date(today.getFullYear() + 1, 0, 1)];
    default: return [new Date(1970, 0, 1), new Date(3000, 0, 1)];
  }
}
function inRange(list, [a, b]) { const A = ymd(a), B = ymd(b); return list.filter((s) => s.date >= A && s.date < B); }

/* ---------- deductions ----------
   vehiclePct = business miles / all miles driven in the year (needed for the actual method,
   car loan interest). Users enter total miles per year on the Taxes tab. */
function vehiclePctFor(year, bizMiles) {
  const total = +db.settings.totalMiles[year] || 0;
  if (total > 0) return Math.min(1, safeDiv(bizMiles, total));
  return 1;
}
function deductions(shifts, expenses, vehiclePct) {
  const d = { mileage: 0, miles: 0, vehicleCosts: 0, always: 0, loanInterest: 0, other: 0, personal: 0, byCat: {} };
  for (const s of shifts) {
    d.miles += +s.miles || 0;
    d.mileage += (+s.miles || 0) * irsRate(s.date);
    d.vehicleCosts += +s.gas || 0;   // older versions logged gas and tolls on the shift
    d.always += +s.tolls || 0;
  }
  for (const e of expenses) {
    const c = CAT[e.cat] || CAT.otherbiz;
    const amt = +e.amount || 0;
    (d.byCat[c.id] ||= { amount: 0, count: 0 });
    d.byCat[c.id].amount += amt; d.byCat[c.id].count++;
    if (c.group === 'vehicle') d.vehicleCosts += amt;
    else if (c.group === 'vehicleAlways') d.loanInterest += amt;
    else if (c.group === 'always') d.always += amt;
    else if (c.group === 'other') d.other += amt * Math.min(100, Math.max(0, e.pct ?? c.pct ?? 100)) / 100;
    else d.personal += amt;
  }
  const common = d.always + d.loanInterest * vehiclePct + d.other;
  d.standard = d.mileage + common;
  d.actual = d.vehicleCosts * vehiclePct + common;
  d.vehiclePct = vehiclePct;
  return d;
}

function summarize(shifts, expenses = []) {
  const t = { gross: 0, pay: 0, tips: 0, hours: 0, miles: 0, orders: 0 };
  for (const s of shifts) {
    t.gross += gross(s); t.pay += +s.pay || 0; t.tips += +s.tips || 0;
    t.hours += +s.hours || 0; t.miles += +s.miles || 0; t.orders += +s.orders || 0;
  }
  const year = new Date().getFullYear();
  const yearMiles = db.shifts.filter((s) => s.date.startsWith(year + '-')).reduce((a, s) => a + (+s.miles || 0), 0);
  const d = deductions(shifts, expenses, vehiclePctFor(year, yearMiles));
  t.gallons = expenses.reduce((a, e) => a + (e.cat === 'gas' ? +e.gallons || 0 : 0), 0);
  t.spent = expenses.reduce((a, e) => a + (+e.amount || 0), 0) + shifts.reduce((a, s) => a + (+s.gas || 0) + (+s.tolls || 0), 0);
  t.deductions = db.settings.method === 'actual' ? d.actual : d.standard;
  t.profit = t.gross - t.deductions;
  t.setAside = Math.max(0, t.profit) * taxRate();
  t.net = t.gross - t.spent - t.setAside;
  t.driveCost = t.miles * costPerMile();
  return t;
}

function taxYear(y) {
  const shifts = db.shifts.filter((s) => s.date.startsWith(y + '-'));
  const expenses = db.expenses.filter((e) => e.date.startsWith(y + '-'));
  const t = summarize(shifts, expenses);
  const d = deductions(shifts, expenses, vehiclePctFor(y, t.miles));
  const method = db.settings.method === 'actual' ? 'actual' : 'standard';
  const ded = d[method];
  const profit = t.gross - ded;
  const se = Math.max(0, profit) * 0.9235 * 0.153;
  const taxable = Math.max(0, profit - se / 2);
  const fed = taxable * (+db.settings.bracket || 0) / 100;
  const st = taxable * (+db.settings.state || 0) / 100;
  return { y, shifts, expenses, t, d, method, ded, profit, se, fed, st, total: se + fed + st };
}
function quarters(y) {
  return [
    { name: 'Q1 · Jan–Mar', a: `${y}-01-01`, b: `${y}-04-01`, due: 'Apr 15', dueKey: `${y}-04-15` },
    { name: 'Q2 · Apr–May', a: `${y}-04-01`, b: `${y}-06-01`, due: 'Jun 15', dueKey: `${y}-06-15` },
    { name: 'Q3 · Jun–Aug', a: `${y}-06-01`, b: `${y}-09-01`, due: 'Sep 15', dueKey: `${y}-09-15` },
    { name: 'Q4 · Sep–Dec', a: `${y}-09-01`, b: `${y + 1}-01-01`, due: `Jan 15 '${String(y + 1).slice(2)}`, dueKey: `${y + 1}-01-15` },
  ];
}
