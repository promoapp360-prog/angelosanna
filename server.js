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
// COMING_SOON=1 → online c'è SOLO la pagina "stiamo arrivando" (public/presto.html); il resto del sito resta nascosto.
// /admin continua a funzionare. Togli la variabile (o mettila a 0) per mostrare il sito completo.
const COMING_SOON = /^(1|true|on|si)$/i.test(process.env.COMING_SOON || '');
const CS_STATIC = ['/', '/admin', '/admin/', '/admin.html', '/presto.html', '/assets/hero-yacht.jpeg', '/assets/angelo.jpg'];
const CS_API = ['/api/login', '/api/richieste', '/api/stripe/webhook'];
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

/* ---------------- Contatti ---------------- */
const STATI = ['nuovo', 'contattato', 'colloquio', 'partecipante', 'non interessato'];
const FONTI = ['Sito', 'Instagram', 'Facebook', 'WhatsApp', 'Telefono', 'Email', 'Passaparola', 'Evento', 'Altro'];
const OLD_STATI = { nuova: 'nuovo', iscritto: 'partecipante', perso: 'non interessato' };

function normContatto(r) {
  if (OLD_STATI[r.stato]) r.stato = OLD_STATI[r.stato];
  if (!STATI.includes(r.stato)) r.stato = 'nuovo';
  if (!r.fonte) r.fonte = 'Sito';
  if (!('corsoId' in r)) r.corsoId = '';
  return r;
}
function cleanContatto(b) {
  return {
    nome: str(b.nome, 120), tel: str(b.tel, 40), email: str(b.email, 160),
    ruolo: str(b.ruolo, 60), anni: str(b.anni, 30), citta: str(b.citta, 80),
    note: str(b.note, 2000),
    fonte: FONTI.includes(b.fonte) ? b.fonte : 'Altro',
    stato: STATI.includes(b.stato) ? b.stato : 'nuovo',
    corsoId: str(b.corsoId, 60),
  };
}
// Aggiorna i posti occupati del corso quando un contatto diventa (o smette di essere) partecipante
function seatDelta(corsi, corsoId, delta) {
  const c = corsi.find(x => x.id === corsoId);
  if (!c) return;
  const occ = (c.postiOccupati || 0) + delta;
  if (delta > 0 && c.postiTotali > 0 && (c.postiOccupati || 0) >= c.postiTotali) {
    const e = new Error('Il corso "' + c.titolo + '" è al completo (' + c.postiTotali + ' posti). Aumenta i posti del corso prima di aggiungere partecipanti.');
    e.code = 409; throw e;
  }
  c.postiOccupati = Math.max(0, occ);
}
const isPart = (r) => r && r.stato === 'partecipante' && r.corsoId;

/* ---------------- File statici ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.json': 'application/json' };

function serveStatic(req, res, pathname) {
  if (COMING_SOON && !CS_STATIC.includes(pathname) && !pathname.startsWith('/assets/presto/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Pagina non trovata');
  }
  if (pathname === '/') pathname = COMING_SOON ? '/presto.html' : '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';
  const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Pagina non trovata'); }
    const ext = path.extname(file).toLowerCase();
    const head = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': ext === '.html' || ext === '.js' ? 'no-cache' : 'public, max-age=86400',
    };
    // Richieste parziali (Range): servono a iPhone/Safari per riprodurre i video
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? parseInt(m[1], 10) : Math.max(0, st.size - parseInt(m[2], 10));
      let end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
      res.writeHead(206, { ...head, 'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
    }
    res.writeHead(200, { ...head, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}

/* ---------------- Shop: prodotti, ordini, Stripe ---------------- */
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_API = process.env.STRIPE_API_BASE || 'https://api.stripe.com';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const SIMULATED_PAYMENTS = process.env.PAYMENT_MODE === 'simulated';
const ORDINE_STATI = ['in attesa', 'pagato', 'annullato', 'rimborsato', 'simulato'];
const MAX_QTY = 10;

