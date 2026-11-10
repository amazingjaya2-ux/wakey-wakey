'use strict';
/* Receipt photos (Pro): take or pick a photo, shrink it, keep it on the phone, and back it up to
   the cloud for signed-in Pro users. An expense with a photo carries `receipt: { cloud: bool }`;
   the file itself is stored under the expense id. */
const Receipts = (() => {
  const Camera = plugin('Camera');
  const DIR = 'receipts';
  const MAX_EDGE = 1568; // Claude reads images best at this size; also keeps files ~200-400 KB

  /* ---------- capture ---------- */
  function pickFileWeb() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
      input.click();
    });
  }
  async function capture(source) {
    let blob = null;
    if (Camera) {
      const opts = { quality: 80, targetWidth: 2000, correctOrientation: true };
      const r = source === 'camera'
        ? await Camera.takePhoto(opts)
        : (await Camera.chooseFromGallery({ ...opts, mediaType: 0, allowMultipleSelection: false, limit: 1 })).results[0];
      if (!r || !r.webPath) return null;
      blob = await (await fetch(r.webPath)).blob();
    } else {
      blob = await pickFileWeb();
    }
    return blob ? shrink(blob) : null;
  }

  async function shrink(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
      const k = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.78));
    } finally { URL.revokeObjectURL(url); }
  }

  const toBase64 = (blob) => new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = bad; r.readAsDataURL(blob);
  });
  const fromBase64 = (b64, type = 'image/jpeg') => {
    const bin = atob(b64); const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type });
  };

  /* ---------- on-device storage (Filesystem on phones, IndexedDB in browsers) ---------- */
  let idb = null;
  function openIdb() {
    if (idb) return idb;
    idb = new Promise((ok, bad) => {
      const r = indexedDB.open('milemoney-receipts', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
    });
    return idb;
  }
  async function idbDo(mode, fn) {
    const d = await openIdb();
    return new Promise((ok, bad) => {
      const tx = d.transaction('files', mode); const req = fn(tx.objectStore('files'));
      tx.oncomplete = () => ok(req && req.result); tx.onerror = () => bad(tx.error);
    });
  }
  async function putLocal(id, blob) {
    if (Filesystem) await Filesystem.writeFile({ path: `${DIR}/${id}.jpg`, data: await toBase64(blob), directory: 'DATA', recursive: true });
    else await idbDo('readwrite', (s) => s.put(blob, id));
  }
  async function getLocal(id) {
    try {
      if (Filesystem) { const { data } = await Filesystem.readFile({ path: `${DIR}/${id}.jpg`, directory: 'DATA' }); return typeof data === 'string' ? fromBase64(data) : data; }
      return (await idbDo('readonly', (s) => s.get(id))) || null;
    } catch (_) { return null; }
  }
  async function delLocal(id) {
    try {
      if (Filesystem) await Filesystem.deleteFile({ path: `${DIR}/${id}.jpg`, directory: 'DATA' });
      else await idbDo('readwrite', (s) => s.delete(id));
    } catch (_) { /* already gone */ }
  }

  /* ---------- cloud ---------- */
  const cloudOn = () => Cloud.enabled && Cloud.user && Pro.active;
  async function upload(expense) {
    if (!cloudOn() || !expense.receipt || expense.receipt.cloud) return;
    const blob = await getLocal(expense.id); if (!blob) return;
    await Cloud.uploadReceipt(expense.id, blob);
    const cur = db.expenses.find((x) => x.id === expense.id);
    if (cur && cur.receipt) putRecord('expense', { ...cur, receipt: { ...cur.receipt, cloud: true } });
  }
  // Upload any photos that haven't reached the cloud yet (after sign-in, going Pro, or coming back online).
  let flushing = false;
  async function flush() {
    if (flushing || !cloudOn()) return;
    flushing = true;
    try { for (const e of db.expenses.filter((x) => x.receipt && !x.receipt.cloud)) { try { await upload(e); } catch (_) { /* retry later */ } } }
    finally { flushing = false; }
  }

  /* ---------- public API ---------- */
  async function attach(expenseId, blob) {
    await putLocal(expenseId, blob);
    return { cloud: false, at: Date.now() };
  }
  async function get(expense) {
    let blob = await getLocal(expense.id);
    if (!blob && expense.receipt && expense.receipt.cloud && cloudOn()) {
      try { blob = await Cloud.downloadReceipt(expense.id); await putLocal(expense.id, blob); } catch (_) { blob = null; }
    }
    return blob;
  }
  async function remove(expense) {
    await delLocal(expense.id);
    if (expense.receipt && expense.receipt.cloud && Cloud.user) { try { await Cloud.removeReceipt(expense.id); } catch (_) { /* best effort */ } }
  }
  return { capture, attach, get, remove, upload, flush, toBase64 };
})();
