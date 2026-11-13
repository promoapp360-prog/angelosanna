(function () {
  'use strict';
  var buttons = document.querySelectorAll('[data-legal-language]');
  var sections = document.querySelectorAll('[data-language-content]');
  var requested = new URLSearchParams(location.search).get('lang');
  if (requested !== 'it' && requested !== 'en') {
    try { requested = localStorage.getItem('chef-on-board-language'); } catch (e) { requested = 'it'; }
  }

  function setLanguage(lang) {
    lang = lang === 'en' ? 'en' : 'it';
    document.documentElement.lang = lang;
    sections.forEach(function (section) {
      section.hidden = section.getAttribute('data-language-content') !== lang;
    });
    buttons.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-legal-language') === lang));
    });
    var title = document.querySelector('title[data-it][data-en]');
    if (title) document.title = title.getAttribute('data-' + lang);
    try { localStorage.setItem('chef-on-board-language', lang); } catch (e) { /* La pagina resta utilizzabile anche senza storage. */ }
  }

  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      setLanguage(button.getAttribute('data-legal-language'));
    });
  });
  setLanguage(requested);
})();
