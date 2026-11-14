'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGmailOrderMailer } = require('../gmail-mailer');
const { orderMessage } = require('../order-emails');
test('verifica e recupero usano solo Gmail dedicato e il mittente Chef Angelo Sanna', async () => {
  const messages = [];
  const mailer = createGmailOrderMailer({ appPassword: 'abcdefghijklmnop', createTransport: () => ({
    async verify() { return true; }, async sendMail(message) {
      messages.push(message); return { messageId: message.messageId, accepted: message.to };
    },
  }) });
  await mailer.sendAccount({ to: 'buyer@example.com', subject: 'Conferma account', text: 'Link monouso' });
  assert.deepEqual(messages[0].from, { name: 'Chef Angelo Sanna', address: 'yachtchefangelosanna@gmail.com' });
  assert.deepEqual(messages[0].to, ['buyer@example.com']);
  await assert.rejects(mailer.sendAccount({ to: 'invalid', subject: 'Conferma', text: 'Test' }));
});
test('le email ordine riportano il numero pubblico, senza codice fiscale se assente', () => {
  const order = { id: 'a-long-order-id', numero: 'COB-2026-000123', nome: 'Cliente', email: 'buyer@example.com',
    tel: '3200000000', codiceFiscale: '', data: '2026-11-14T10:00:00Z', righe: [{ titolo: 'Prodotto', qty: 1, prezzo: 2000 }],
    totale: 2000, subtotale: 2000, costoSpedizione: 0, areaClienteUrl: 'https://angelosanna.promoapp.it/cliente' };
  const owner = orderMessage(order, 'angelo'), customer = orderMessage(order, 'cliente');
  assert.match(owner.subject, /COB-2026-000123/); assert.ok(!owner.text.includes('Codice fiscale:'));
  assert.ok(customer.text.includes('/cliente'));
});
