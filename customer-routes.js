'use strict';

function createCustomerRoutes({ accounts, send, readBody, clientIp, siteUrl }) {
  const limits = new Map();
  function limit(key, count, duration) {
    const now = Date.now();
    if (limits.size > 20000) for (const [k, v] of limits) if (v.until <= now) limits.delete(k);
    if (limits.size >= 20000 && !limits.has(key)) throw Object.assign(new Error('Troppi tentativi. Riprova più tardi.'), { code: 429 });
    let entry = limits.get(key);
    if (!entry || entry.until <= now) { entry = { n: 0, until: now + duration }; limits.set(key, entry); }
    if (++entry.n > count) throw Object.assign(new Error('Troppi tentativi. Riprova più tardi.'), { code: 429 });
  }
  const cookieToken = req => ((req.headers.cookie || '').match(/(?:^|;\s*)cob_customer=([a-f0-9]{64})(?:;|$)/) || [])[1] || '';
  function setCookie(req, res, token) {
    res.setHeader('Set-Cookie', 'cob_customer=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' +
      (token ? 7 * 86400 : 0) + (siteUrl(req).startsWith('https:') ? '; Secure' : ''));
  }
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/cliente/')) return false;
    const action = url.pathname.slice('/api/cliente/'.length), method = req.method;
    const mutations = ['registrati', 'accedi', 'recupera', 'reinvia', 'verifica', 'password', 'esci'];
    try {
    if (method !== 'GET') {
      const origin = req.headers.origin;
      if ((origin && origin !== new URL(siteUrl(req)).origin) || req.headers['sec-fetch-site'] === 'cross-site')
        return send(res, 403, { error: 'Richiesta non consentita.' }), true;
      if (action !== 'esci' && !String(req.headers['content-type'] || '').startsWith('application/json'))
        return send(res, 415, { error: 'Formato richiesta non valido.' }), true;
    }
      if (action === 'me' && method === 'GET') { send(res, 200, await accounts.me(cookieToken(req))); return true; }
      if (action === 'profilo' && method === 'PUT') {
        send(res, 200, await accounts.updateProfile(cookieToken(req), await readBody(req))); return true;
      }
      if (method !== 'POST' || !mutations.includes(action)) { send(res, 404, { error: 'Pagina non trovata.' }); return true; }
      const b = action === 'esci' ? {} : await readBody(req);
      const ip = clientIp(req);
      limit(ip + '/all', 60, 15 * 60000);
      if (['registrati', 'recupera', 'reinvia'].includes(action)) {
        limit(ip + '/email', 8, 15 * 60000);
        limit('email/' + String(b.email || '').trim().toLowerCase().slice(0, 160), 4, 15 * 60000);
      }
      if (action === 'registrati') await accounts.register(b, siteUrl(req));
      if (action === 'recupera' || action === 'reinvia') await accounts.requestLink(b.email, action === 'recupera' ? 'reset' : 'verify', siteUrl(req), b.lang);
      if (action === 'verifica' || action === 'password') {
        await accounts.consume(b.token, action === 'verifica' ? 'verify' : 'reset', b.password);
        setCookie(req, res, '');
      }
      if (action === 'accedi') {
        limit(ip + '/login', 10, 15 * 60000);
        limit('login/' + String(b.email || '').trim().toLowerCase().slice(0, 160), 10, 15 * 60000);
        setCookie(req, res, await accounts.login(b.email, b.password));
      }
      if (action === 'esci') { await accounts.logout(cookieToken(req)); setCookie(req, res, ''); }
      send(res, 200, { ok: true }); return true;
    } catch (error) {
      send(res, error.code >= 400 && error.code <= 599 ? error.code : 503,
        { error: error.code >= 400 && error.code <= 599 ? error.message : 'Servizio temporaneamente non disponibile.' });
      return true;
    }
  };
}

module.exports = { createCustomerRoutes };
