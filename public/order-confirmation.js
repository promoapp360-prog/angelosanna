(function () {
  'use strict';
  var U = window.ChefCustomerUI, $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search), id = q.get('o'), sid = q.get('session_id') || (q.get('simulato') === '1' ? 'simulato' : ''), tries = 0, timer, order;
  try {
    if (sid && id) sessionStorage.setItem('chef-order-' + id, sid);
    if (!sid && id) sid = sessionStorage.getItem('chef-order-' + id) || '';
  } catch (e) {}
  if (id && sid) history.replaceState(null, '', '/ordine?o=' + encodeURIComponent(id));
  function render() {
    if (!order) return;
    var paid = order.stato === 'pagato', simulated = order.simulato, pending = order.stato === 'in attesa';
    var title = simulated ? 'Ordine simulato' : paid ? (order.sandbox ? 'Pagamento di prova completato' : 'Ordine confermato')
      : pending ? 'Pagamento in attesa di conferma' : order.stato === 'rimborsato' ? 'Ordine rimborsato' : 'Ordine annullato';
    $('confirmationTitle').textContent = U.t(title); $('confirmationIcon').textContent = paid ? '✓' : pending ? '…' : 'i';
    $('confirmationText').textContent = U.t(simulated || order.sandbox ? 'Questo è un ordine di prova: nessun addebito reale.'
      : paid ? 'Grazie! Il pagamento è stato verificato. Conserva il numero del tuo ordine.'
        : pending ? 'Il pagamento non è ancora confermato. Non ripetere l’acquisto: aggiorneremo lo stato automaticamente.'
          : 'Per informazioni sul tuo ordine, contatta Chef Angelo Sanna.');
    $('orderDetail').innerHTML = U.orderCard(order);
    $('createAccount').hidden = !(paid || simulated);
    $('emailPending').hidden = !order.emailInAttesa || !paid || order.sandbox;
    $('refreshOrder').hidden = !pending;
  }
  async function check() {
    clearTimeout(timer); $('refreshOrder').disabled = true;
    try {
      if (!id || !sid) throw new Error(U.t('Apri il link di conferma del pagamento oppure accedi alla tua area cliente.'));
      order = await U.request('/api/checkout/conferma?o=' + encodeURIComponent(id) + '&session_id=' + encodeURIComponent(sid));
      if (order.email) { try { sessionStorage.setItem('chef-signup-email', order.email); } catch (e) {} }
      if (order.stato === 'pagato' || order.simulato) {
        try { localStorage.removeItem('chef-cart'); } catch (e) {}
      }
      render();
      if (order.stato === 'in attesa' && ++tries < 24) timer = setTimeout(check, 2500);
    } catch (e) {
      $('confirmationTitle').textContent = U.t('Verifica dell’ordine');
      $('confirmationText').textContent = e.message;
      $('refreshOrder').hidden = !id || !sid;
    } finally { $('refreshOrder').disabled = false; }
  }
  $('refreshOrder').addEventListener('click', function () { tries = 0; check(); });
  window.addEventListener('chef-language-change', render);
  window.addEventListener('pagehide', function () { clearTimeout(timer); });
  check();
})();
