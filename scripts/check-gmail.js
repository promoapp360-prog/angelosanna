'use strict';

(async () => {
  const { createGmailOrderMailer } = await import('../gmail-mailer.js');
  await createGmailOrderMailer({ appPassword: process.env.GMAIL_APP_PASSWORD || '' }).verify();
  console.log('Autenticazione SMTP Gmail di Angelo verificata. Nessuna email inviata.');
})().catch(() => {
  console.error('Gmail di Angelo non verificato: controllare la password per app nei Secrets.');
  process.exitCode = 1;
});
