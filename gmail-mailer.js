'use strict';

const { OWNER_EMAIL, SENDER_NAME, orderMessage, emailValid } = require('./order-emails');

function unavailable() {
  const error = new Error('Email ordini temporaneamente non disponibili. Riprova più tardi.');
  error.code = 503;
  return error;
}

function createGmailOrderMailer({ appPassword, createTransport = require('nodemailer').createTransport, now = Date.now }) {
  const password = String(appPassword || '').replace(/\s/g, '');
  const ready = /^[A-Za-z0-9]{16}$/.test(password);
  // Il mittente non proviene da connettori o account globali: è sempre Angelo.
  const smtp = ready ? createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: OWNER_EMAIL, pass: password },
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  }) : null;
  let check, checkUntil = 0;
  async function verify() {
    if (!ready) throw unavailable();
    if (!check || now() >= checkUntil) {
      checkUntil = now() + 30000;
      check = Promise.resolve().then(() => smtp.verify()).then(() => {
        checkUntil = now() + 300000;
        return true;
      }).catch(() => { throw unavailable(); });
    }
    return check;
  }
  return {
    ready, provider: 'gmail', verify,
    async send(order, recipient) {
      if (!['angelo', 'cliente'].includes(recipient) || !emailValid(order.email)) throw unavailable();
      await verify();
      const message = orderMessage(order, recipient);
      const reference = String(order.id).replace(/[^a-zA-Z0-9_-]/g, '');
      try {
        const result = await smtp.sendMail({
          from: { name: SENDER_NAME, address: OWNER_EMAIL },
          replyTo: OWNER_EMAIL, ...message,
          // Gmail non offre l'idempotenza Resend: ID stabile, stato persistente
          // e coda serializzata riducono i duplicati, ma non garantiscono exactly-once.
          messageId: '<chef-order-' + reference + '-' + recipient + '@angelosanna.promoapp.it>',
        });
        if (!result.messageId || !Array.isArray(result.accepted) ||
          !result.accepted.some(address => String(address).toLowerCase() === message.to[0].toLowerCase())) throw unavailable();
        return result.messageId;
      } catch (_) { throw unavailable(); }
    },
  };
}

module.exports = { createGmailOrderMailer };
