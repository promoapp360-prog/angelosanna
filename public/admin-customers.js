(function () {
  'use strict';
  var U = window.ChefCustomerUI, customers = [], api, editing = null;
  function list() {
    var q = document.getElementById('customerSearch').value.trim().toLowerCase();
    var rows = customers.filter(function (c) { return [c.nome, c.email, c.tel, c.codiceFiscale].join(' ').toLowerCase().includes(q); });
    document.getElementById('customersList').innerHTML = rows.length ? '<div class="tablewrap"><table><thead><tr><th>Cliente</th><th>Anagrafica</th><th>Account</th><th>Ordini</th><th></th></tr></thead><tbody>' +
      rows.map(function (c) {
        var a = c.indirizzo || {}, address = [a.via, a.cap, a.citta, a.provincia].filter(Boolean).join(', ');
        return '<tr><td><b>' + U.esc(c.nome || '—') + '</b><div class="src">' + U.esc(c.email) + '</div></td>' +
          '<td>' + U.esc(c.tel || '—') + (c.codiceFiscale ? '<div class="src">CF: ' + U.esc(c.codiceFiscale) + '</div>' : '') +
          (address ? '<div class="src">' + U.esc(address) + ' · Italia</div>' : '') + '</td><td>' + U.esc(c.account) +
          '</td><td><b>' + U.esc(U.money(c.totaleAcquisti)) + '</b><details><summary>Ordini (' + c.ordini.length + ')</summary><ul>' +
          c.ordini.map(function (o) { return '<li><b>' + U.esc(o.numero) + '</b> · ' + U.esc(o.stato) + ' · ' + U.esc(U.money(o.totale)) +
            '<div class="src">' + o.righe.map(function (r) { return U.esc(r.titolo) + ' × ' + r.qty; }).join(', ') + '</div></li>'; }).join('') +
          '</ul></details></td><td><button type="button" class="link" data-customer="' + U.esc(c.id) + '">Modifica</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">Nessun cliente trovato.</div>';
  }
  async function load() {
    try { customers = await api('GET', '/api/admin/clienti'); list(); }
    catch (e) { document.getElementById('customersList').textContent = e.message; }
  }
  function edit(customer) {
    editing = customer || null;
    var dialog = document.getElementById('customerEditor'), form = document.getElementById('adminCustomerForm');
    document.getElementById('customerEditorTitle').textContent = customer ? 'Modifica anagrafica cliente' : 'Nuovo cliente';
    document.getElementById('adminCustomerFields').innerHTML = U.profileFields('admin-customer-');
    form.elements.email.value = customer ? customer.email : ''; form.elements.email.readOnly = !!customer;
    U.fillProfile(form, customer || {}); document.getElementById('customerEditError').textContent = ''; dialog.showModal();
  }
  window.ChefAdminCustomers = { load: load, init: function (request) {
    api = request;
    document.getElementById('customerSearch').addEventListener('input', list);
    document.getElementById('addCustomer').onclick = function () { edit(); };
    document.getElementById('closeCustomer').onclick = function () { document.getElementById('customerEditor').close(); };
    document.getElementById('customersList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-customer]'); if (b) edit(customers.find(function (c) { return c.id === b.dataset.customer; }));
    });
    document.getElementById('adminCustomerForm').addEventListener('submit', async function (e) {
      e.preventDefault(); var button = this.querySelector('[type=submit]'); button.disabled = true;
      try {
        var body = U.formProfile(this); body.email = this.elements.email.value;
        await api(editing ? 'PUT' : 'POST', '/api/admin/clienti' + (editing ? '/' + editing.id : ''), body);
        document.getElementById('customerEditor').close(); await load();
      } catch (error) { document.getElementById('customerEditError').textContent = error.message; }
      finally { button.disabled = false; }
    });
  } };
})();
