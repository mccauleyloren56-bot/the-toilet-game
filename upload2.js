/* THE TOILET GAME — one-shot cloud upload (v2: fully self-contained, no eval, no CDN).
   1. Open https://raw.githubusercontent.com/mccauleyloren56-bot/the-toilet-game/main/upload2.js in a new tab.
   2. Ctrl+A, Ctrl+C to copy the whole thing.
   3. On editor.gdevelop.io press Ctrl+Shift+J, paste into the console, press Enter.
   Uploads the built project into your "The Toilet Game" cloud project. */
(async () => {
  const log = (...a) => console.log('%c[TTG-UPLOAD]', 'font-weight:bold', ...a);

  /* ---- minimal stored-zip builder (single file, no compression) ---- */
  const CRC_T = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function makeZip(name, data) {
    const enc = new TextEncoder();
    const nb = enc.encode(name);
    const crc = crc32(data), sz = data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true); lh.setUint16(6, 0, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
    lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint16(8, 0, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, 0, true); cd.setUint16(14, 0, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, sz, true); cd.setUint32(24, sz, true);
    cd.setUint16(28, nb.length, true); cd.setUint16(30, 0, true); cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true); cd.setUint16(36, 0, true); cd.setUint32(38, 0, true);
    cd.setUint32(42, 0, true);
    const cdOff = 30 + nb.length + sz;
    const cdSize = 46 + nb.length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, 1, true); end.setUint16(10, 1, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, cdOff, true);
    const out = new Uint8Array(cdOff + cdSize + 22);
    out.set(new Uint8Array(lh.buffer), 0);
    out.set(nb, 30); out.set(data, 30 + nb.length);
    out.set(new Uint8Array(cd.buffer), cdOff);
    out.set(nb, cdOff + 46);
    out.set(new Uint8Array(end.buffer), cdOff + cdSize);
    return out;
  }

  try {
    log('STEP0 OK: inline zip builder ready (no external scripts)');

    const projText = await (await fetch(
      'https://raw.githubusercontent.com/mccauleyloren56-bot/the-toilet-game/main/the-toilet-game.json'
    )).text();
    const proj = JSON.parse(projText);
    const names = (proj.layouts || []).map(l => l.name);
    for (const n of ['Home', 'Pinch', 'ComingSoon'])
      if (!names.includes(n)) throw new Error('missing layout: ' + n);
    log('STEP1 OK: bytes=' + projText.length, 'layouts=' + JSON.stringify(names));

    let uid = null, idToken = null;
    // Attempt A: window.firebase (compat SDK)
    try {
      const fbUser = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
      if (fbUser) { idToken = await fbUser.getIdToken(); uid = fbUser.uid; log('STEP2 OK via window.firebase'); }
    } catch (e) { log('STEP2 attempt A failed: ' + e.message); }
    // Attempt B: scan localStorage for firebase:authUser keys
    if (!idToken) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf('firebase:authUser:') === 0) {
            const rec = JSON.parse(localStorage.getItem(k));
            if (rec && rec.stsTokenManager) {
              uid = rec.uid;
              const rt = rec.stsTokenManager.refreshToken;
              // need API key -> find in scripts
              let apiKey = null;
              for (const src of [...document.scripts].map(s => s.src).filter(u => u)) {
                try { const t = await (await fetch(src)).text();
                  const m = t.match(/AIza[0-9A-Za-z_-]{35}/); if (m) { apiKey = m[0]; break; } } catch (e) {}
              }
              if (!apiKey) throw new Error('API key not found');
              const tok = await (await fetch('https://securetoken.googleapis.com/v1/token?key=' + apiKey,
                { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(rt) })).json();
              if (tok.id_token) { idToken = tok.id_token; log('STEP2 OK via localStorage'); }
              break;
            }
          }
        }
      } catch (e) { log('STEP2 attempt B failed: ' + e.message); }
    }
    // Attempt C: scan every IndexedDB database + object store for stsTokenManager
    if (!idToken) {
      try {
        const dbs = await indexedDB.databases();
        log('STEP2 attempt C: databases found: ' + dbs.map(d => d.name).join(', '));
        outer:
        for (const d of dbs) {
          const db = await new Promise((res, rej) => {
            const r = indexedDB.open(d.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
          });
          for (const sname of [...db.objectStoreNames]) {
            try {
              const vals = await new Promise((res, rej) => {
                const q = db.transaction(sname, 'readonly').objectStore(sname).getAll();
                q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
              });
              for (const v of vals) {
                const rec = (v && v.value) ? v.value : v;
                if (rec && rec.stsTokenManager && rec.stsTokenManager.refreshToken) {
                  uid = rec.uid;
                  let apiKey = null;
                  for (const src of [...document.scripts].map(s => s.src).filter(u => u)) {
                    try { const t = await (await fetch(src)).text();
                      const m = t.match(/AIza[0-9A-Za-z_-]{35}/); if (m) { apiKey = m[0]; break; } } catch (e) {}
                  }
                  if (!apiKey) throw new Error('API key not found');
                  const tok = await (await fetch('https://securetoken.googleapis.com/v1/token?key=' + apiKey,
                    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(rec.stsTokenManager.refreshToken) })).json();
                  if (tok.id_token) { idToken = tok.id_token; log('STEP2 OK via IndexedDB ' + d.name + '/' + sname); }
                  break outer;
                }
              }
            } catch (e) { /* store not readable, keep hunting */ }
          }
          db.close();
        }
      } catch (e) { log('STEP2 attempt C failed: ' + e.message); }
    }
    if (!idToken) throw new Error('Could not find Firebase login token (tried window.firebase, localStorage, all IndexedDB stores). Are you signed in on this tab?');
    const H = { Authorization: 'Bearer ' + idToken };
    const list = await (await fetch(
      'https://api.gdevelop.io/project?userId=' + encodeURIComponent(uid), { headers: H }
    )).json();
    const arr = Array.isArray(list) ? list : (list.projects || list.data || []);
    const entry = arr.find(p => p.name === 'The Toilet Game');
    if (!entry) throw new Error('"The Toilet Game" not found (entries=' + arr.length + ')');
    const PID = entry.id, CURVER = entry.currentVersion;
    log('STEP3 OK: project found, currentVersion=' + CURVER);

    const purls = await (await fetch(
      'https://api.gdevelop.io/project/' + PID + '/action/create-presigned-urls?userId=' +
        encodeURIComponent(uid),
      { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resources: ['newProjectVersion'] }) }
    )).json();
    const PURL = Array.isArray(purls) ? purls[0] : purls.url;
    if (!PURL) throw new Error('no presigned URL');
    log('STEP4 OK: presigned URL received');

    const zipBytes = makeZip('game.json', new TextEncoder().encode(projText));
    const upRes = await fetch('https://project-resources.gdevelop.io' + PURL, {
      method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: zipBytes
    });
    log('STEP5 upload status=' + upRes.status);
    if (upRes.status !== 200 && upRes.status !== 201)
      throw new Error('upload failed: ' + upRes.status);

    const VER = String(PURL).substring(
      String(PURL).lastIndexOf('/') + 1, String(PURL).indexOf('.zip'));
    const commitRes = await fetch(
      'https://api.gdevelop.io/project/' + PID + '/action/commit?userId=' +
        encodeURIComponent(uid),
      { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ newVersion: VER, previousVersion: CURVER }) });
    if (!commitRes.ok) throw new Error('commit failed: ' + commitRes.status);
    log('STEP6 OK: version committed');

    const chk = await (await fetch(
      'https://api.gdevelop.io/project/' + PID + '?userId=' + encodeURIComponent(uid),
      { headers: H }
    )).json();
    if (chk.currentVersion !== VER) throw new Error('version mismatch after commit');
    log('STEP7 OK: currentVersion=' + VER);
    log('%cALL STEPS DONE. Close and reopen "The Toilet Game" in the editor to see Home/Pinch/ComingSoon.',
        'color:green;font-weight:bold;font-size:14px');
  } catch (e) {
    console.error('%c[TTG-UPLOAD] FAILED: ' + (e && e.message),
      'color:red;font-weight:bold', e);
  }
})();
