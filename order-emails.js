'use strict';

const OWNER_EMAIL = 'yachtchefangelosanna@gmail.com';
const SENDER_NAME = 'Chef Angelo Sanna';
const { orderNumber } = require('./order-reference');
const emailValid = value => /^[^\s@<>,;:"()\\]+@[^\s@<>,;:"()\\]+\.[^\s@<>,;:"()\\]+$/.test(String(value || ''));
const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const money = cents => (Number(cents) / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

function orderMessage(order, recipient) {
  const owner = recipient === 'angelo';
  const en = !owner && order.lang === 'en';
  const reference = orderNumber(order);
  const subject = owner ? 'Nuovo ordine pagato #' + reference
    : en ? 'Your Chef on Board order #' + reference : 'Conferma ordine Chef on Board #' + reference;
  const lines = [
    owner ? 'Nuovo ordine con pagamento confermato.' : en
      ? 'Thank you ' + order.nome + '! Your payment has been confirmed.'
      : 'Grazie ' + order.nome + '! Il pagamento è stato confermato.',
    '', (en ? 'Order' : 'Ordine') + ' #' + reference,
    (en ? 'Date' : 'Data') + ': ' + new Date(order.data).toISOString().slice(0, 10),
    '', ...order.righe.map(row => row.titolo + ' × ' + row.qty + ' — ' + money(row.prezzo * row.qty)),
    ...(order.costoSpedizione != null ? [
      '', (en ? 'Items subtotal' : 'Subtotale articoli') + ': ' + money(order.subtotale),
      (en ? 'Shipping' : 'Spedizione') + ': ' + money(order.costoSpedizione),
    ] : []),
    '', (en ? 'Total paid' : 'Totale pagato') + ': ' + money(order.totale),
  ];
  if (owner) lines.push('', 'Cliente: ' + order.nome, 'Email: ' + order.email,
    'Telefono: ' + order.tel, ...(order.codiceFiscale ? ['Codice fiscale: ' + order.codiceFiscale] : []));
  if (order.indirizzo || order.spedizione) {
    const s = order.indirizzo || order.spedizione;
    const label = order.spedizione ? (en ? 'Delivery address (Italy):' : 'Indirizzo di consegna (Italia):')
      : (en ? 'Customer address (Italy):' : 'Indirizzo intestatario (Italia):');
    lines.push('', label,
      order.nome, s.via, s.cap + ' ' + s.citta + ' (' + s.provincia + ')', 'Italia');
  }
  if (!owner) lines.push('', en
    ? 'Keep this order confirmation. For assistance, reply to this email.'
    : 'Conserva questa conferma d’ordine. Per assistenza puoi rispondere a questa email.');
  if (!owner && order.areaClienteUrl) lines.push('', en
    ? 'Optional customer account: register with this order’s email to view your purchases:'
    : 'Area cliente facoltativa: registrati con l’email di questo ordine per consultare i tuoi acquisti:', order.areaClienteUrl);
  lines.push('', 'Chef on Board — Chef Angelo Sanna', OWNER_EMAIL);
  const text = lines.join('\n');
  return {
    to: [owner ? OWNER_EMAIL : order.email], subject, text,
    html: '<div style="font-family:Arial,sans-serif;max-width:640px;color:#01264b">' +
      '<h1 style="font-size:23px">Chef on Board</h1>' +
      text.split('\n').map(line => line ? '<p>' + escapeHtml(line) + '</p>' : '<br>').join('') +
      '</div>',
  };
}

function createOrderMailer({ apiKey, from, transport }) {
  const ready = String(apiKey || '').startsWith('re_') && emailValid(from);
  return {
    ready,
    async send(order, recipient) {
      if (!ready) throw new Error('Servizio email ordini non configurato.');
      if (!['angelo', 'cliente'].includes(recipient) || !emailValid(order.email)) {
        throw new Error('Destinatario email non valido.');
      }
      // Dati della carta e credenziali non entrano mai nel messaggio.
      let response;
      try { response = await transport('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json',
          'Idempotency-Key': 'chef-order/' + order.id + '/' + recipient },
        body: JSON.stringify({ from: SENDER_NAME + ' <' + from + '>', reply_to: OWNER_EMAIL,
          ...orderMessage(order, recipient) }),
        signal: AbortSignal.timeout(15000),
      }); } catch (_) { throw new Error('Servizio email temporaneamente non disponibile.'); }
      if (!response.ok) throw new Error('Invio email non riuscito (HTTP ' + response.status + ').');
      const result = await response.json();
      if (!result.id) throw new Error('Invio email non confermato dal servizio.');
      return result.id;
    },
  };
}

module.exports = { createOrderMailer, orderMessage, emailValid, OWNER_EMAIL, SENDER_NAME };
