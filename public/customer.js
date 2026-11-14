(function () {
  'use strict';
  var U = window.ChefCustomerUI, $ = function (id) { return document.getElementById(id); }, current, resetToken = '';
  function notice(text, error) { $('accountMessage').textContent = U.t(text); $('accountMessage').classList.toggle('error', !!error); $('accountMessage').scrollIntoView({ block: 'nearest' }); }
  function panel(name, keepMessage) {
    $('auth').hidden = false; $('dashboard').hidden = true;
    ['login', 'register', 'forgot', 'reset'].forEach(function (key) { $('panel-' + key).hidden = name !== key; });
    if (!keepMessage) notice('');
  }
  function renderDashboard() {
    $('auth').hidden = true; $('dashboard').hidden = false; $('accountEmail').textContent = current.email;
    $('profileFields').innerHTML = U.profileFields('profile-'); U.fillProfile($('profileForm'), current);
    $('customerOrders').innerHTML = current.ordini.length ? current.ordini.map(U.orderCard).join('') : '<div class="card">' + U.esc(U.t('Non hai ancora ordini.')) + '</div>';
  }
  async function load() {
    try { current = await U.request('/api/cliente/me'); renderDashboard(); }
    catch (e) { if (e.status !== 401) notice(e.message, true); }
  }
  async function submit(form, action) {
    var button = form.querySelector('[type=submit]'); button.disabled = true;
    try { await action(); } catch (e) { notice(e.message, true); }
    finally { button.disabled = false; }
  }
  document.querySelectorAll('[data-panel]').forEach(function (b) { b.addEventListener('click', function () { panel(b.dataset.panel); }); });
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault(); submit(this, async function () {
      try {
        await U.request('/api/cliente/accedi', { email: $('loginEmail').value, password: $('loginPassword').value });
        $('loginPassword').value = ''; notice(''); await load();
      } catch (error) { $('resendButton').hidden = error.status !== 403; throw error; }
    });
  });
  $('registerForm').addEventListener('submit', function (e) {
    e.preventDefault(); submit(this, async function () {
      if ($('registerPassword').value !== $('registerRepeat').value) throw new Error(U.t('Le password non coincidono.'));
      await U.request('/api/cliente/registrati', { email: $('registerEmail').value, password: $('registerPassword').value, lang: window.ChefI18n.language() });
      $('loginEmail').value = $('registerEmail').value; $('registerPassword').value = ''; $('registerRepeat').value = '';
      panel('login'); $('resendButton').hidden = false;
      notice('Controlla la tua email per confermare l’account. Se sei già registrato, accedi o recupera la password.');
    });
  });
  function requestLink(email, resend) { return U.request('/api/cliente/' + (resend ? 'reinvia' : 'recupera'), { email: email, lang: window.ChefI18n.language() }); }
  $('forgotForm').addEventListener('submit', function (e) {
    e.preventDefault(); submit(this, async function () { await requestLink($('forgotEmail').value); notice('Se l’indirizzo corrisponde a un account, riceverai un link via email.'); });
  });
  $('resendButton').addEventListener('click', async function () {
    this.disabled = true; try { await requestLink($('loginEmail').value, true); notice('Se l’account deve essere verificato, riceverai un nuovo link via email.'); }
    catch (e) { notice(e.message, true); } finally { this.disabled = false; }
  });
  $('resetForm').addEventListener('submit', function (e) {
    e.preventDefault(); submit(this, async function () {
      if ($('newPassword').value !== $('newRepeat').value) throw new Error(U.t('Le password non coincidono.'));
      await U.request('/api/cliente/password', { token: resetToken, password: $('newPassword').value });
      $('resetForm').reset(); resetToken = ''; panel('login'); notice('Password aggiornata. Accedi con la nuova password.');
    });
  });
  $('profileForm').addEventListener('submit', function (e) {
    e.preventDefault(); submit(this, async function () {
      var profile = await U.request('/api/cliente/profilo', U.formProfile($('profileForm')), 'PUT');
      Object.assign(current, profile); notice('Dati aggiornati.');
    });
  });
  $('changePassword').addEventListener('click', async function () {
    this.disabled = true; try { await requestLink(current.email); notice('Controlla la tua email per cambiare la password.'); }
    catch (e) { notice(e.message, true); } finally { this.disabled = false; }
  });
  $('logoutButton').addEventListener('click', async function () {
    try { await U.request('/api/cliente/esci', {}); current = null; panel('login'); }
    catch (e) { notice(e.message, true); }
  });
  window.addEventListener('chef-language-change', function () {
    if (current) { var draft = U.formProfile($('profileForm')); renderDashboard(); U.fillProfile($('profileForm'), draft); }
  });
  async function start() {
    var q = new URLSearchParams(location.search), verification = q.get('verifica'); resetToken = q.get('recupero') || '';
    try { var email = sessionStorage.getItem('chef-signup-email') || ''; $('registerEmail').value = email; $('loginEmail').value = email; } catch (e) {}
    if (verification || resetToken) history.replaceState(null, '', '/cliente');
    if (verification) {
      panel('login');
      try { var result = await U.request('/api/cliente/verifica', { token: verification }); $('loginEmail').value = result.email || $('loginEmail').value; notice('Email confermata. Ora puoi accedere ai tuoi acquisti.'); }
      catch (e) { notice(e.message, true); $('resendButton').hidden = false; }
    } else if (resetToken) panel('reset');
    else { if (q.get('azione') === 'registrati') panel('register'); await load(); }
  }
  start();
})();
