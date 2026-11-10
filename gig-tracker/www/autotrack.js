'use strict';
/* Automatic drive detection (Pro).
   Watches GPS in the background. A drive starts when the phone is clearly moving at driving speed
   and ends after it has been still for STOP_AFTER. Finished drives wait in an inbox (db.drives)
   where the driver logs them as a work shift or marks them personal.
   While the manual "Start shift" tracker runs, detection pauses so miles are never counted twice. */
const AutoTrack = (() => {
  const MOVE_SPEED = 4.0;          // m/s (~9 mph): faster than walking or jogging
  const START_DIST = 250;          // m away from where the phone was parked
  const STILL_RADIUS = 100;        // m: GPS drift while parked stays inside this
  const STOP_AFTER = 5 * 60e3;     // ms without moving ends a drive
  const MIN_MILES = 0.3;           // shorter "drives" are ignored (parking lot moves, GPS glitches)
  const MAX_SPEED = 60;            // m/s (~134 mph): faster than this is a GPS jump
  const M_PER_MI = 1609.344;

  const meters = (a, b) => haversineMi(a, b) * M_PER_MI;

  /* ---------- the detector: a small state machine fed one GPS fix at a time ---------- */
  function feed(st, p) {
    if (!p || p.accuracy > 50) return null;
    if (st.mode !== 'driving') {
      const a = st.anchor;
      if (!a) { st.anchor = { lat: p.lat, lon: p.lon, ts: p.ts }; st.prev = p; return null; }
      const d = meters(a, p), dt = Math.max(1, (p.ts - a.ts) / 1000);
      const prev = st.prev, inst = p.speed != null && p.speed >= 0 ? p.speed : prev ? meters(prev, p) / Math.max(1, (p.ts - prev.ts) / 1000) : 0;
      st.prev = p;
      if (d < STILL_RADIUS) { a.ts = p.ts; return null; }               // still parked (GPS drift)
      if ((inst >= MOVE_SPEED && d >= STILL_RADIUS) || (d >= START_DIST && d / dt >= 3)) {
        st.mode = 'driving';
        st.drive = { id: 'drv-' + uid(), start: a.ts, lastMove: p.ts, last: { lat: p.lat, lon: p.lon, ts: p.ts },
          miles: d / M_PER_MI, path: [[a.lat, a.lon], [p.lat, p.lon]], from: [a.lat, a.lon] };
        return 'started';
      }
      st.anchor = { lat: p.lat, lon: p.lon, ts: p.ts };                 // walked somewhere slowly: new spot
      return null;
    }
    const dr = st.drive, last = dr.last;
    const step = meters(last, p), dt = Math.max(1, (p.ts - last.ts) / 1000);
    if (step / dt > MAX_SPEED) return null;                             // impossible jump
    if (p.ts - last.ts >= STOP_AFTER && step < START_DIST) {           // long silent gap, barely moved: it had stopped
      const done = finish(st, last.ts);
      feed(st, p);
      return done;
    }
    // Parked GPS drifts 20-50 m between fixes, so "stopped" means staying within STILL_RADIUS of the
    // spot where the car slowed down, not "each fix is close to the last one".
    const fast = p.speed != null && p.speed >= 2;
    const nearStop = dr.still && meters(dr.still, p) <= STILL_RADIUS;
    if (!fast && (nearStop || step < 60)) {
      if (!dr.still) dr.still = { lat: p.lat, lon: p.lon, ts: p.ts };
      if (p.ts - dr.lastMove >= STOP_AFTER) return finish(st, dr.lastMove);
      return 'moving';
    }
    // really moving: count the distance from the last counted point (nothing lost while slow)
    dr.still = null;
    dr.miles += step / M_PER_MI;
    dr.last = { lat: p.lat, lon: p.lon, ts: p.ts };
    dr.lastMove = p.ts;
    const lp = dr.path[dr.path.length - 1];
    if (meters({ lat: lp[0], lon: lp[1] }, p) >= 150) dr.path.push([p.lat, p.lon]);
    return 'moving';
  }
  // Called on a timer, because a parked phone may send no GPS fixes at all.
  function tick(st, now) {
    if (st.mode === 'driving' && now - st.drive.lastMove >= STOP_AFTER) return finish(st, st.drive.lastMove);
    return null;
  }
  function finish(st, end) {
    const dr = st.drive;
    st.mode = 'idle'; st.drive = null;
    st.anchor = { lat: dr.last.lat, lon: dr.last.lon, ts: dr.last.ts }; st.prev = null;
    if (dr.miles < MIN_MILES) return 'discarded';
    const path = dr.path.length > 40 ? dr.path.filter((_, i) => i % Math.ceil(dr.path.length / 40) === 0 || i === dr.path.length - 1) : dr.path;
    const drive = { id: dr.id, start: dr.start, end: Math.max(end, dr.start + 60e3), miles: +dr.miles.toFixed(2),
      date: ymd(new Date(dr.start)), path, from: dr.from, to: [dr.last.lat, dr.last.lon] };
    st.finished = drive;
    return 'finished';
  }

  /* ---------- wiring: GPS watcher, persistence, notifications ---------- */
  let watcher = null, webWatch = null, timer = null, paused = false;
  const state = () => (db.auto ||= { on: false, st: { mode: 'idle' } });
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => { try { f(); } catch (_) { /* ignore */ } });

  function handle(result) {
    const a = state();
    if (result === 'finished' && a.st.finished) {
      const d = a.st.finished; a.st.finished = null;
      (db.drives ||= []).push(d);
      notify(d);
    }
    if (result) { save(); emit(); }
  }
  function onFix(p) {
    if (paused || db.track) return;
    handle(feed(state().st, p));
  }
  async function notify(d) {
    if (!LocalNotifications) return;
    try {
      await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 2e9), title: `Drive detected: ${num(d.miles, 1)} mi`,
        body: 'Open MileMoney to log it as work or mark it personal.' }] });
    } catch (_) { /* notifications off */ }
  }

  async function startWatching() {
    if (watcher !== null || webWatch !== null) return true;
    if (BgGeo) {
      if (LocalNotifications) { try { await LocalNotifications.requestPermissions(); } catch (_) { /* optional */ } }
      watcher = await BgGeo.addWatcher({
        backgroundTitle: 'MileMoney is watching for drives',
        backgroundMessage: 'Miles are logged automatically when you drive.',
        requestPermissions: true, stale: false, distanceFilter: 30,
      }, (loc, err) => {
        if (err) { if (err.code === 'NOT_AUTHORIZED') { toast('Location access is needed to detect drives'); disable(); } return; }
        if (loc) onFix({ lat: loc.latitude, lon: loc.longitude, accuracy: loc.accuracy, speed: loc.speed, ts: loc.time || Date.now() });
      });
    } else if ('geolocation' in navigator) {
      webWatch = navigator.geolocation.watchPosition((x) => onFix({ lat: x.coords.latitude, lon: x.coords.longitude, accuracy: x.coords.accuracy, speed: x.coords.speed, ts: x.timestamp }),
        () => {}, { enableHighAccuracy: true, maximumAge: 10000 });
    } else return false;
    clearInterval(timer);
    timer = setInterval(() => { if (!paused && !db.track) handle(tick(state().st, Date.now())); }, 60e3);
    return true;
  }
  async function stopWatching() {
    clearInterval(timer); timer = null;
    if (watcher !== null) { try { await BgGeo.removeWatcher({ id: watcher }); } catch (_) { /* ignore */ } watcher = null; }
    if (webWatch !== null) { navigator.geolocation.clearWatch(webWatch); webWatch = null; }
  }

  async function enable() {
    const a = state();
    a.on = true; a.st = { mode: 'idle' }; save();
    const ok = await startWatching();
    if (!ok) { a.on = false; save(); }
    emit(); return ok;
  }
  async function disable() {
    const a = state();
    // a drive in progress is kept if it's long enough
    if (a.st.mode === 'driving') handle(finish(a.st, a.st.drive.lastMove));
    a.on = false; a.st = { mode: 'idle' }; save();
    await stopWatching(); emit();
  }
  // The manual shift tracker takes over the GPS while it runs.
  async function pause() { paused = true; const a = state(); if (a.st.mode === 'driving') handle(finish(a.st, Date.now())); a.st = { mode: 'idle' }; await stopWatching(); }
  async function resume() { paused = false; if (state().on && Pro.active && !db.track) { state().st = { mode: 'idle' }; await startWatching(); } }
  // On launch, after Pro status is known.
  async function restore() {
    const a = state();
    if (!a.on) return;
    if (!Pro.active) { await stopWatching(); return; }
    if (db.track) { paused = true; return; }
    handle(tick(a.st, Date.now()));
    await startWatching();
  }

  return {
    enable, disable, pause, resume, restore,
    get on() { return !!state().on; },
    get driving() { const s = state().st; return s.mode === 'driving' ? s.drive : null; },
    on_: (f) => listeners.add(f),
    _feed: onFix, _tick: (now) => handle(tick(state().st, now)), // for tests
  };
})();
