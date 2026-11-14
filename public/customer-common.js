(function () {
  'use strict';
  var t = function (s) { return window.ChefI18n ? window.ChefI18n.t(s) : s; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  }); };
  var money = function (v) { return (Number(v) / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }); };
  async function request(url, body, method) {
    var response = await fetch(url, { method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) { var e = new Error(t(data.error || 'Servizio temporaneamente non disponibile.')); e.status = response.status; throw e; }
    return data;
  }
  function orderCard(o) {
    var state = o.simulato ? 'Ordine simulato' : o.sandbox ? 'Ordine di prova' : o.stato;
    return '<article class="order-card"><div class="order-head"><div><h3>' + esc(o.numero) +
      '</h3><span class="order-date">' + esc(new Date(o.data).toLocaleDateString('it-IT')) +
      '</span></div><span class="status">' + esc(t(state)) + '</span></div><ul class="order-lines">' +
      (o.righe || []).map(function (r) { return '<li><span>' + esc(r.titolo) + ' × ' + esc(r.qty) +
        '</span><span>' + esc(money(r.prezzo * r.qty)) + '</span></li>'; }).join('') + '</ul>' +
      '<div class="order-subtotal"><span>' + esc(t('Subtotale articoli')) + '</span><span>' + esc(money(o.subtotale)) + '</span></div>' +
      '<div class="order-subtotal"><span>' + esc(t('Spedizione')) + '</span><span>' + esc(money(o.costoSpedizione)) + '</span></div>' +
      '<div class="order-total"><span>' + esc(t('Totale')) + '</span><strong>' + esc(money(o.totale)) + '</strong></div></article>';
  }
  function profileFields(prefix) {
    return [['nome', 'Nome e cognome *', 'name', 120, true], ['tel', 'Telefono', 'tel', 40],
      ['codiceFiscale', 'Codice fiscale (facoltativo)', 'off', 16], ['via', 'Via, piazza e numero civico', 'street-address', 180],
      ['cap', 'CAP', 'postal-code', 5], ['citta', 'Città', 'address-level2', 100],
      ['provincia', 'Provincia', 'address-level1', 80]].map(function (f) {
        return '<div class="field' + (['nome', 'via', 'codiceFiscale'].includes(f[0]) ? ' full' : '') + '"><label for="' + prefix + f[0] + '">' +
          esc(t(f[1])) + '</label><input id="' + prefix + f[0] + '" name="' + f[0] + '" autocomplete="' + f[2] +
          '" maxlength="' + f[3] + '"' + (f[4] ? ' required' : '') +
          ' type="' + (f[0] === 'tel' ? 'tel' : 'text') + '"' + (f[0] === 'cap' ? ' inputmode="numeric"' : '') + '></div>';
      }).join('');
  }
  function formProfile(form) {
    var v = function (name) { return form.elements[name].value.trim(); };
    return { nome: v('nome'), tel: v('tel'), codiceFiscale: v('codiceFiscale'),
      indirizzo: { via: v('via'), cap: v('cap'), citta: v('citta'), provincia: v('provincia'), paese: 'IT' } };
  }
  function fillProfile(form, profile) {
    ['nome', 'tel', 'codiceFiscale'].forEach(function (name) { if (form.elements[name]) form.elements[name].value = profile[name] || ''; });
    ['via', 'cap', 'citta', 'provincia'].forEach(function (name) { form.elements[name].value = (profile.indirizzo || {})[name] || ''; });
  }
  window.ChefCustomerUI = { t: t, esc: esc, money: money, request: request, orderCard: orderCard,
    profileFields: profileFields, formProfile: formProfile, fillProfile: fillProfile };
})();
