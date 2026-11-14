const test = require('node:test');
const assert = require('node:assert/strict');
const { orderMessage, createOrderMailer } = require('../order-emails');
const { createOrderNotifications } = require('../order-notifications');

const original = {
  id: 'order-email-unit', data: '2026-11-13T10:00:00.000Z', pagato: '2026-11-13T10:01:00.000Z',
  stato: 'pagato', emailRichiesta: true, nome: 'Cliente <script>', email: 'customer@example.com',
  tel: '0000000000', codiceFiscale: '00000000000', totale: 89000, stripeSessionId: 'cs_live_unit',
  righe: [{ titolo: 'Corso <speciale>', prezzo: 44500, qty: 2 }],
  spedizione: { via: 'Via di prova 1', cap: '07100', citta: 'Sassari', provincia: 'SS', paese: 'IT' },
};

test('il corso include l’indirizzo anagrafico nelle email senza indicare una consegna', () => {
  const course = { ...original, indirizzo: original.spedizione, spedizione: null };
  const owner = orderMessage(course, 'angelo');
  const customer = orderMessage({ ...course, lang: 'en' }, 'cliente');
  assert.match(owner.text, /Indirizzo intestatario \(Italia\):/);
  assert.match(customer.text, /Customer address \(Italy\):/);
  assert.match(owner.text, /Via di prova 1/);
  assert.match(customer.text, /07100 Sassari \(SS\)/);
  assert.doesNotMatch(owner.text, /Indirizzo di consegna/);
  assert.doesNotMatch(customer.text, /Codice fiscale|00000000000/);
});

function queue({ failCustomer = false, ready = true, overrides = {} } = {}) {
  let saved = { ...structuredClone(original), ...overrides };
  let timestamp = Date.parse('2026-11-13T11:00:00Z');
  const calls = [];
  const mailer = { ready, async send(order, role) {
    calls.push(role);
    if (role === 'cliente' && failCustomer) throw new Error('private_credentials_not_to_be_stored');
    return 'email_' + role;
  } };
  const config = { mailer, enabled: true, now: () => timestamp,
    loadOrders: async () => [structuredClone(saved)],
    updateOrder: async (_, patch) => { saved = { ...saved, ...structuredClone(patch) }; return saved; } };
  return {
    notifications: createOrderNotifications(config), calls,
    order: () => saved,
    restart: () => createOrderNotifications(config),
    advance: ms => { timestamp += ms; },
    fix: () => { failCustomer = false; },
  };
}

test('i messaggi contengono riepilogo e consegna; solo Angelo riceve i dati fiscali', () => {
  const owner = orderMessage(original, 'angelo'), customer = orderMessage(original, 'cliente');
  assert.deepEqual(owner.to, ['yachtchefangelosanna@gmail.com']);
  assert.deepEqual(customer.to, ['customer@example.com']);
  assert.match(owner.text, /Codice fiscale: 00000000000/);
  assert.match(owner.text, /Telefono: 0000000000/);
  assert.doesNotMatch(customer.text, /Codice fiscale/);
  assert.match(customer.text, /Via di prova 1/);
  assert.match(customer.text, /890,00/);
  assert.match(customer.html, /&lt;script&gt;/);
  assert.doesNotMatch(customer.html, /<script>/);
  const en = orderMessage({ ...original, lang: 'en' }, 'cliente');
  assert.match(en.subject, /Your Chef on Board order/);
  assert.match(en.text, /Total paid/);
});

test('Resend riceve due messaggi separati con chiavi stabili, senza destinatari condivisi', async () => {
  const calls = [];
  const mailer = createOrderMailer({ apiKey: 're_unit_fake', from: 'orders@example.com',
    transport: async (url, options) => { calls.push({ url, options }); return new Response('{"id":"email-unit"}'); } });
  assert.equal(mailer.ready, true);
  await mailer.send(original, 'angelo');
  await mailer.send(original, 'cliente');
  await mailer.send(original, 'cliente');
  assert.equal(calls[1].options.headers['Idempotency-Key'], calls[2].options.headers['Idempotency-Key']);
  assert.notEqual(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.from, 'Chef Angelo Sanna <orders@example.com>');
  assert.equal(payload.reply_to, 'yachtchefangelosanna@gmail.com');
  assert.equal(payload.bcc, undefined);
  assert.equal(payload.to.length, 1);
  assert.doesNotMatch(payload.html, /re_unit_fake/);
});

test('le credenziali non finiscono negli errori del trasporto', async () => {
  const mailer = createOrderMailer({ apiKey: 're_private_unit', from: 'orders@example.com',
    transport: async () => { throw new Error('re_private_unit'); } });
  await assert.rejects(mailer.send(original, 'cliente'), error => !error.message.includes('re_private_unit'));
});

test('notifiche contemporanee e duplicate non reinviano email già accettate', async () => {
  const q = queue();
  await Promise.all([q.notifications.send(original.id), q.notifications.send(original.id)]);
  await q.notifications.send(original.id);
  assert.deepEqual(q.calls, ['angelo', 'cliente']);
  assert.equal(q.order().emailOrdine.angelo.stato, 'inviata');
});

test('il riavvio conserva gli esiti e riprova solo il cliente dopo l’attesa programmata', async () => {
  const q = queue({ failCustomer: true });
  assert.equal((await q.notifications.send(original.id)).ok, false);
  assert.equal(q.order().stato, 'pagato');
  assert.equal(q.order().emailOrdine.cliente.stato, 'errore');
  assert.doesNotMatch(JSON.stringify(q.order()), /private_credentials/);
  q.fix();
  const restarted = q.restart();
  await restarted.retryPending();
  assert.equal(q.calls.length, 2);
  q.advance(61000);
  await restarted.retryPending();
  assert.deepEqual(q.calls, ['angelo', 'cliente', 'cliente']);
  assert.equal(q.order().emailOrdine.cliente.stato, 'inviata');
});

test('la riprova manuale agisce solo sui destinatari mancanti', async () => {
  const q = queue({ failCustomer: true });
  await q.notifications.send(original.id);
  q.fix();
  assert.equal((await q.notifications.send(original.id, true)).ok, true);
  assert.deepEqual(q.calls, ['angelo', 'cliente', 'cliente']);
});

test('ordini storici, non pagati, simulati o sandbox non generano email', async () => {
  for (const overrides of [
    { emailRichiesta: false }, { stato: 'in attesa' }, { pagato: undefined },
    { sandbox: true }, { simulato: true }, { stripeSessionId: 'cs_test_unit' },
  ]) {
    const q = queue({ overrides });
    await q.notifications.send(original.id);
    await q.notifications.retryPending();
    assert.equal(q.calls.length, 0);
  }
  const q = queue({ ready: false });
  assert.equal((await q.notifications.send(original.id)).ok, false);
  assert.equal(q.calls.length, 0);
});
