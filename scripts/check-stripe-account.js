// Diagnostica di sola lettura: identifica lo Stripe della chiave locale.
// Non stampa mai la chiave e non crea pagamenti, clienti o altri oggetti.
(async function () {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key.startsWith('sk_test_')) throw new Error('Verifica sospesa: è richiesta una chiave segreta sandbox.');
  const response = await fetch('https://api.stripe.com/v1/account', {
    headers: { Authorization: 'Bearer ' + key },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Identificazione Stripe non riuscita (HTTP ' + response.status + ').');
  const account = await response.json();
  const email = String(account.email || '');
  const at = email.indexOf('@');
  console.log(JSON.stringify({
    accountId: account.id,
    businessName: (account.business_profile && account.business_profile.name) ||
      (account.settings && account.settings.dashboard && account.settings.dashboard.display_name) || '',
    maskedEmail: at > 0 ? email.slice(0, 2) + '***' + email.slice(at) : '',
  }, null, 2));
})().catch(function (error) {
  console.error(error.message);
  process.exitCode = 1;
});
