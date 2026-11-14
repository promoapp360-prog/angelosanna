'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCustomerAccounts } = require('../customer-accounts');
const { createCustomerRoutes } = require('../customer-routes');
const clone = value => JSON.parse(JSON.stringify(value));
const email = 'buyer@example.com', password = 'abc123';
const order = { id: 'guest-order', numero: 'COB-2026-000001', data: '2026-11-14T10:00:00Z',
  email, nome: 'Cliente Esempio', tel: '3200000000', codiceFiscale: '', indirizzo: { via: 'Via Esempio 1', cap: '07100', citta: 'Sassari', provincia: 'SS' },
  righe: [{ titolo: 'Prodotto', qty: 1, prezzo: 2000 }], totale: 2700, subtotale: 2000, costoSpedizione: 700, stato: 'pagato' };
function fixture() {
  let time = 1800000000000;
  const store = new Map([['ordini', [order, { ...order, id: 'foreign', email: 'other@example.com' },
    { ...order, id: 'sandbox-only', sandbox: true }]]]), emails = [];
  const deps = { load: async (k, d) => clone(store.has(k) ? store.get(k) : d),
    save: async (k, v) => { store.set(k, clone(v)); }, live: true, now: () => time,
    mailer: { ready: true, async sendAccount(message) { emails.push(message); } } };
  const accounts = createCustomerAccounts(deps);
  const token = () => emails.at(-1).text.match(/(?:verifica|recupero)=([a-f0-9]{64})/)[1];
  const register = () => accounts.register({ email: 'BUYER@example.com', password }, 'https://shop.example.com');
  const verified = async () => { await register(); await accounts.consume(token(), 'verify'); return accounts.login(email, password); };
  return { accounts, deps, store, emails, token, register, verified, advance(ms) { time += ms; } };
}
test('registrazione facoltativa: password di sei caratteri accettata, hash e token mai in chiaro', async () => {
  const f = fixture();
  await f.register();
  const saved = JSON.stringify(f.store.get('customer_accounts_live'));
  assert.ok(!saved.includes(password)); assert.ok(!saved.includes(f.token()));
  await assert.rejects(f.accounts.login(email, password), { code: 403 });
  assert.equal(f.emails[0].to, email);
  await assert.rejects(f.accounts.register({ email, password: '12345' }, 'https://shop.example.com'), { code: 400 });
});
test('verifica email obbligatoria e storico limitato al titolare e all’ambiente live', async () => {
  const f = fixture(), session = await f.verified();
  const me = await f.accounts.me(session);
  assert.equal(me.email, email); assert.equal(me.nome, order.nome);
  assert.deepEqual(me.ordini.map(o => o.id), [order.id]);
  assert.equal(me.ordini[0].numero, order.numero);
  const saved = JSON.stringify(f.store.get('customer_accounts_live'));
  assert.ok(!saved.includes(session));
  assert.ok(!JSON.stringify(me).includes('password'));
  assert.equal((await createCustomerAccounts(f.deps).me(session)).email, email);
});
test('i link sono monouso e scadono, senza dare accesso alle anagrafiche', async () => {
  const f = fixture(); await f.register(); const token = f.token();
  f.advance(3600001); await assert.rejects(f.accounts.consume(token, 'verify'), { code: 400 });
  await f.accounts.requestLink(email, 'verify', 'https://shop.example.com');
  const fresh = f.token(); await f.accounts.consume(fresh, 'verify');
  await assert.rejects(f.accounts.consume(fresh, 'verify'), { code: 400 });
  await assert.rejects(f.accounts.me(fresh), { code: 401 });
});
test('recupero password revoca le sessioni e non rivela account sconosciuti', async () => {
  const f = fixture(), session = await f.verified();
  await f.accounts.requestLink('unknown@example.com', 'reset', 'https://shop.example.com'); assert.equal(f.emails.length, 1);
  await f.accounts.requestLink(email, 'reset', 'https://shop.example.com'); const reset = f.token();
  await f.accounts.consume(reset, 'reset', 'new123');
  await assert.rejects(f.accounts.me(session), { code: 401 });
  await assert.rejects(f.accounts.login(email, password), { code: 401 });
  assert.ok(await f.accounts.login(email, 'new123'));
  await assert.rejects(f.accounts.consume(reset, 'reset', 'xyz123'), { code: 400 });
});
test('non si può sovrascrivere un account verificato con una nuova registrazione', async () => {
  const f = fixture(); await f.verified();
  await f.accounts.register({ email, password: 'wrong1' }, 'https://shop.example.com');
  assert.equal(f.emails.length, 1); assert.ok(await f.accounts.login(email, password));
  await assert.rejects(f.accounts.login(email, 'wrong1'), { code: 401 });
});
test('profilo modificabile con codice fiscale facoltativo, senza modificare gli ordini', async () => {
  const f = fixture(), session = await f.verified();
  await f.accounts.updateProfile(session, { ...order, nome: 'Nuovo Nome', codiceFiscale: '' });
  assert.equal((await f.accounts.me(session)).nome, 'Nuovo Nome');
  assert.equal(f.store.get('ordini')[0].nome, order.nome);
  await assert.rejects(f.accounts.updateProfile(session, { ...order, codiceFiscale: 'INVALIDO' }), { code: 400 });
  await assert.rejects(f.accounts.updateProfile(session, { nome: 'Nome', indirizzo: { cap: '07100' } }), { code: 400 });
});
test('l’admin vede clienti ospiti, account e ordini senza password o prove email', async () => {
  const f = fixture(); await f.verified();
  let rows = await f.accounts.customers(); const buyer = rows.find(c => c.email === email);
  assert.equal(buyer.account, 'Verificato'); assert.equal(buyer.ordini.length, 1); assert.equal(buyer.totaleAcquisti, 2700);
  assert.equal(rows.find(c => c.email === 'other@example.com').account, 'Ospite');
  assert.ok(!JSON.stringify(rows).includes('password')); assert.ok(!JSON.stringify(rows).includes(f.token()));
  await f.accounts.adminEdit(buyer.id, { ...order, nome: 'Anagrafica Aggiornata' });
  assert.equal((await f.accounts.customers()).find(c => c.email === email).nome, 'Anagrafica Aggiornata');
  await f.accounts.adminCreate({ email: 'new@example.com', nome: 'Nuovo Cliente' });
  rows = await f.accounts.customers(); assert.equal(rows.find(c => c.email === 'new@example.com').account, 'Ospite');
  assert.equal(f.store.get('customer_accounts_live').users.length, 1);
});
test('logout e scadenza invalidano le sessioni cliente persistenti', async () => {
  const f = fixture(), session = await f.verified();
  await f.accounts.logout(session); await assert.rejects(f.accounts.me(session), { code: 401 });
  const second = await f.accounts.login(email, password); f.advance(7 * 86400000 + 1);
  await assert.rejects(f.accounts.me(second), { code: 401 });
});
function httpFixture(accounts) {
  const route = createCustomerRoutes({ accounts, siteUrl: () => 'https://shop.example.com',
    clientIp: req => req.ip, readBody: async req => req.body,
    send(res, status, body) { res.status = status; res.body = body; } });
  return async (method, action, body, headers = {}, ip = '127.0.0.1') => {
    const req = { method, ip, body, headers: { 'content-type': 'application/json', ...headers } };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    await route(req, res, new URL('/api/cliente/' + action, 'https://shop.example.com')); return res;
  };
}
test('le rotte cliente usano cookie HttpOnly Secure e respingono CSRF e token admin', async () => {
  const f = fixture(); await f.verified(); const request = httpFixture(f.accounts);
  const blocked = await request('POST', 'accedi', { email, password }, { origin: 'https://attacker.example' });
  assert.equal(blocked.status, 403);
  assert.equal((await request('POST', 'accedi', { email, password }, { 'content-type': 'text/plain' })).status, 415);
  const login = await request('POST', 'accedi', { email, password }, { origin: 'https://shop.example.com' });
  assert.equal(login.status, 200); assert.match(login.headers['Set-Cookie'], /HttpOnly; SameSite=Lax; Max-Age=604800; Secure/);
  const cookie = login.headers['Set-Cookie'].split(';')[0];
  assert.equal((await request('GET', 'me', null, { cookie })).body.email, email);
  assert.equal((await request('GET', 'me', null, { authorization: 'Bearer admin-token' })).status, 401);
  assert.equal((await request('POST', 'esci', {}, { cookie })).status, 200);
  assert.equal((await request('GET', 'me', null, { cookie })).status, 401);
});
test('i tentativi di accesso sono limitati anche cambiando indirizzo IP', async () => {
  const f = fixture(), request = httpFixture(f.accounts);
  for (let i = 0; i < 10; i++) assert.equal((await request('POST', 'accedi', { email, password }, {}, 'ip' + i)).status, 401);
  assert.equal((await request('POST', 'accedi', { email, password }, {}, 'different-ip')).status, 429);
});
