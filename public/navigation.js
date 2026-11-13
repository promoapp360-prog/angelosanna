// Navigazione a scomparsa: nessuna dipendenza, collegamenti nativi alla landing.
(function () {
  'use strict';
  var nav = document.getElementById('nav');
  var toggle = document.getElementById('menuToggle');
  var panel = document.getElementById('siteMenu');
  if (!nav || !toggle || !panel) return;
  var open = false;

  function updateLabel() {
    toggle.setAttribute('aria-label', window.ChefI18n.t(open ? 'Chiudi menu' : 'Apri menu'));
  }
  function setOpen(next, restoreFocus) {
    open = next;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('menu-open', open);
    updateLabel();
    if (restoreFocus) toggle.focus();
  }
  toggle.addEventListener('click', function () {
    setOpen(!open);
    if (open) panel.querySelector('a').focus();
  });
  panel.addEventListener('click', function (event) {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('click', function (event) {
    if (open && !nav.contains(event.target)) setOpen(false);
  });
  document.addEventListener('focusin', function (event) {
    if (open && !nav.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', function (event) {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      setOpen(false, true);
    }
  });
  window.addEventListener('chef-language-change', updateLabel);
  updateLabel();
})();
