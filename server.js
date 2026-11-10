// Chef on Board — server per landing + pannello admin
// Nessuna dipendenza esterna: basta Node 18+.
// Variabili d'ambiente (su Replit: Tools → Secrets):
//   ADMIN_PASSWORD  → password del pannello /admin  (obbligatoria)
//   PORT            → porta (Replit la imposta da solo)
// Dati: se esiste REPLIT_DB_URL usa il Database di Replit, altrimenti i file in ./data

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_URL = process.env.REPLIT_DB_URL || '';

/* ---------------- Archivio ---------------- */
async function load(key, fallback) {
  try {
    if (DB_URL) {
      const r = await fetch(DB_URL + '/' + encodeURIComponent(key));
      if (r.status === 404) return fallback;
      const t = await r.text();
      return t ? JSON.parse(t) : fallback;
    }
    const f = path.join(DATA_DIR, key + '.json');
    if (!fs.existsSync(f)) return fallback;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    console.error('Errore lettura', key, e.message);
    return fallback;
  }
}
async function save(key, value) {
  const json = JSON.stringify(value);
  if (DB_URL) {
    await fetch(DB_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encodeURIComponent(key) + '=' + encodeURIComponent(json),
    });
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const f = path.join(DATA_DIR, key + '.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(value, null, 2));
  fs.renameSync(f + '.tmp', f);
}

/* ---------------- Sicurezza ---------------- */
const sessions = new Map(); // token -> scadenza
const SESSION_MS = 12 * 60 * 60 * 1000;
const attempts = new Map(); // ip -> {n, until}

function newToken() {
  const t = crypto.randomBytes(32).toString('hex');
  sessions.set(t, Date.now() + SESSION_MS);
  return t;
}
function isAuth(req) {
  const h = req.headers['authorization'] || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const exp = sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
}

/* ---------------- Utilità ---------------- */
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 200 * 1024) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}
const str = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : 0; };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

function cleanCorso(b) {
  const argomenti = (Array.isArray(b.argomenti) ? b.argomenti : String(b.argomenti || '').split('\n'))
    .map(s => str(s, 160)).filter(Boolean).slice(0, 40);
  const c = {
    titolo: str(b.titolo, 140) || 'Chef on Board',
    sede: str(b.sede, 200),
    dataInizio: isDate(b.dataInizio) ? b.dataInizio : '',
    dataFine: isDate(b.dataFine) ? b.dataFine : '',
    orario: str(b.orario, 120),
    postiTotali: int(b.postiTotali),
    postiOccupati: int(b.postiOccupati),
    prezzo: str(b.prezzo, 80),
    argomenti,
    programma: str(b.programma, 8000),
    pubblicato: b.pubblicato !== false,
  };
  if (c.postiOccupati > c.postiTotali && c.postiTotali > 0) c.postiOccupati = c.postiTotali;
  return c;
}

/* ---------------- File statici ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.json': 'application/json' };

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';
  const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Pagina non trovata'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------------- API ---------------- */
