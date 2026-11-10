'use strict';
/* Accounts and cloud sync (Supabase).
   Offline-first: everything is saved on the phone first. When signed in, changed records are
   pushed to the `records` table and changes from other devices are pulled down.
   Conflicts resolve as "last change wins". */
const Cloud = (() => {
  const cfg = window.MILEMONEY_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const sb = enabled ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'milemoney.auth' },
  }) : null;

  let user = null;
  const pending = () => Object.keys(db.sync.dirty).length + Object.keys(db.sync.deleted).length;
  let running = null;
  let again = false;
  let timer = null;
  const status = { state: 'idle', at: null, error: null };
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => { try { f(); } catch (_) { /* ignore */ } });

  function resetLocal() {
    const theme = db.settings.theme;
    db = emptyDb();
    db.settings.theme = theme;
    save();
  }

  function adopt(u) {
    // Data on this phone belongs to a different account: never mix two people's data.
    if (db.sync.userId && db.sync.userId !== u.id) resetLocal();
    if (db.sync.userId !== u.id) {
      db.sync.userId = u.id;
      db.sync.lastPull = null;
      markAllDirty(); // upload anything logged before signing in
      save();
    }
  }

  function setUser(u) {
    const prev = user && user.id;
    user = u;
    if (u && u.id !== prev) { adopt(u); syncNow(); }
    emit();
  }

  async function init() {
    if (!sb) return;
    // Supabase advises against awaiting its own calls inside this callback, so defer.
    sb.auth.onAuthStateChange((_event, session) => setTimeout(() => setUser(session ? session.user : null), 0));
    window.addEventListener('online', () => syncNow());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
    setInterval(() => syncNow(), 5 * 60 * 1000);
    changeListeners.add(schedule);
  }

  function schedule() {
    if (!user || !proOk()) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, 1500);
  }

  function recordFor(id, kind) {
    if (kind === 'settings') return db.settings;
    return (kind === 'shift' ? db.shifts : db.expenses).find((x) => x.id === id);
  }

  async function push() {
    const rows = [];
    const snap = {};
    for (const [id, kind] of Object.entries(db.sync.dirty)) {
      const rec = recordFor(id, kind);
      if (!rec) { delete db.sync.dirty[id]; continue; }
      snap[id] = rec.updatedAt;
      rows.push({ user_id: user.id, id, kind, data: rec, deleted: false });
    }
    const gone = Object.entries(db.sync.deleted);
    for (const [id, kind] of gone) rows.push({ user_id: user.id, id, kind, data: {}, deleted: true });
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('records').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,id' });
      if (error) throw error;
    }
    // Only clear what didn't change again while we were uploading.
    for (const [id, at] of Object.entries(snap)) {
      const rec = recordFor(id, db.sync.dirty[id]);
      if (!rec || rec.updatedAt === at) delete db.sync.dirty[id];
    }
    for (const [id] of gone) delete db.sync.deleted[id];
    save();
  }

  function applyRemote(row) {
    if (db.sync.dirty[row.id] || db.sync.deleted[row.id]) return false; // local change wins until pushed
    if (row.kind === 'settings') {
      if (row.deleted) return false;
      const theme = db.settings.theme;
      db.settings = { ...DEFAULT_SETTINGS, ...row.data, totalMiles: { ...row.data.totalMiles } };
      if (!row.data.theme) db.settings.theme = theme;
      return true;
    }
    const key = row.kind === 'shift' ? 'shifts' : 'expenses';
    const i = db[key].findIndex((x) => x.id === row.id);
    if (row.deleted) { if (i >= 0) { db[key].splice(i, 1); return true; } return false; }
    if (i >= 0) db[key][i] = row.data; else db[key].push(row.data);
    return true;
  }

  async function pull() {
    // Re-read the last minute too, so rows committed slightly out of order are never missed.
    const since = db.sync.lastPull ? new Date(Date.parse(db.sync.lastPull) - 60000).toISOString() : null;
    let from = 0, newest = db.sync.lastPull, changed = false;
    for (;;) {
      let q = sb.from('records').select('id,kind,data,deleted,updated_at').eq('user_id', user.id)
        .order('updated_at', { ascending: true }).range(from, from + 999);
      if (since) q = q.gt('updated_at', since);
      const { data, error } = await q;
      if (error) throw error;
      for (const row of data) {
        changed = applyRemote(row) || changed;
        if (!newest || row.updated_at > newest) newest = row.updated_at;
      }
      if (data.length < 1000) break;
      from += 1000;
    }
    db.sync.lastPull = newest;
    save();
    return changed;
  }

  const proOk = () => typeof Pro === 'undefined' || Pro.active;
  function syncNow() {
    if (!sb || !user) return Promise.resolve();
    if (!proOk()) { status.state = 'locked'; emit(); return Promise.resolve(); }
    if (running) { again = true; return running; }
    if (!navigator.onLine) { status.state = 'offline'; emit(); return Promise.resolve(); }
    status.state = 'syncing'; emit();
    running = (async () => {
      try {
        await push();
        const changed = await pull();
        status.state = 'ok'; status.at = Date.now(); status.error = null;
        if (changed) Cloud.onRemoteChange();
      } catch (e) {
        status.state = 'error'; status.error = e.message || String(e);
      } finally {
        running = null; emit();
        if (again) { again = false; syncNow(); }
      }
    })();
    return running;
  }

  /* ---------- account actions ---------- */
  async function signUp(email, password) {
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw error;
    return { needsConfirm: !data.session };
  }
  async function signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }
  async function resetPassword(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email);
    if (error) throw error;
  }
  // Data is only removed from the phone when it is safely in the cloud (Pro sync).
  // Free users keep everything on the phone when they sign out.
  const synced = () => proOk() && status.state === 'ok' && pending() === 0;
  function detach() { db.sync.userId = null; db.sync.lastPull = null; save(); }
  async function signOut() {
    try { await syncNow(); } catch (_) { /* best effort */ }
    const clear = synced();
    await sb.auth.signOut();
    if (clear) resetLocal(); else detach();
    user = null; emit();
    return clear;
  }

  /* ---------- receipt photos (Pro): receipts/<user id>/<expense id>.jpg ---------- */
  const bucket = () => sb.storage.from('receipts');
  const receiptPath = (id) => `${user.id}/${id}.jpg`;
  async function uploadReceipt(id, blob) {
    const { error } = await bucket().upload(receiptPath(id), blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
    if (error) throw error;
  }
  async function downloadReceipt(id) {
    const { data, error } = await bucket().download(receiptPath(id));
    if (error) throw error;
    return data;
  }
  async function removeReceipt(id) {
    const { error } = await bucket().remove([receiptPath(id)]);
    if (error) throw error;
  }
  async function removeAllReceipts() {
    for (;;) {
      const { data, error } = await bucket().list(user.id, { limit: 100 });
      if (error) throw error;
      if (!data || !data.length) return;
      const { error: e2 } = await bucket().remove(data.map((f) => `${user.id}/${f.name}`));
      if (e2) throw e2;
    }
  }

  /* ---------- AI receipt scanner (Pro, runs in the scan-receipt edge function) ---------- */
  async function scanReceipt(base64, mediaType) {
    const { data } = await sb.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) { const e = new Error('Sign in to use the receipt scanner'); e.code = 'sign_in_required'; throw e; }
    const res = await fetch(`${cfg.supabaseUrl}/functions/v1/scan-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, mediaType, today: ymd(new Date()) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(body.message || 'The scanner had a problem. Try again.'); e.code = body.error || 'error'; throw e; }
    return body.receipt;
  }

  async function deleteAccount() {
    await removeAllReceipts(); // storage files are not removed by deleting the user row
    const { error } = await sb.rpc('delete_my_account');
    if (error) throw error;
    const clear = proOk();
    await sb.auth.signOut().catch(() => {});
    if (clear) resetLocal(); else detach();
    user = null; emit();
  }

  return {
    enabled, init, syncNow, schedule, signUp, signIn, signOut, resetPassword, deleteAccount,
    get user() { return user; },
    status,
    pending,
    uploadReceipt, downloadReceipt, removeReceipt, scanReceipt,
    on: (f) => listeners.add(f),
    onRemoteChange: () => {},
    _client: sb,
  };
})();
