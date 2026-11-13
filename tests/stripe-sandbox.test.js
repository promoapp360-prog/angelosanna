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

function app({ mode = 'stripe_test', key = 'sk_test_fake_for_unit_tests', stripeResponse, stripeStatus = 200 } = {}) {
  const store = new Map([['prodotti', [product]], ['migrazione-prezzo-corso-online-890-v1', true]]);
  const calls = [], errors = [];
  let handler;
  const env = { PAYMENT_MODE: mode, STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: 'whsec_fake_unit_test', ADMIN_PASSWORD: 'unit-test-only', REPLIT_DB_URL: 'https://database.invalid' };
  vm.runInNewContext(source, {
    __dirname: root, Buffer, URL, process: { env },
    console: { log() {}, error(...args) { errors.push(args.join(' ')); } },
    require(name) {
      if (name === 'http') return { createServer(fn) { handler = fn; return { listen() {} }; } };
      return require(name);
    },
    async fetch(url, options = {}) {
      if (url.startsWith(env.REPLIT_DB_URL)) {
        if (options.method === 'POST') {
          for (const [key, value] of new URLSearchParams(options.body)) store.set(key, JSON.parse(value));
          return new Response('OK');
        }
        const key = decodeURIComponent(new URL(url).pathname.slice(1));
        return store.has(key) ? new Response(JSON.stringify(store.get(key))) : new Response('', { status: 404 });
      }
      calls.push({ url, options });
      const response = stripeResponse || {
        id: 'cs_test_unit', object: 'checkout.session', livemode: false,
        url: 'https://checkout.stripe.com/c/pay/cs_test_unit', payment_status: 'paid',
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