async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  // Pubblico: corsi pubblicati e non ancora finiti
  if (p === '/api/corsi' && m === 'GET') {
    const today = new Date().toISOString().slice(0, 10);
    const corsi = (await load('corsi', []))
      .filter(c => c.pubblicato && (!(c.dataFine || c.dataInizio) || (c.dataFine || c.dataInizio) >= today))
      .sort((a, b) => (a.dataInizio || '9999').localeCompare(b.dataInizio || '9999'));
    return send(res, 200, corsi);
  }

  // Pubblico: richiesta informazioni dal modulo
  if (p === '/api/richieste' && m === 'POST') {
    const b = await readBody(req);
    if (str(b.website)) return send(res, 200, { ok: true }); // campo trappola anti-spam
    const r = {
      id: crypto.randomUUID(), data: new Date().toISOString(),
      nome: str(b.nome, 120), tel: str(b.tel, 40), email: str(b.email, 160),
      ruolo: str(b.ruolo, 60), anni: str(b.anni, 30), citta: str(b.citta, 80),
      corso: str(b.corso, 200), note: str(b.note, 2000), stato: 'nuova',
    };
    if (!r.nome || !r.tel || !/\S+@\S+\.\S+/.test(r.email)) return send(res, 400, { error: 'Dati mancanti' });
    const list = await load('richieste', []);
    list.unshift(r);
    await save('richieste', list.slice(0, 5000));
    return send(res, 201, { ok: true });
  }

  // Login
  if (p === '/api/login' && m === 'POST') {
    const ip = clientIp(req);
    const a = attempts.get(ip) || { n: 0, until: 0 };
    if (a.until > Date.now()) return send(res, 429, { error: 'Troppi tentativi. Riprova tra 15 minuti.' });
    if (!process.env.ADMIN_PASSWORD) return send(res, 503, { error: 'Password non impostata: aggiungi ADMIN_PASSWORD nei Secrets di Replit.' });
    const b = await readBody(req);
    if (safeEqual(str(b.password, 100), process.env.ADMIN_PASSWORD)) {
      attempts.delete(ip);
      return send(res, 200, { token: newToken() });
    }
    a.n += 1;
    if (a.n >= 5) { a.n = 0; a.until = Date.now() + 15 * 60 * 1000; }
    attempts.set(ip, a);
    return send(res, 401, { error: 'Password errata' });
  }

  // Da qui in poi serve il login
  if (p.startsWith('/api/admin/')) {
    if (!isAuth(req)) return send(res, 401, { error: 'Accesso richiesto' });

    if (p === '/api/admin/logout' && m === 'POST') {
      sessions.delete((req.headers['authorization'] || '').slice(7));
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/corsi' && m === 'GET') {
      const corsi = (await load('corsi', [])).sort((a, b) => (a.dataInizio || '').localeCompare(b.dataInizio || ''));
      return send(res, 200, corsi);
    }
    if (p === '/api/admin/corsi' && m === 'POST') {
      const c = { id: crypto.randomUUID(), creato: new Date().toISOString(), ...cleanCorso(await readBody(req)) };
      const list = await load('corsi', []);
      list.push(c); await save('corsi', list);
      return send(res, 201, c);
    }
    const mc = p.match(/^\/api\/admin\/corsi\/([\w-]+)$/);
    if (mc && m === 'PUT') {
      const list = await load('corsi', []);
      const i = list.findIndex(c => c.id === mc[1]);
      if (i < 0) return send(res, 404, { error: 'Corso non trovato' });
      list[i] = { ...list[i], ...cleanCorso(await readBody(req)), id: list[i].id };
      await save('corsi', list);
      return send(res, 200, list[i]);
    }
    if (mc && m === 'DELETE') {
      const list = await load('corsi', []);
      await save('corsi', list.filter(c => c.id !== mc[1]));
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/richieste' && m === 'GET') return send(res, 200, await load('richieste', []));
    const mr = p.match(/^\/api\/admin\/richieste\/([\w-]+)$/);
    if (mr && (m === 'PUT' || m === 'DELETE')) {
      let list = await load('richieste', []);
      if (m === 'DELETE') list = list.filter(r => r.id !== mr[1]);
      else {
        const b = await readBody(req);
        const r = list.find(x => x.id === mr[1]);
        if (!r) return send(res, 404, { error: 'Richiesta non trovata' });
        if (['nuova', 'contattato', 'colloquio', 'iscritto', 'perso'].includes(b.stato)) r.stato = b.stato;
      }
      await save('richieste', list);
      return send(res, 200, { ok: true });
    }
  }
  return send(res, 404, { error: 'Non trovato' });
}

/* ---------------- Server ---------------- */
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); }
    catch (e) { send(res, e.message === 'too_large' ? 413 : 400, { error: 'Richiesta non valida' }); }
    return;
  }
  serveStatic(req, res, url.pathname);
}).listen(PORT, '0.0.0.0', () => {
  console.log('Chef on Board attivo sulla porta ' + PORT + (DB_URL ? ' (Replit Database)' : ' (file in ./data)'));
  if (!process.env.ADMIN_PASSWORD) console.log('ATTENZIONE: imposta ADMIN_PASSWORD nei Secrets per usare /admin');
});
