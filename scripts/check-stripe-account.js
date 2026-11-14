// Diagnostica di sola lettura: identifica lo Stripe della chiave locale.
// Non stampa mai la chiave e non crea pagamenti, clienti o altri oggetti.
(async function () {
  const live = process.argv.includes('--live');
  const key = (live ? process.env.STRIPE_LIVE_SECRET_KEY : process.env.STRIPE_SECRET_KEY) || '';
  if (!(live ? /^(sk|rk)_live_/.test(key) : key.startsWith('sk_test_'))) throw new Error('Verifica sospesa: manca la chiave segreta ' + (live ? 'live dedicata.' : 'sandbox.'));
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
    mode: live ? 'live' : 'sandbox',
    businessName: (account.business_profile && account.business_profile.name) ||
      (account.settings && account.settings.dashboard && account.settings.dashboard.display_name) || '',
    maskedEmail: at > 0 ? email.slice(0, 2) + '***' + email.slice(at) : '',
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
  }, null, 2));
})().catch(function (error) {
  console.error(error.message);
  process.exitCode = 1;
});