// Prezzo iniziale del corso online: 890 €.
const COURSE_PRICE_MIGRATION_KEY = 'migrazione-prezzo-corso-online-890-v1';
const DEFAULT_PRODOTTI = [{
  id: 'corso-online', creato: new Date().toISOString(), pubblicato: true, prezzo: 89000,
  titolo: 'Chef on Board — Corso online',
  descrizione: 'Il metodo di Chef Angelo Sanna per diventare Private Chef su yacht e ville di lusso, da seguire online quando vuoi.',
  include: ['Accesso al corso online', 'Materiali e dispense', 'Supporto di Chef Angelo'], richiedeSpedizione: false,
}];
async function getStoredProdotti() {
  let list = await load('prodotti', null);
  if (!list) {
    list = DEFAULT_PRODOTTI;
    await save('prodotti', list);
  }
  if (!(await load(COURSE_PRICE_MIGRATION_KEY, false)) && Array.isArray(list)) {
    const index = list.findIndex(p => p.id === 'corso-online');
    if (index >= 0) {
      list[index] = { ...list[index], prezzo: 89000 };
      await save('prodotti', list);
      const saved = await load('prodotti', null);
      const savedCourse = Array.isArray(saved) && saved.find(p => p.id === 'corso-online');
      if (!savedCourse || savedCourse.prezzo !== 89000) {
        throw new Error('Impossibile salvare il prezzo del corso online.');
      }
      list = saved;
      await save(COURSE_PRICE_MIGRATION_KEY, true);
    }
  }
  return list;
}
async function getProdotti() {
  return getStoredProdotti();
}
function toCents(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n * 100), 10000000) : 0;
}
function cleanProdotto(b) {
  const include = (Array.isArray(b.include) ? b.include : String(b.include || '').split('\n'))
    .map(s => str(s, 160)).filter(Boolean).slice(0, 20);
  return {
    titolo: str(b.titolo, 140) || 'Chef on Board — Corso online',
    descrizione: str(b.descrizione, 1500),
    include,
    prezzo: toCents(b.prezzo),
    richiedeSpedizione: b.richiedeSpedizione === true,
    pubblicato: b.pubblicato !== false,
  };
}
const publicProdotto = (p) => ({ id: p.id, titolo: p.titolo, descrizione: p.descrizione, include: p.include || [], prezzo: p.prezzo, richiedeSpedizione: p.richiedeSpedizione === true });

