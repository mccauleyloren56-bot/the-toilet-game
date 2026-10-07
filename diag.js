/* Diagnostic: download the committed cloud version and inspect its resources.
   Paste into console on editor.gdevelop.io. Read-only. */
(async () => {
  const log = (...a) => console.log('%c[TTG-DIAG]', 'font-weight:bold', ...a);
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
    log('project=' + PID, 'currentVersion=' + VER);
    await fetch('https://api.gdevelop.io/project/project/' + PID + '/action/authorize?userId=' +
      encodeURIComponent(uid), { headers: H, credentials: 'include' });
    const zbytes = new Uint8Array(await (await fetch(
      'https://project-resources.gdevelop.io/' + PID + '/versions/' + VER + '.zip',
      { credentials: 'include' })).arrayBuffer());
    log('zip bytes=' + zbytes.length);
    const unz = fflate.unzipSync(zbytes);
    const names = Object.keys(unz);
    log('zip entries=' + JSON.stringify(names));
    const proj = JSON.parse(new TextDecoder().decode(unz[names[0]]));
    log('layouts=' + JSON.stringify(proj.layouts.map(l => l.name)));
    log('resources.length=' + (proj.resources ? proj.resources.length : 'MISSING'));
    if (proj.resources && proj.resources.length) {
      log('resource[0]=' + JSON.stringify(proj.resources[0]));
      log('resource[last]=' + JSON.stringify(proj.resources[proj.resources.length - 1]));
    }
    const home = proj.layouts.find(l => l.name === 'Home');
    const logo = home.objects.find(o => o.name === 'Logo');
    log('Logo frame image=' + logo.animations[0].directions[0].sprites[0].image);
  } catch (e) { console.error('%c[TTG-DIAG] FAILED: ' + e.message, 'color:red;font-weight:bold', e); }
})();
