/* Check if the uploaded resource URLs actually serve the files.
   Paste into console on editor.gdevelop.io. Read-only. */
(async () => {
  const log = (...a) => console.log('%c[TTG-URL]', 'font-weight:bold', ...a);
  try {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
      s.onload = res; s.onerror = () => rej(new Error('fflate fail'));
      document.head.appendChild(s);
    });
    let uid = null, idToken = null;
    const dbs = await indexedDB.databases();
    outer:
    for (const d of dbs) {
      let db;
      try { db = await new Promise((res, rej) => {
        const r = indexedDB.open(d.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      }); } catch (e) { continue; }
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
              const tok = await (await fetch('https://securetoken.googleapis.com/v1/token?key=' + apiKey,
                { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(rec.stsTokenManager.refreshToken) })).json();
              if (tok.id_token) { idToken = tok.id_token; break outer; }
            }
          }
        } catch (e) {}
      }
      db.close();
    }
    const H = { Authorization: 'Bearer ' + idToken };
    const list = await (await fetch(
      'https://api.gdevelop.io/project/project?userId=' + encodeURIComponent(uid), { headers: H })).json();
    const arr = Array.isArray(list) ? list : (list.projects || list.data || []);
    const entry = arr.find(p => p.name === 'The Toilet Game');
    const PID = entry.id, VER = entry.currentVersion;
    await fetch('https://api.gdevelop.io/project/project/' + PID + '/action/authorize?userId=' +
      encodeURIComponent(uid), { headers: H, credentials: 'include' });
    const zbytes = new Uint8Array(await (await fetch(
      'https://project-resources.gdevelop.io/' + PID + '/versions/' + VER + '.zip',
      { credentials: 'include' })).arrayBuffer());
    const unz = fflate.unzipSync(zbytes);
    const names = Object.keys(unz);
    const proj = JSON.parse(new TextDecoder().decode(unz[names[0]]));
    // Test first 3 resources: do the URLs actually serve the files?
    for (let i = 0; i < 3; i++) {
      const r = proj.resources[i];
      try {
        const resp = await fetch(r.file, { credentials: 'include' });
        const buf = await resp.arrayBuffer();
        log(r.name + ' -> HTTP ' + resp.status + ', ' + buf.byteLength + ' bytes, type=' + resp.headers.get('content-type'));
      } catch (e) {
        log(r.name + ' -> FETCH FAILED: ' + e.message);
      }
      // Also try without credentials:
      try {
        const resp2 = await fetch(r.file);
        log(r.name + ' (no creds) -> HTTP ' + resp2.status);
      } catch (e) {
        log(r.name + ' (no creds) -> FAILED: ' + e.message);
      }
    }
    log('DONE');
  } catch (e) { console.error('%c[TTG-URL] FAILED: ' + e.message, 'color:red;font-weight:bold', e); }
})();
