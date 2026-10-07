/* fix-resources.js — THE FIX for the missing artwork.
   Wraps the flat resources array into GDevelop's required nested format
   {"resources":{"resources":[...]}} and recommits the project.
   The 29 assets are already uploaded; only the JSON wrapper was wrong.
   Paste into console on editor.gdevelop.io. Run ONCE. */
(async () => {
  const log = (...a) => console.log('%c[TTG-FIX]', 'font-weight:bold', ...a);
  const API = 'https://api.gdevelop.io';
  const RES = 'https://project-resources.gdevelop.io';
  try {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
      s.onload = res; s.onerror = () => rej(new Error('fflate fail'));
      document.head.appendChild(s);
    });
    log('fflate loaded');

    // ---- auth hunter ----
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
    if (!idToken) throw new Error('auth not found');
    const H = { Authorization: 'Bearer ' + idToken };
    log('AUTH OK');

    // ---- find project ----
    const list = await (await fetch(API + '/project/project?userId=' + encodeURIComponent(uid), { headers: H })).json();
    const arr = Array.isArray(list) ? list : (list.projects || list.data || []);
    const entry = arr.find(p => p.name === 'The Toilet Game');
    const PID = entry.id, CURVER = entry.currentVersion;
    log('project=' + PID, 'currentVersion=' + CURVER);

    // ---- authorize cookie ----
    await fetch(API + '/project/' + PID + '/action/authorize?userId=' + encodeURIComponent(uid),
      { headers: H, credentials: 'include' });
    log('cookie OK');

    // ---- download + parse current version ----
    const zbytes = new Uint8Array(await (await fetch(
      RES + '/' + PID + '/versions/' + CURVER + '.zip', { credentials: 'include' })).arrayBuffer());
    const unz = fflate.unzipSync(zbytes);
    const zname = Object.keys(unz)[0];
    const proj = JSON.parse(new TextDecoder().decode(unz[zname]));
    log('downloaded, layouts=' + JSON.stringify(proj.layouts.map(l => l.name)));

    // ---- THE FIX: wrap flat resources array ----
    if (Array.isArray(proj.resources)) {
      const n = proj.resources.length;
      proj.resources = { resources: proj.resources };
      log('WRAPPED ' + n + ' resources into nested format');
    } else if (proj.resources && Array.isArray(proj.resources.resources)) {
      log('already nested (' + proj.resources.resources.length + '), nothing to fix');
    } else {
      throw new Error('unexpected resources shape: ' + typeof proj.resources);
    }

    // ---- re-zip ----
    const newText = JSON.stringify(proj);
    const zipped = fflate.zipSync({ 'game.json': new TextEncoder().encode(newText) });
    log('re-zipped ' + zipped.length + ' bytes');

    // ---- presigned URL for new version ----
    const purl = await (await fetch(
      API + '/project/' + PID + '/action/create-presigned-urls?userId=' + encodeURIComponent(uid),
      { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H),
        body: JSON.stringify({ resources: ['newProjectVersion'] }) })).json();
    const presigned = purl[0];
    const m = presigned.match(/\/versions\/([a-z0-9-]+)\.zip/i);
    const NEWVER = m[1];
    log('new version id=' + NEWVER);

    // ---- upload zip (POST per GDevelop source: commitVersion uses projectResourcesClient.post) ----
    const up = await fetch(RES + presigned,
      { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/zip' }, body: zipped });
    if (!up.ok) throw new Error('zip upload failed: ' + up.status);
    log('zip uploaded');

    // ---- commit ----
    const commit = await fetch(
      API + '/project/' + PID + '/action/commit?userId=' + encodeURIComponent(uid),
      { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H),
        body: JSON.stringify({ newVersion: NEWVER, previousVersion: CURVER }) });
    if (!commit.ok) throw new Error('commit failed: ' + commit.status + ' ' + await commit.text());
    log('committed version ' + NEWVER);

    // ---- verify ----
    const chk = await (await fetch(API + '/project/project?userId=' + encodeURIComponent(uid), { headers: H })).json();
    const chkArr = Array.isArray(chk) ? chk : (chk.projects || chk.data || []);
    const chkEntry = chkArr.find(p => p.name === 'The Toilet Game');
    log('server currentVersion=' + chkEntry.currentVersion);
    if (chkEntry.currentVersion === NEWVER) {
      log('%cALL STEPS DONE — close and reopen the project, then Preview.', 'color:green;font-size:14px');
    } else {
      log('%cversion mismatch after commit!', 'color:red');
    }
  } catch (e) { console.error('%c[TTG-FIX] FAILED: ' + e.message, 'color:red;font-weight:bold', e); }
})();