// Stripe vuole i parametri in form-encoding con parentesi quadre per oggetti e array.
function formEncode(obj, prefix, out) {
  out = out || [];
  Object.keys(obj).forEach(k => {
    const v = obj[k]; if (v == null) return;
    const key = prefix ? prefix + '[' + k + ']' : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
  });
  return out;
}
async function stripe(method, endpoint, params) {
  if (!STRIPE_KEY) { const e = new Error('Pagamenti online non ancora attivi.'); e.code = 503; throw e; }
  const body = params && method !== 'GET' ? formEncode(params).join('&') : undefined;
  const qs = params && method === 'GET' ? '?' + formEncode(params).join('&') : '';
  const r = await fetch(STRIPE_API + endpoint + qs, {
    method,
    headers: { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Stripe errore', r.status, j.error && j.error.message); const e = new Error('Pagamento non disponibile al momento. Riprova o scrivici su WhatsApp.'); e.code = 502; throw e; }
  return j;
}
function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return proto + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
}
async function setOrdine(id, patch, onlyFrom) {
  const list = await load('ordini', []);
  const o = list.find(x => x.id === id);
  if (!o) return null;
  if (onlyFrom && !onlyFrom.includes(o.stato)) return o;
  Object.assign(o, patch);
  await save('ordini', list);
  return o;
}
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 1024 * 1024) { reject(new Error('too_large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
// Verifica firma Stripe-Signature: HMAC-SHA256 di "t.payload" con il segreto del webhook.
function verifyStripeSig(raw, header) {
  if (!WEBHOOK_SECRET || !header) return false;
  const parts = {}; String(header).split(',').forEach(s => { const i = s.indexOf('='); if (i > 0) (parts[s.slice(0, i)] = parts[s.slice(0, i)] || []).push(s.slice(i + 1)); });
  const t = (parts.t || [])[0]; if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const exp = crypto.createHmac('sha256', WEBHOOK_SECRET).update(t + '.').update(raw).digest('hex');
  return (parts.v1 || []).some(v => v.length === exp.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(exp)));
}
async function applySession(s) {
  const id = s.metadata && s.metadata.ordine_id; if (!id) return;
  if (s.payment_status === 'paid') await setOrdine(id, { stato: 'pagato', pagato: new Date().toISOString() }, ['in attesa']);
}

/* ---------------- API ---------------- */
async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  // Pubblico: prodotti in vendita + se i pagamenti Stripe o simulati sono attivi
  if (p === '/api/shop' && m === 'GET') {
    const prodotti = (await getProdotti()).filter(x => x.pubblicato).map(publicProdotto);
    return send(res, 200, { prodotti, pagamenti: !!STRIPE_KEY || SIMULATED_PAYMENTS, simulazione: SIMULATED_PAYMENTS });
  }

  // Pubblico: crea l'ordine e la sessione di pagamento Stripe
  if (p === '/api/checkout' && m === 'POST') {
    const b = await readBody(req);
    if (str(b.website)) return send(res, 200, { ok: true }); // trappola anti-spam
    if (!STRIPE_KEY && !SIMULATED_PAYMENTS) return send(res, 503, { error: 'Pagamenti online non ancora attivi. Scrivici su WhatsApp per iscriverti.' });
    const prodotti = await getProdotti();
    const righe = [];
    (Array.isArray(b.items) ? b.items : []).slice(0, 10).forEach(it => {
      const pr = prodotti.find(x => x.id === it.id && x.pubblicato && x.prezzo > 0);
      const qty = Math.min(MAX_QTY, Math.max(1, int(it.qty) || 1));
      if (!pr) return;
      const ex = righe.find(r => r.id === pr.id);
      if (ex) ex.qty = Math.min(MAX_QTY, ex.qty + qty); else righe.push({ id: pr.id, titolo: pr.titolo, descrizione: pr.descrizione, prezzo: pr.prezzo, qty, richiedeSpedizione: pr.richiedeSpedizione === true });
    });
    const nome = str(b.nome, 120), email = str(b.email, 160), tel = str(b.tel, 40);
    const codiceFiscale = str(b.codiceFiscale, 32).replace(/\s/g, '').toUpperCase();
    const indirizzo = b.spedizione && typeof b.spedizione === 'object' ? b.spedizione : {};
    const richiedeSpedizione = righe.some(r => r.richiedeSpedizione);
    const spedizione = richiedeSpedizione ? {
      via: str(indirizzo.via, 180), cap: str(indirizzo.cap, 5),
      citta: str(indirizzo.citta, 100), provincia: str(indirizzo.provincia, 80), paese: 'IT',
    } : null;
    if (!righe.length) return send(res, 400, { error: 'Il carrello è vuoto.' });
    if (!nome || !/\S+@\S+\.\S+/.test(email) || tel.length < 5) return send(res, 400, { error: 'Inserisci nome, email e telefono.' });
    if (!/^(?:[A-Z0-9]{16}|\d{11})$/.test(codiceFiscale)) return send(res, 400, { error: 'Inserisci un codice fiscale valido.' });
    if (richiedeSpedizione && (!spedizione.via || !/^\d{5}$/.test(spedizione.cap) || !spedizione.citta || !spedizione.provincia)) {
      return send(res, 400, { error: 'Inserisci un indirizzo di consegna completo in Italia.' });
    }
    if (b.accetto !== true) return send(res, 400, { error: 'Devi accettare le condizioni per procedere.' });
    const totale = righe.reduce((s, r) => s + r.prezzo * r.qty, 0);
    const lang = b.lang === 'en' ? 'en' : 'it';
    const ordine = {
      id: crypto.randomUUID(), data: new Date().toISOString(), stato: SIMULATED_PAYMENTS ? 'simulato' : 'in attesa',
      nome, email, tel, codiceFiscale, spedizione, lang,
      righe: righe.map(r => ({ id: r.id, titolo: r.titolo, prezzo: r.prezzo, qty: r.qty, richiedeSpedizione: r.richiedeSpedizione })), totale,
      stripeSessionId: '', metodo: SIMULATED_PAYMENTS ? 'simulato' : '', simulato: SIMULATED_PAYMENTS,
    };
    if (SIMULATED_PAYMENTS) {
      const list = await load('ordini', []);
      list.unshift(ordine);
      await save('ordini', list.slice(0, 5000));
      return send(res, 201, { simulato: true, ordineId: ordine.id });
    }
    const base = siteUrl(req);
    const params = {
      mode: 'payment', locale: lang, customer_email: email, billing_address_collection: 'auto',
      success_url: base + '/?ordine=ok&o=' + ordine.id + '&session_id={CHECKOUT_SESSION_ID}#shop',
      cancel_url: base + '/?ordine=annullato#shop',
      metadata: { ordine_id: ordine.id },
      payment_intent_data: { description: 'Chef on Board — ordine ' + ordine.id.slice(0, 8), metadata: { ordine_id: ordine.id } },
      line_items: righe.map(r => ({
        quantity: r.qty,
        price_data: { currency: 'eur', unit_amount: r.prezzo, product_data: { name: r.titolo, description: r.descrizione ? r.descrizione.slice(0, 300) : undefined } },
      })),
    };
    const s = await stripe('POST', '/v1/checkout/sessions', params);
    ordine.stripeSessionId = s.id;
    const list = await load('ordini', []);
    list.unshift(ordine);
    await save('ordini', list.slice(0, 5000));
    return send(res, 201, { url: s.url });
  }

  // Pubblico: al ritorno da Stripe verifica il pagamento (funziona anche senza webhook)
  if (p === '/api/checkout/conferma' && m === 'GET') {
    const id = str(url.searchParams.get('o'), 60), sid = str(url.searchParams.get('session_id'), 200);
    const o = (await load('ordini', [])).find(x => x.id === id && x.stripeSessionId === sid);
    if (!o) return send(res, 404, { error: 'Ordine non trovato' });
    let cur = o;
    if (o.stato === 'in attesa') {
      const s = await stripe('GET', '/v1/checkout/sessions/' + encodeURIComponent(sid), { 'expand': ['payment_intent.payment_method'] });
      if (s.payment_status === 'paid') {
        const pm = s.payment_intent && s.payment_intent.payment_method && s.payment_intent.payment_method.type;
        cur = await setOrdine(id, { stato: 'pagato', pagato: new Date().toISOString(), metodo: pm || '' }, ['in attesa']) || o;
      }
    }
    return send(res, 200, { stato: cur.stato, nome: (cur.nome || '').split(' ')[0] });
  }

  // Webhook Stripe (firmato): conferma pagamenti anche se il cliente chiude la pagina
  if (p === '/api/stripe/webhook' && m === 'POST') {
    const raw = await readRaw(req);
    if (!WEBHOOK_SECRET) return send(res, 503, { error: 'STRIPE_WEBHOOK_SECRET non impostato' });
    if (!verifyStripeSig(raw, req.headers['stripe-signature'])) return send(res, 400, { error: 'Firma non valida' });
    let ev; try { ev = JSON.parse(raw.toString('utf8')); } catch (e) { return send(res, 400, { error: 'JSON non valido' }); }
    const s = ev.data && ev.data.object;
    if (s && s.metadata && s.metadata.ordine_id) {
      if (ev.type === 'checkout.session.completed') await applySession(s);
      else if (ev.type === 'checkout.session.async_payment_succeeded') await applySession({ ...s, payment_status: 'paid' });
      else if (ev.type === 'checkout.session.expired' || ev.type === 'checkout.session.async_payment_failed') await setOrdine(s.metadata.ordine_id, { stato: 'annullato' }, ['in attesa']);
    }
    return send(res, 200, { received: true });
  }

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
    const corsi = await load('corsi', []);
    const corsoId = corsi.some(c => c.id === b.corsoId) ? b.corsoId : '';
    const r = {
      id: crypto.randomUUID(), data: new Date().toISOString(),
      ...cleanContatto({ ...b, fonte: 'Sito', stato: 'nuovo', corsoId }),
      corso: str(b.corso, 200),
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

    // Shop: prodotti in vendita
    if (p === '/api/admin/prodotti' && m === 'GET') {
      return send(res, 200, { prodotti: await getProdotti(), pagamenti: !!STRIPE_KEY, webhook: !!WEBHOOK_SECRET, simulazione: SIMULATED_PAYMENTS });
    }
    if (p === '/api/admin/prodotti' && m === 'POST') {
      const pr = { id: crypto.randomUUID(), creato: new Date().toISOString(), ...cleanProdotto(await readBody(req)) };
      const list = await getStoredProdotti();
      list.push(pr); await save('prodotti', list);
      return send(res, 201, pr);
    }
    const mp = p.match(/^\/api\/admin\/prodotti\/([\w-]+)$/);
    if (mp && m === 'PUT') {
      const list = await getStoredProdotti();
      const i = list.findIndex(x => x.id === mp[1]);
      if (i < 0) return send(res, 404, { error: 'Prodotto non trovato' });
      list[i] = { ...list[i], ...cleanProdotto(await readBody(req)), id: list[i].id };
      await save('prodotti', list);
      return send(res, 200, list[i]);
    }
    if (mp && m === 'DELETE') {
      await save('prodotti', (await getStoredProdotti()).filter(x => x.id !== mp[1]));
      return send(res, 200, { ok: true });
    }

    // Shop: ordini
    if (p === '/api/admin/ordini' && m === 'GET') return send(res, 200, await load('ordini', []));
    const mo = p.match(/^\/api\/admin\/ordini\/([\w-]+)$/);
    if (mo && m === 'PUT') {
      const b = await readBody(req);
      if (!ORDINE_STATI.includes(b.stato)) return send(res, 400, { error: 'Stato non valido' });
      const o = await setOrdine(mo[1], { stato: b.stato }, null);
      return o ? send(res, 200, o) : send(res, 404, { error: 'Ordine non trovato' });
    }
    if (mo && m === 'DELETE') {
      await save('ordini', (await load('ordini', [])).filter(x => x.id !== mo[1]));
      return send(res, 200, { ok: true });
    }

    // Contatti (richieste dal sito + contatti inseriti a mano)
    if (p === '/api/admin/richieste' && m === 'GET') {
      return send(res, 200, (await load('richieste', [])).map(normContatto));
    }
    if (p === '/api/admin/richieste' && m === 'POST') {
      const b = cleanContatto(await readBody(req));
      if (!b.nome) return send(res, 400, { error: 'Inserisci almeno il nome del contatto.' });
      if (b.stato === 'partecipante' && !b.corsoId) return send(res, 400, { error: 'Scegli il corso a cui partecipa.' });
      const corsi = await load('corsi', []);
      if (isPart(b)) seatDelta(corsi, b.corsoId, +1);
      const r = { id: crypto.randomUUID(), data: new Date().toISOString(), ...b };
      const list = await load('richieste', []);
      list.unshift(r);
      await save('richieste', list);
      if (isPart(b)) await save('corsi', corsi);
      return send(res, 201, r);
    }
    const mr = p.match(/^\/api\/admin\/richieste\/([\w-]+)$/);
    if (mr && (m === 'PUT' || m === 'DELETE')) {
      const list = (await load('richieste', [])).map(normContatto);
      const i = list.findIndex(x => x.id === mr[1]);
      if (i < 0) return send(res, 404, { error: 'Contatto non trovato' });
      const corsi = await load('corsi', []);
      const before = list[i];
      if (m === 'DELETE') {
        if (isPart(before)) seatDelta(corsi, before.corsoId, -1);
        list.splice(i, 1);
      } else {
        const b = await readBody(req);
        // aggiornamento parziale: si possono mandare solo i campi da cambiare (es. solo lo stato)
        const after = { ...before, ...cleanContatto({ ...before, ...b }), id: before.id, data: before.data, corso: before.corso };
        if (!after.nome) return send(res, 400, { error: 'Il nome non può essere vuoto.' });
        if (after.stato === 'partecipante' && !after.corsoId) return send(res, 400, { error: 'Scegli il corso a cui partecipa.' });
        const wasP = isPart(before), isP = isPart(after);
        if (wasP && (!isP || before.corsoId !== after.corsoId)) seatDelta(corsi, before.corsoId, -1);
        if (isP && (!wasP || before.corsoId !== after.corsoId)) seatDelta(corsi, after.corsoId, +1);
        list[i] = after;
      }
      await save('richieste', list);
      await save('corsi', corsi);
      return send(res, 200, m === 'DELETE' ? { ok: true } : list[i]);
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
    if (COMING_SOON && !url.pathname.startsWith('/api/admin/') && !CS_API.includes(url.pathname)) return send(res, 404, { error: 'Non disponibile' });
    try { await api(req, res, url); }
    catch (e) {
      if (e.code === 409 || e.code === 502 || e.code === 503) return send(res, e.code, { error: e.message });
      send(res, e.message === 'too_large' ? 413 : 400, { error: 'Richiesta non valida' });
    }
    return;
  }
  serveStatic(req, res, url.pathname);
}).listen(PORT, '0.0.0.0', () => {
  console.log('Chef on Board attivo sulla porta ' + PORT + (DB_URL ? ' (Replit Database)' : ' (file in ./data)'));
  if (!process.env.ADMIN_PASSWORD) console.log('ATTENZIONE: imposta ADMIN_PASSWORD nei Secrets per usare /admin');
  if (COMING_SOON) console.log('MODALITÀ "PRESTO ONLINE": il pubblico vede solo la pagina di attesa');
  if (SIMULATED_PAYMENTS) console.log('Pagamenti: modalità simulata attiva, nessun addebito reale');
  else if (!STRIPE_KEY) console.log('Pagamenti: imposta STRIPE_SECRET_KEY nei Secrets per attivare il carrello');
});
