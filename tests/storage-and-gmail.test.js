'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStorage } = require('../storage');
const { createGmailOrderMailer } = require('../gmail-mailer');
const { OWNER_EMAIL } = require('../order-emails');

function fakePool(initial = []) {
  const rows = new Map(initial), calls = [];
  return { rows, calls, async query(sql, params) {
    calls.push({ sql, params });
    assert.doesNotMatch(sql, /\b(CREATE|ALTER|DROP)\b/);
    if (sql.startsWith('SELECT')) return { rows: rows.has(params[0]) ? [{ value: rows.get(params[0]) }] : [] };
    if (!rows.has(params[0]) || sql.includes('DO UPDATE')) rows.set(params[0], JSON.parse(params[1]));
    return { rows: [] };
  } };
}

test('PostgreSQL importa una chiave precedente senza cancellare la sorgente', async () => {
  const pool = fakePool();
  let reads = 0;
  const old = [{ id: 'example-course', titolo: 'Corso esistente' }];
  const storage = createStorage({ pool, legacyUrl: 'https://legacy.invalid', transport: async () => {
    reads++;
    return new Response(JSON.stringify(old));
  } });
  assert.equal(storage.backend, 'PostgreSQL');
  assert.equal(storage.persistent, true);
  assert.deepEqual(await storage.load('corsi', []), old);
  assert.deepEqual(await storage.load('corsi', []), old);
  assert.equal(reads, 1);
  assert.deepEqual(pool.rows.get('corsi'), old);
  assert.ok(pool.calls.every(c => c.params[0] === 'corsi'));
});

test('un archivio PostgreSQL volutamente vuoto non viene ripopolato dalla sorgente', async () => {
  const pool = fakePool([['corsi', []]]);
  const storage = createStorage({ pool, legacyUrl: 'https://legacy.invalid',
    transport: async () => { throw new Error('La sorgente non va letta'); } });
  assert.deepEqual(await storage.load('corsi', ['stale']), []);
  await storage.save('flag', false);
  assert.equal(await storage.load('flag', true), false);
});

test('PostgreSQL salva con parametri e gli errori non ripiegano sui file', async () => {
  const pool = fakePool();
  const storage = createStorage({ pool, dataDir: '/not-used' });
  const key = "ordini'; DROP TABLE anything;--";
  await storage.save(key, [{ id: 'unit-order' }]);
  assert.equal(pool.calls.length, 1);
  assert.doesNotMatch(pool.calls[0].sql, /anything/);
  assert.equal(pool.calls[0].params[0], key);
  const failed = createStorage({ pool: { async query() { throw new Error('unavailable'); } },
    transport: async () => { throw new Error('fallback prohibited'); }, legacyUrl: 'https://legacy.invalid' });
  await assert.rejects(failed.load('ordini', []), /unavailable/);
  await assert.rejects(failed.save('ordini', []), /unavailable/);
});

test('importazione file non distruttiva e chiavi assenti non inventate', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-storage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'prodotti.json'), '[{"id":"unit"}]');
  const pool = fakePool(), storage = createStorage({ pool, dataDir: dir });
  assert.deepEqual(await storage.load('prodotti', []), [{ id: 'unit' }]);
  assert.deepEqual(await storage.load('corsi', []), []);
  assert.equal(pool.rows.has('corsi'), false);
  assert.equal(fs.readFileSync(path.join(dir, 'prodotti.json'), 'utf8'), '[{"id":"unit"}]');
});

const order = {
  id: 'unit-gmail-order', data: '2026-11-14T10:00:00Z', nome: 'Cliente Test', email: 'buyer@example.com',
  tel: '0000000000', codiceFiscale: 'UNITCF0000000000', lang: 'it',
  righe: [{ titolo: 'Prodotto di prova', qty: 1, prezzo: 89000 }], totale: 89500, subtotale: 89000,
  costoSpedizione: 500, spedizione: { via: 'Via Esempio 1', cap: '07100', citta: 'Sassari', provincia: 'SS' },
};
function gmailFake({ failAuth = false, rejected = false } = {}) {
  const sent = [], options = [];
  let verifies = 0;
  const mailer = createGmailOrderMailer({
    appPassword: 'abcd efgh ijkl mnop', user: 'wrong-account@example.com',
    createTransport(config) {
      options.push(config);
      return {
        async verify() { verifies++; if (failAuth) throw new Error('private smtp credential must stay hidden'); return true; },
        async sendMail(message) {
          sent.push(message);
          return { messageId: message.messageId, accepted: rejected ? [] : message.to, rejected: rejected ? message.to : [] };
        },
      };
    },
  });
  return { mailer, sent, options, verifies: () => verifies };
}

test('Gmail usa esclusivamente Angelo, TLS e password dedicata: nessun account globale', async () => {
  const a = gmailFake();
  assert.equal(a.mailer.ready, true);
  assert.equal(a.options[0].auth.user, OWNER_EMAIL);
  assert.equal(a.options[0].secure, true);
  assert.equal(a.options[0].host, 'smtp.gmail.com');
  await a.mailer.verify();
  await a.mailer.send(order, 'angelo');
  await a.mailer.send(order, 'cliente');
  assert.equal(a.verifies(), 1);
  assert.deepEqual(a.sent.map(m => m.to[0]), [OWNER_EMAIL, order.email]);
  assert.ok(a.sent.every(m => m.from.address === OWNER_EMAIL && m.replyTo === OWNER_EMAIL));
  assert.match(a.sent[0].text, /UNITCF0000000000/);
  assert.doesNotMatch(a.sent[1].text, /UNITCF0000000000/);
  assert.match(a.sent[1].text, /Via Esempio 1/);
});

test('Gmail non invia se autenticazione manca o fallisce, senza mostrare errori privati', async () => {
  const absent = createGmailOrderMailer({ appPassword: '', createTransport() { throw new Error('not called'); } });
  assert.equal(absent.ready, false);
  await assert.rejects(absent.verify(), error => error.code === 503);
  const a = gmailFake({ failAuth: true });
  await assert.rejects(a.mailer.send(order, 'cliente'), error =>
    error.code === 503 && !/credential/.test(error.message));
  assert.equal(a.sent.length, 0);
});

test('Gmail conferma solo destinatari accettati e usa ID messaggio stabili nei retry', async () => {
  const a = gmailFake();
  const first = await a.mailer.send(order, 'cliente');
  assert.equal(await a.mailer.send(order, 'cliente'), first);
  assert.notEqual(await a.mailer.send(order, 'angelo'), first);
  const rejected = gmailFake({ rejected: true });
  await assert.rejects(rejected.mailer.send(order, 'cliente'), error => error.code === 503);
  await assert.rejects(a.mailer.send(order, 'unknown'), error => error.code === 503);
  const before = a.sent.length;
  await assert.rejects(a.mailer.send({ ...order, email: 'extra,buyer@example.com' }, 'cliente'), error => error.code === 503);
  assert.equal(a.sent.length, before);
});
