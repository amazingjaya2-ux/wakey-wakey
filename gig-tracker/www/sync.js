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
    if (!user) return;
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

  function syncNow() {
    if (!sb || !user) return Promise.resolve();
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
  async function signOut() {
    try { await syncNow(); } catch (_) { /* best effort */ }
    await sb.auth.signOut();
    resetLocal(); // the data is safe in the cloud; don't leave it on a shared phone
    user = null; emit();
  }
  async function deleteAccount() {
    const { error } = await sb.rpc('delete_my_account');
    if (error) throw error;
    await sb.auth.signOut().catch(() => {});
    resetLocal();
    user = null; emit();
  }

  return {
    enabled, init, syncNow, schedule, signUp, signIn, signOut, resetPassword, deleteAccount,
    get user() { return user; },
    status,
    pending: () => Object.keys(db.sync.dirty).length + Object.keys(db.sync.deleted).length,
    on: (f) => listeners.add(f),
    onRemoteChange: () => {},
    _client: sb,
  };
})();
