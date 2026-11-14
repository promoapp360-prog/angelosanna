'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { emailValid } = require('./order-emails');
const { customerOrder, inOrderEnvironment } = require('./order-reference');
const scrypt = promisify(crypto.scrypt);
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const clean = (value, max = 180) => String(value == null ? '' : value).trim().slice(0, max);
const fail = (message, code = 400) => Object.assign(new Error(message), { code });
const profileFields = value => {
  const p = value || {}, a = p.indirizzo || {};
  const codiceFiscale = clean(p.codiceFiscale, 32).replace(/\s/g, '').toUpperCase();
  if (codiceFiscale && !/^(?:[A-Z0-9]{16}|\d{11})$/.test(codiceFiscale)) throw fail('Codice fiscale non valido.');
  return { nome: clean(p.nome, 120), tel: clean(p.tel, 40), codiceFiscale,
    indirizzo: { via: clean(a.via), cap: clean(a.cap, 10), citta: clean(a.citta, 100),
      provincia: clean(a.provincia, 80).toUpperCase(), paese: 'IT' } };
};

function createCustomerAccounts({ load, save, mailer, live, now = Date.now }) {
  const key = 'customer_accounts_' + (live ? 'live' : 'test');
  let writes = Promise.resolve();
  const read = () => load(key, { users: [], sessions: [], proofs: [], profiles: {} });
  function mutate(action) {
    const operation = writes.then(async () => {
      const state = await read();
      state.sessions = state.sessions.filter(x => x.expires > now());
      state.proofs = state.proofs.filter(x => x.expires > now());
      const result = await action(state);
      await save(key, state);
      return result;
    });
    writes = operation.catch(() => {});
    return operation;
  }
  const ordersFor = async email => (await load('ordini', []))
    .filter(o => normalizeEmail(o.email) === email && inOrderEnvironment(o, live));
  function passwordValid(password) {
    if (typeof password !== 'string' || password.length < 6 || password.length > 128)
      throw fail('Usa una password di almeno 6 caratteri (massimo 128).');
  }
  async function passwordHash(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
  }
  async function matches(password, hash) {
    const [salt, value] = String(hash || '').split(':');
    if (!salt || !/^[a-f0-9]{128}$/.test(value || '') || typeof password !== 'string' || password.length > 128) return false;
    return crypto.timingSafeEqual(await scrypt(password, salt, 64), Buffer.from(value, 'hex'));
  }
  async function notify(email, type, token, base, lang) {
    if (!mailer.ready || typeof mailer.sendAccount !== 'function') throw fail('Servizio email temporaneamente non disponibile.', 503);
    const en = lang === 'en';
    const link = base + '/cliente?' + (type === 'verify' ? 'verifica=' : 'recupero=') + encodeURIComponent(token);
    await mailer.sendAccount({
      to: email,
      subject: type === 'verify' ? (en ? 'Verify your Chef on Board account' : 'Conferma il tuo account Chef on Board')
        : (en ? 'Reset your Chef on Board password' : 'Recupera la password Chef on Board'),
      text: (type === 'verify'
        ? (en ? 'Confirm your email address to access your purchases:' : 'Conferma il tuo indirizzo email per accedere ai tuoi acquisti:')
        : (en ? 'Choose a new password using this link:' : 'Scegli una nuova password usando questo link:')) +
        '\n\n' + link + '\n\n' + (en
          ? 'This link expires in one hour and can only be used once. If you did not request it, ignore this message.'
          : 'Il link scade tra un’ora e può essere usato una sola volta. Se non hai richiesto questa operazione, ignora il messaggio.') +
        '\n\nChef Angelo Sanna',
    });
  }
  function proof(state, user, type) {
    const token = crypto.randomBytes(32).toString('hex');
    state.proofs = state.proofs.filter(x => !(x.userId === user.id && x.type === type));
    state.proofs.push({ userId: user.id, type, hash: digest(token), expires: now() + 3600000 });
    return token;
  }
  async function register({ email, password, lang }, base) {
    email = normalizeEmail(email);
    if (!emailValid(email) || email.length > 160) throw fail('Inserisci un indirizzo email valido.');
    passwordValid(password);
    if (!mailer.ready || !mailer.sendAccount) throw fail('Servizio email temporaneamente non disponibile.', 503);
    const hash = await passwordHash(password);
    const result = await mutate(state => {
      let user = state.users.find(u => u.email === email);
      if (user && user.verified) return null;
      if (!user) {
        user = { id: crypto.randomUUID(), email, created: new Date(now()).toISOString(), verified: false };
        state.users.push(user);
      }
      user.password = hash; user.lang = lang === 'en' ? 'en' : 'it';
      return { token: proof(state, user, 'verify'), lang: user.lang };
    });
    if (result) await notify(email, 'verify', result.token, base, result.lang);
  }
  async function requestLink(email, type, base, lang) {
    email = normalizeEmail(email);
    if (!emailValid(email)) throw fail('Inserisci un indirizzo email valido.');
    if (!mailer.ready || !mailer.sendAccount) throw fail('Servizio email temporaneamente non disponibile.', 503);
    const result = await mutate(state => {
      const user = state.users.find(u => u.email === email);
      if (!user || (type === 'verify' && user.verified)) return null;
      return { token: proof(state, user, type), lang: user.lang || lang };
    });
    if (result) await notify(email, type, result.token, base, result.lang);
  }
  async function consume(token, type, password) {
    if (!/^[a-f0-9]{64}$/.test(String(token || ''))) throw fail('Link non valido o scaduto.');
    if (type === 'reset') passwordValid(password);
    const hash = type === 'reset' ? await passwordHash(password) : null;
    return mutate(async state => {
      const found = state.proofs.find(x => x.hash === digest(token) && x.type === type);
      if (!found) throw fail('Link non valido o scaduto.');
      const user = state.users.find(u => u.id === found.userId);
      if (!user) throw fail('Link non valido o scaduto.');
      if (type === 'reset') {
        user.password = hash;
        state.sessions = state.sessions.filter(x => x.userId !== user.id);
      }
      user.verified = true;
      state.proofs = state.proofs.filter(x => x.userId !== user.id);
      if (!state.profiles[user.email]) {
        const latest = (await ordersFor(user.email))[0];
        if (latest) state.profiles[user.email] = profileFields({ ...latest, indirizzo: latest.indirizzo || latest.spedizione });
      }
      return { email: user.email };
    });
  }
  async function login(email, password) {
    email = normalizeEmail(email);
    const state = await read(), user = state.users.find(u => u.email === email);
    // Anche gli indirizzi sconosciuti eseguono scrypt, riducendo le differenze temporali.
    const dummy = '00000000000000000000000000000000:' + '00'.repeat(64);
    const ok = await matches(password, user ? user.password : dummy);
    if (!user || !ok) throw fail('Email o password non corretti.', 401);
    if (!user.verified) throw fail('Conferma prima la tua email. Puoi richiedere un nuovo link.', 403);
    const token = crypto.randomBytes(32).toString('hex');
    await mutate(current => {
      const currentUser = current.users.find(u => u.id === user.id);
      if (!currentUser || currentUser.password !== user.password) throw fail('Riprova ad accedere.', 401);
      current.sessions = current.sessions.filter(x => x.userId !== user.id).slice(-9999);
      current.sessions.push({ hash: digest(token), userId: user.id, expires: now() + 7 * 86400000 });
    });
    return token;
  }
  async function identify(token) {
    if (!/^[a-f0-9]{64}$/.test(String(token || ''))) throw fail('Accedi alla tua area cliente.', 401);
    const state = await read();
    const session = state.sessions.find(s => s.hash === digest(token) && s.expires > now());
    const user = session && state.users.find(u => u.id === session.userId && u.verified);
    if (!user) throw fail('Sessione scaduta. Accedi di nuovo.', 401);
    return { user, profile: state.profiles[user.email] || profileFields({}) };
  }
  async function me(token) {
    const { user, profile } = await identify(token);
    return { email: user.email, ...profile, ordini: (await ordersFor(user.email)).map(customerOrder) };
  }
  async function edit(email, value) {
    const profile = profileFields(value);
    if (!profile.nome) throw fail('Inserisci nome e cognome.');
    const address = profile.indirizzo;
    if ((address.via || address.cap || address.citta || address.provincia) &&
      (!address.via || !/^\d{5}$/.test(address.cap) || !address.citta || !address.provincia))
      throw fail('Completa l’indirizzo con via, CAP, città e provincia.');
    await mutate(state => { state.profiles[email] = profile; });
    return profile;
  }
  async function customers() {
    const state = await read(), map = new Map();
    for (const o of (await load('ordini', [])).filter(o => inOrderEnvironment(o, live))) {
      const email = normalizeEmail(o.email);
      if (!emailValid(email)) continue;
      if (!map.has(email)) map.set(email, { email, ...profileFields({ ...o, indirizzo: o.indirizzo || o.spedizione }), ordini: [] });
      map.get(email).ordini.push(customerOrder(o));
    }
    for (const email of new Set([...Object.keys(state.profiles), ...state.users.map(u => u.email)])) {
      if (!map.has(email)) map.set(email, { email, ...profileFields({}), ordini: [] });
      Object.assign(map.get(email), state.profiles[email] || {});
    }
    return [...map.values()].map(row => {
      const user = state.users.find(u => u.email === row.email);
      return { ...row, id: digest(row.email).slice(0, 24), account: user ? (user.verified ? 'Verificato' : 'Da verificare') : 'Ospite',
        registrato: user ? user.created : null, totaleAcquisti: row.ordini.filter(o => o.stato === 'pagato').reduce((s, o) => s + o.totale, 0) };
    }).sort((a, b) => a.nome.localeCompare(b.nome));
  }
  return { register, requestLink, consume, login, me, identify, edit, customers,
    async logout(token) { await mutate(state => { state.sessions = state.sessions.filter(s => s.hash !== digest(token)); }); },
    async updateProfile(token, profile) { const { user } = await identify(token); return edit(user.email, profile); },
    async adminEdit(id, profile) {
      const customer = (await customers()).find(c => c.id === id);
      if (!customer) throw fail('Cliente non trovato.', 404);
      return edit(customer.email, profile);
    },
    async adminCreate(profile) {
      const email = normalizeEmail(profile.email);
      if (!emailValid(email) || email.length > 160) throw fail('Inserisci un indirizzo email valido.');
      return edit(email, profile);
    },
  };
}

module.exports = { createCustomerAccounts, normalizeEmail };
