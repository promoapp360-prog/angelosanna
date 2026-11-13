// Solo moduli Node: questi test non usano chiavi reali e non contattano Stripe.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const product = { id: 'corso-online', titolo: 'Corso di prova', prezzo: 89000, categoria: 'corso', pubblicato: true, richiedeSpedizione: false };
const buyer = { items: [{ id: product.id, qty: 1 }], nome: 'Cliente Test', email: 'test@example.com', tel: '0000000000', codiceFiscale: '00000000000', maggiorenne: true };

function app({ mode = 'stripe_test', key = 'sk_test_fake_for_unit_tests', stripeResponse, stripeStatus = 200,
  liveKey = '', liveWebhook = '', liveAccountId = '', accountResponse, accountStatus = 200,
  databaseUrl = 'https://database.invalid', readStatus = 200, writeStatus = 200 } = {}) {
  const store = new Map([['prodotti', [product]], ['migrazione-prezzo-corso-online-890-v1', true]]);
  const calls = [], errors = [];
  let handler;
  const env = { PAYMENT_MODE: mode, STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: 'whsec_fake_unit_test',
    STRIPE_LIVE_SECRET_KEY: liveKey, STRIPE_LIVE_WEBHOOK_SECRET: liveWebhook, STRIPE_LIVE_ACCOUNT_ID: liveAccountId,
    ADMIN_PASSWORD: 'unit-test-only', REPLIT_DB_URL: databaseUrl };
  vm.runInNewContext(source, {
    __dirname: root, Buffer, URL, AbortSignal, process: { env },
    console: { log() {}, error(...args) { errors.push(args.join(' ')); } },
    require(name) {
      if (name === 'http') return { createServer(fn) { handler = fn; return { listen() {} }; } };
      return require(name);
    },
    async fetch(url, options = {}) {
      if (env.REPLIT_DB_URL && url.startsWith(env.REPLIT_DB_URL)) {
        if (options.method === 'POST') {
          if (writeStatus !== 200) return new Response('Unavailable', { status: writeStatus });
          for (const [key, value] of new URLSearchParams(options.body)) store.set(key, JSON.parse(value));
          return new Response('OK');
        }
        if (readStatus !== 200) return new Response('Unavailable', { status: readStatus });
        const key = decodeURIComponent(new URL(url).pathname.slice(1));
        return store.has(key) ? new Response(JSON.stringify(store.get(key))) : new Response('', { status: 404 });
      }
      calls.push({ url, options });
      if (url.endsWith('/v1/account')) return new Response(JSON.stringify(accountResponse ||
        { id: 'acct_clientunit', charges_enabled: true }), { status: accountStatus });
      const params = new URLSearchParams(options.body);
      const orderId = params.get('metadata[ordine_id]') || (store.get('ordini') || [])[0]?.id;
      const response = stripeResponse || {
        id: mode === 'live' ? 'cs_live_unit' : 'cs_test_unit', object: 'checkout.session', livemode: mode === 'live',
        url: 'https://checkout.stripe.com/c/pay/unit', payment_status: 'paid',
        amount_total: 89000, currency: 'eur', metadata: { ordine_id: orderId },
        payment_intent: { payment_method: { type: 'card' } },
      };
      return new Response(JSON.stringify(response), { status: stripeStatus });
    },
  }, { filename: 'server.js' });
  async function request(method, url, data, headers = {}) {
    const body = typeof data === 'string' ? data : data ? JSON.stringify(data) : '';
    const req = Readable.from(body ? [Buffer.from(body)] : []);
    Object.assign(req, { method, url, headers: { host: 'example.com', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
    return new Promise((resolve, reject) => {
      let status;
      const res = { setHeader() {}, writeHead(code) { status = code; }, end(text) { resolve({ status, body: JSON.parse(text || '{}') }); } };
      handler(req, res).catch(reject);
    });
  }
  return { request, store, calls, errors };
}

test('la sandbox rifiuta chiavi live o mancanti prima di contattare Stripe', async () => {
  for (const key of ['sk_live_fake_for_unit_tests', '']) {
    const a = app({ key });
    const shop = await a.request('GET', '/api/shop');
    assert.equal(shop.body.pagamenti, false);
    assert.equal(shop.body.sandbox, true);
    assert.equal((await a.request('POST', '/api/checkout', buyer)).status, 503);
    assert.equal(a.calls.length, 0);
  }
});

test('una chiave salvata senza modalità esplicita non abilita pagamenti', async () => {
  for (const key of ['sk_live_fake_for_unit_tests', 'sk_test_fake_for_unit_tests']) {
    const a = app({ mode: '', key });
    assert.equal((await a.request('GET', '/api/shop')).body.pagamenti, false);
    assert.equal((await a.request('POST', '/api/checkout', buyer)).status, 503);
    assert.equal(a.calls.length, 0);
  }
});

test('il checkout sandbox crea una sessione EUR 890 e un ordine marcato test', async () => {
  const a = app();
  const result = await a.request('POST', '/api/checkout', buyer);
  assert.equal(result.status, 201);
  assert.equal(new URL(result.body.url).hostname, 'checkout.stripe.com');
  const params = new URLSearchParams(a.calls[0].options.body);
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '89000');
  assert.equal(params.get('line_items[0][price_data][currency]'), 'eur');
  assert.equal(a.store.get('ordini')[0].sandbox, true);
  assert.equal(a.store.get('ordini')[0].stato, 'in attesa');
  assert.equal(a.store.get('ordini')[0].spedizione, null);
});

test('il checkout richiede maggiore età e dati cliente anche in sandbox', async () => {
  const a = app();
  assert.equal((await a.request('POST', '/api/checkout', { ...buyer, maggiorenne: false })).status, 400);
  assert.equal((await a.request('POST', '/api/checkout', { ...buyer, codiceFiscale: '' })).status, 400);
  assert.equal(a.calls.length, 0);
});

test('una risposta Stripe live, ambigua o con id live non viene salvata né restituita', async () => {
  for (const response of [
    { id: 'cs_test_unit', livemode: true, url: 'https://checkout.stripe.com/' },
    { id: 'cs_test_unit', url: 'https://checkout.stripe.com/' },
    { id: 'cs_live_unit', livemode: false, url: 'https://checkout.stripe.com/' },
  ]) {
    const a = app({ stripeResponse: response });
    const result = await a.request('POST', '/api/checkout', buyer);
    assert.equal(result.status, 502);
    assert.equal(result.body.url, undefined);
    assert.equal(a.store.has('ordini'), false);
  }
});

test('la conferma mantiene il contrassegno sandbox dopo il pagamento di prova', async () => {
  const a = app();
  await a.request('POST', '/api/checkout', buyer);
  const order = a.store.get('ordini')[0];
  const result = await a.request('GET', '/api/checkout/conferma?o=' + order.id + '&session_id=' + order.stripeSessionId);
  assert.equal(result.status, 200);
  assert.equal(result.body.stato, 'pagato');
  assert.equal(result.body.sandbox, true);
  assert.equal(a.store.get('ordini')[0].sandbox, true);
});

test('un webhook firmato ma live viene rifiutato in sandbox', async () => {
  const a = app();
  await a.request('POST', '/api/checkout', buyer);
  const order = a.store.get('ordini')[0];
  const payload = JSON.stringify({ type: 'checkout.session.completed', livemode: true, data: { object: { payment_status: 'paid', metadata: { ordine_id: order.id } } } });
  const t = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', 'whsec_fake_unit_test').update(t + '.' + payload).digest('hex');
  const result = await a.request('POST', '/api/stripe/webhook', payload, { 'stripe-signature': 't=' + t + ',v1=' + signature });
  assert.equal(result.status, 400);
  assert.equal(a.store.get('ordini')[0].stato, 'in attesa');
});

test('gli errori Stripe non riportano nei log il messaggio che potrebbe contenere una chiave', async () => {
  const a = app({ stripeStatus: 401, stripeResponse: { error: { message: 'Invalid API key: sk_test_private_example' } } });
  assert.equal((await a.request('POST', '/api/checkout', buyer)).status, 502);
  assert.equal(a.errors.some(e => e.includes('sk_test_private_example')), false);
});

test('la simulazione interna resta disponibile e non chiama Stripe', async () => {
  const a = app({ mode: 'simulated', key: '' });
  const result = await a.request('POST', '/api/checkout', buyer);
  assert.equal(result.status, 201);
  assert.equal(result.body.simulato, true);
  assert.equal(a.store.get('ordini')[0].sandbox, false);
  assert.equal(a.store.get('ordini')[0].stato, 'simulato');
  assert.equal(a.calls.length, 0);
});

test('l’admin distingue gli ordini sandbox e non li conta negli incassi', () => {
  const html = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
  const render = html.match(/  function renderShop\(\)\{([\s\S]*?)\n  \}\n  function openProd/);
  assert.ok(render);
  const elements = {};
  const $ = id => elements[id] || (elements[id] = { style: {} });
  const order = { data: new Date().toISOString(), nome: 'Test', email: 'test@example.com', righe: [], totale: 89000, stato: 'pagato' };
  vm.runInNewContext('function renderShop(){' + render[1] + '\n} renderShop();', {
    $, ordini: [{ ...order, sandbox: true }, { ...order, simulato: true }, order],
    prodotti: [], shopInfo: { pagamenti: true }, ORD_STATI: ['pagato'], METODI: {},
    esc: text => String(text), eur: cents => 'EUR:' + cents, stCls: () => '',
  });
  assert.equal(elements.nOrd.textContent, 1);
  assert.match(elements.payStatus.innerHTML, /EUR:89000/);
  assert.match(elements.ordList.innerHTML, /Sandbox · nessun incasso reale/);
});

const liveConfig = { mode: 'live', liveKey: 'sk_live_client_unit_test',
  liveWebhook: 'whsec_live_unit_test', liveAccountId: 'acct_clientunit' };

function signedEvent(a, event, secret = 'whsec_live_unit_test', timestamp = String(Math.floor(Date.now() / 1000))) {
  const payload = JSON.stringify(event);
  const signature = crypto.createHmac('sha256', secret).update(timestamp + '.' + payload).digest('hex');
  return a.request('POST', '/api/stripe/webhook', payload, { 'stripe-signature': 't=' + timestamp + ',v1=' + signature });
}
function paymentEvent(order, overrides = {}) {
  return { type: 'checkout.session.completed', livemode: true, data: { object: {
    id: order.stripeSessionId, metadata: { ordine_id: order.id }, amount_total: order.totale,
    currency: 'eur', livemode: true, payment_status: 'paid', ...overrides,
  } } };
}

test('il live richiede chiave dedicata, webhook e account atteso: nessun ripiego sulla sandbox', async () => {
  for (const missing of [
    { liveKey: '' }, { liveKey: 'sk_test_wrong_mode' }, { liveWebhook: '' },
    { liveAccountId: '' }, { liveAccountId: 'invalid' },
  ]) {
    const a = app({ ...liveConfig, key: 'sk_live_other_project', ...missing });
    assert.equal((await a.request('GET', '/api/shop')).body.pagamenti, false);
    assert.equal((await a.request('POST', '/api/checkout', buyer)).status, 503);
    assert.equal(a.calls.length, 0);
  }
});

test('il live verifica l’account prima di creare sessioni, usando solo la sua chiave dedicata', async () => {
  const a = app(liveConfig);
  assert.equal((await a.request('POST', '/api/checkout', buyer)).status, 201);
  assert.equal(a.calls[0].url, 'https://api.stripe.com/v1/account');
  assert.equal(a.calls[1].url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.ok(a.calls.every(c => c.options.headers.Authorization === 'Bearer ' + liveConfig.liveKey));
  const order = a.store.get('ordini')[0];
  assert.equal(order.sandbox, false);
  assert.equal(order.totale, 89000);
  const result = await a.request('GET', '/api/checkout/conferma?o=' + order.id + '&session_id=' + order.stripeSessionId);
  assert.equal(result.body.stato, 'pagato');
  assert.equal(a.calls.filter(c => c.url.endsWith('/v1/account')).length, 1);
});

test('account diverso, incassi disabilitati o errore Stripe bloccano il live senza creare ordini', async () => {
  for (const invalid of [
    { accountResponse: { id: 'acct_other_project', charges_enabled: true } },
    { accountResponse: { id: 'acct_clientunit', charges_enabled: false } },
    { accountStatus: 401, accountResponse: { error: { message: 'private_key_do_not_print' } } },
  ]) {
    const a = app({ ...liveConfig, ...invalid });
    for (let i = 0; i < 2; i++) assert.equal((await a.request('POST', '/api/checkout', buyer)).status, 503);
    assert.equal(a.calls.length, 1);
    assert.equal(a.store.has('ordini'), false);
    assert.equal(a.errors.some(e => e.includes('private_key_do_not_print')), false);
  }
});

test('il live rifiuta sessioni sandbox o con id non live', async () => {
  for (const invalid of [
    { livemode: false, id: 'cs_live_unit' }, { livemode: true, id: 'cs_test_unit' },
    { id: 'cs_live_unit' },
  ]) {
    const a = app({ ...liveConfig, stripeResponse: { url: 'https://checkout.stripe.com/', ...invalid } });
    assert.equal((await a.request('POST', '/api/checkout', buyer)).status, 502);
    assert.equal(a.store.has('ordini'), false);
  }
});

test('il webhook live conferma solo ordini con sessione, importo, valuta e modalità corrispondenti', async () => {
  const a = app(liveConfig);
  await a.request('POST', '/api/checkout', buyer);
  const order = a.store.get('ordini')[0];
  for (const wrong of [
    { id: 'cs_live_different' }, { amount_total: 1 }, { currency: 'usd' }, { livemode: false },
  ]) {
    assert.equal((await signedEvent(a, paymentEvent(order, wrong))).status, 400);
    assert.equal(a.store.get('ordini')[0].stato, 'in attesa');
  }
  assert.equal((await signedEvent(a, { ...paymentEvent(order), livemode: false })).status, 400);
  assert.equal((await signedEvent(a, paymentEvent(order), 'whsec_wrong')).status, 400);
  assert.equal((await signedEvent(a, paymentEvent(order), undefined, 'not-a-time')).status, 400);
  assert.equal((await signedEvent(a, paymentEvent(order), undefined, '1')).status, 400);
  const event = paymentEvent(order);
  assert.equal((await signedEvent(a, event)).status, 200);
  assert.equal(a.store.get('ordini')[0].stato, 'pagato');
  const paidAt = a.store.get('ordini')[0].pagato;
  assert.equal((await signedEvent(a, event)).status, 200);
  assert.equal(a.store.get('ordini')[0].pagato, paidAt);
  assert.equal((await signedEvent(a, { ...event, type: 'checkout.session.expired' })).status, 200);
  assert.equal(a.store.get('ordini')[0].stato, 'pagato');
});

test('i pagamenti differiti sono confermati o annullati dai rispettivi eventi firmati', async () => {
  for (const [type, paid, expected] of [
    ['checkout.session.async_payment_succeeded', 'paid', 'pagato'],
    ['checkout.session.async_payment_failed', 'unpaid', 'annullato'],
    ['checkout.session.expired', 'unpaid', 'annullato'],
    ['checkout.session.completed', 'unpaid', 'in attesa'],
  ]) {
    const a = app(liveConfig);
    await a.request('POST', '/api/checkout', buyer);
    const order = a.store.get('ordini')[0];
    const event = { ...paymentEvent(order, { payment_status: paid }), type };
    assert.equal((await signedEvent(a, event)).status, 200);
    assert.equal(a.store.get('ordini')[0].stato, expected);
  }
});

test('il ritorno dal checkout non conferma un importo diverso da quello dell’ordine', async () => {
  const a = app(liveConfig);
  await a.request('POST', '/api/checkout', buyer);
  const order = a.store.get('ordini')[0];
  order.totale = 100;
  const result = await a.request('GET', '/api/checkout/conferma?o=' + order.id + '&session_id=' + order.stripeSessionId);
  assert.equal(result.status, 400);
  assert.equal(a.store.get('ordini')[0].stato, 'in attesa');
});

test('il live non usa file locali e non maschera un database irraggiungibile', async () => {
  for (const config of [{ databaseUrl: '' }, { readStatus: 500 }]) {
    const a = app({ ...liveConfig, ...config });
    assert.equal((await a.request('POST', '/api/checkout', buyer)).status, 503);
    assert.equal(a.calls.length, 0);
    assert.equal(a.store.has('ordini'), false);
  }
});

test('se il salvataggio fallisce, il checkout non viene esposto e la sessione viene chiusa', async () => {
  const a = app({ ...liveConfig, writeStatus: 500 });
  const result = await a.request('POST', '/api/checkout', buyer);
  assert.equal(result.status, 503);
  assert.equal(result.body.url, undefined);
  assert.equal(a.store.has('ordini'), false);
  assert.ok(a.calls.some(c => c.url.endsWith('/v1/checkout/sessions/cs_live_unit/expire')));
});

test('ordini contemporanei non si sovrascrivono nell’archivio', async () => {
  const a = app(liveConfig);
  const results = await Promise.all(Array.from({ length: 4 }, () => a.request('POST', '/api/checkout', buyer)));
  assert.ok(results.every(r => r.status === 201));
  assert.equal(a.store.get('ordini').length, 4);
});
