/* THE TOILET GAME — one-shot cloud upload.
   Paste into the devtools console on https://editor.gdevelop.io/ (Ctrl+Shift+J).
   Uploads the built project JSON into your "The Toilet Game" cloud project. */
(async () => {
  const log = (...a) => console.log('%c[TTG-UPLOAD]', 'font-weight:bold', ...a);
  try {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
      s.onload = res; s.onerror = () => rej(new Error('fflate failed to load'));
      document.head.appendChild(s);
    });
    if (!window.fflate || typeof fflate.zipSync !== 'function')
      throw new Error('fflate missing after load');
    log('STEP0 OK: fflate loaded');

    const projText = await (await fetch(
      'https://raw.githubusercontent.com/mccauleyloren56-bot/the-toilet-game/main/the-toilet-game.json'
    )).text();
    const proj = JSON.parse(projText);
    const names = (proj.layouts || []).map(l => l.name);
    for (const n of ['Home', 'Pinch', 'ComingSoon'])
      if (!names.includes(n)) throw new Error('missing layout: ' + n);
    log('STEP1 OK: bytes=' + projText.length, 'layouts=' + JSON.stringify(names));

    let uid = null, idToken = null;
    const fbUser = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
    if (fbUser) {
      idToken = await fbUser.getIdToken(); uid = fbUser.uid;
      log('STEP2 OK via window.firebase, uid=' + uid);
    } else {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('firebaseLocalStorageDb');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      const all = await new Promise((res, rej) => {
        const q = db.transaction('firebaseLocalStorage', 'readonly')
          .objectStore('firebaseLocalStorage').getAll();
        q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
      });
      const rec = all.find(x => x && x.value && x.value.stsTokenManager);
      if (!rec) throw new Error('no firebase record in IndexedDB');
      uid = rec.value.uid;
      const refreshToken = rec.value.stsTokenManager.refreshToken;
      let apiKey = null;
      for (const src of [...document.scripts].map(s => s.src).filter(u => u)) {
        try {
          const t = await (await fetch(src)).text();
          const m = t.match(/AIza[0-9A-Za-z_-]{35}/);
          if (m) { apiKey = m[0]; break; }
        } catch (e) {}
      }
      if (!apiKey) throw new Error('Firebase API key not found in bundles');
      const tok = await (await fetch(
        'https://securetoken.googleapis.com/v1/token?key=' + apiKey,
        { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken) }
      )).json();
      if (!tok.id_token) throw new Error('token refresh failed');
      idToken = tok.id_token;
      log('STEP2 OK via IndexedDB+refresh, uid=' + uid);
    }

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

    const zipBytes = fflate.zipSync({ 'game.json': new TextEncoder().encode(projText) });
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
