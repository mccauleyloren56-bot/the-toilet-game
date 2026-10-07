/* THE TOILET GAME — asset upload + project rewire (v1).
   Uploads all PNG/WAV assets to GDevelop's project storage, rewrites the
   project JSON resource URLs to the hosted copies, and commits a new version.
   1. Open https://raw.githubusercontent.com/mccauleyloren56-bot/the-toilet-game/main/upload-assets.js in a new tab.
   2. Ctrl+A, Ctrl+C. 3. On editor.gdevelop.io: Ctrl+Shift+J, paste, Enter. */
(async () => {
  const log = (...a) => console.log('%c[TTG-ASSETS]', 'font-weight:bold', ...a);
  const GH_RAW = 'https://raw.githubusercontent.com/mccauleyloren56-bot/the-toilet-game/main/assets/';
  const FILES = [
    ['bg.png','image/png'],['logo.png','image/png'],['john.png','image/png'],
    ['cell.png','image/png'],['particle.png','image/png'],['panel.png','image/png'],
    ['navbtn.png','image/png'],['btn_start.png','image/png'],['btn_again.png','image/png'],
    ['btn_home.png','image/png'],['btn_back.png','image/png'],['btn_restart.png','image/png'],
    ['tile_0.png','image/png'],['tile_1.png','image/png'],['tile_2.png','image/png'],
    ['tile_3.png','image/png'],['tile_4.png','image/png'],['tile_5.png','image/png'],
    ['tile_6.png','image/png'],['tile_7.png','image/png'],['tile_8.png','image/png'],
    ['tile_9.png','image/png'],['tile_10.png','image/png'],
    ['pop.wav','audio/wav'],['click.wav','audio/wav'],['spawn.wav','audio/wav'],
    ['gameover.wav','audio/wav'],['win.wav','audio/wav'],['bank.wav','audio/wav']
  ];

  /* ---- minimal stored-zip builder ---- */
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
    const enc = new TextEncoder(), nb = enc.encode(name);
    const crc = crc32(data), sz = data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
    lh.setUint16(26, nb.length, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, sz, true); cd.setUint32(24, sz, true);
    cd.setUint16(28, nb.length, true); cd.setUint32(42, 0, true);
    const cdOff = 30 + nb.length + sz, cdSize = 46 + nb.length;
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
  const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

  try {
    /* ---- auth (token hunter) ---- */
    let uid = null, idToken = null;
    try {
      const fbUser = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
      if (fbUser) { idToken = await fbUser.getIdToken(); uid = fbUser.uid; }
    } catch (e) {}
    if (!idToken) {
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
                if (!apiKey) throw new Error('API key not found');
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
    }
    if (!idToken) throw new Error('no Firebase token — are you signed in on this tab?');
    const H = { Authorization: 'Bearer ' + idToken };
    log('AUTH OK');

    /* ---- find project ---- */
    const list = await (await fetch(
      'https://api.gdevelop.io/project/project?userId=' + encodeURIComponent(uid), { headers: H })).json();
    const arr = Array.isArray(list) ? list : (list.projects || list.data || []);
    const entry = arr.find(p => p.name === 'The Toilet Game');
    if (!entry) throw new Error('project not found');
    const PID = entry.id, CURVER = entry.currentVersion;
    log('PROJECT OK: ' + PID);

    /* ---- fetch asset bytes + hashes ---- */
    log('Fetching ' + FILES.length + ' assets...');
    const assets = [];
    for (const [fn, mime] of FILES) {
      const buf = new Uint8Array(await (await fetch(GH_RAW + fn)).arrayBuffer());
      const digest = await crypto.subtle.digest('SHA-512', buf);
      assets.push({ fn, mime, bytes: buf, size: buf.length,
                    sha: hex(digest).slice(0, 64) });
    }
    log('ASSETS OK: ' + assets.length + ' files, ' +
        (assets.reduce((a, x) => a + x.size, 0) / 1024).toFixed(0) + ' KB');

    /* ---- presigned URLs ---- */
    const purls = await (await fetch(
      'https://api.gdevelop.io/project/project/' + PID + '/action/create-presigned-urls?userId=' +
        encodeURIComponent(uid),
      { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestedResources: assets.map(a => ({
          type: 'project-resource', filename: a.fn, size: a.size,
          sha512TruncatedTo256: a.sha })) }) }
    )).json();
    if (!Array.isArray(purls) || purls.length !== assets.length)
      throw new Error('bad presigned response');
    log('PRESIGNED OK: ' + purls.length + ' urls');

    /* ---- authorize + upload ---- */
    await fetch('https://api.gdevelop.io/project/project/' + PID + '/action/authorize?userId=' +
      encodeURIComponent(uid), { headers: H, credentials: 'include' });
    const RES_BASE = 'https://project-resources.gdevelop.io';
    const urlMap = {};
    for (let i = 0; i < assets.length; i++) {
      const a = assets[i];
      const up = await fetch(RES_BASE + purls[i], {
        method: 'POST', headers: { 'Content-Type': a.mime },
        body: a.bytes, credentials: 'include' });
      if (up.status !== 200 && up.status !== 201)
        throw new Error('upload failed for ' + a.fn + ': ' + up.status);
      urlMap[a.fn] = RES_BASE + String(purls[i]).split('?')[0];
      if (i % 6 === 5) log('uploaded ' + (i + 1) + '/' + assets.length);
    }
    log('UPLOADS OK: ' + assets.length + ' files');

    /* ---- rewrite project JSON resources ---- */
    const projText = await (await fetch(
      'https://raw.githubusercontent.com/mccauleyloren56-bot/the-toilet-game/main/the-toilet-game.json')).text();
    const proj = JSON.parse(projText);
    let rewired = 0;
    for (const r of proj.resources) {
      if (urlMap[r.name]) { r.file = urlMap[r.name]; rewired++; }
    }
    log('REWIRE OK: ' + rewired + '/' + proj.resources.length + ' resources');
    const newProjText = JSON.stringify(proj);

    /* ---- commit new version ---- */
    const purls2 = await (await fetch(
      'https://api.gdevelop.io/project/project/' + PID + '/action/create-presigned-urls?userId=' +
        encodeURIComponent(uid),
      { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resources: ['newProjectVersion'] }) }
    )).json();
    const PURL = Array.isArray(purls2) ? purls2[0] : purls2.url;
    const zipBytes = makeZip('game.json', new TextEncoder().encode(newProjText));
    const upRes = await fetch(RES_BASE + PURL, {
      method: 'POST', headers: { 'Content-Type': 'application/zip' },
      body: zipBytes, credentials: 'include' });
    if (upRes.status !== 200 && upRes.status !== 201)
      throw new Error('version upload failed: ' + upRes.status);
    const VER = String(PURL).substring(String(PURL).lastIndexOf('/') + 1, String(PURL).indexOf('.zip'));
    const commitRes = await fetch(
      'https://api.gdevelop.io/project/project/' + PID + '/action/commit?userId=' +
        encodeURIComponent(uid),
      { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ newVersion: VER, previousVersion: CURVER }) });
    if (!commitRes.ok) throw new Error('commit failed: ' + commitRes.status);
    const chk = await (await fetch(
      'https://api.gdevelop.io/project/project/' + PID + '?userId=' + encodeURIComponent(uid),
      { headers: H })).json();
    if (chk.currentVersion !== VER) throw new Error('version mismatch');
    log('%cALL STEPS DONE. New version ' + VER + ' committed with hosted artwork. Close and reopen the project, then Preview.',
        'color:green;font-weight:bold;font-size:14px');
  } catch (e) {
    console.error('%c[TTG-ASSETS] FAILED: ' + (e && e.message), 'color:red;font-weight:bold', e);
  }
})();
