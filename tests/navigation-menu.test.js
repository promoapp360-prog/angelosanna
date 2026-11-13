const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function menu() {
  const events = {}, windowEvents = {}, classes = new Set();
  let language = 'it';
  function element() {
    return {
      events: {}, attributes: {}, focused: false,
      addEventListener(name, fn) { this.events[name] = fn; },
      setAttribute(name, value) { this.attributes[name] = value; },
      focus() { this.focused = true; },
    };
  }
  const toggle = element(), link = element(), panel = element(), nav = element();
  panel.hidden = true;
  panel.querySelector = () => link;
  nav.contains = target => [toggle, link, panel, nav].includes(target);
  nav.classList = { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } };
  const elements = { nav, menuToggle: toggle, siteMenu: panel };
  const document = { getElementById: id => elements[id], addEventListener: (name, fn) => { events[name] = fn; } };
  const window = {
    ChefI18n: { t: text => language === 'en' ? ({ 'Apri menu': 'Open menu', 'Chiudi menu': 'Close menu' }[text] || text) : text },
    addEventListener: (name, fn) => { windowEvents[name] = fn; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/navigation.js'), 'utf8'), { window, document });
  return { toggle, link, panel, events, classes, setEnglish() { language = 'en'; windowEvents['chef-language-change'](); } };
}

test('il pulsante apre il menu, aggiorna ARIA e porta il focus al primo link', () => {
  const m = menu();
  m.toggle.events.click();
  assert.equal(m.panel.hidden, false);
  assert.equal(m.toggle.attributes['aria-expanded'], 'true');
  assert.equal(m.toggle.attributes['aria-label'], 'Chiudi menu');
  assert.equal(m.classes.has('menu-open'), true);
  assert.equal(m.link.focused, true);
  m.toggle.events.click();
  assert.equal(m.panel.hidden, true);
  assert.equal(m.toggle.attributes['aria-expanded'], 'false');
});

test('Escape chiude il menu e restituisce il focus al pulsante', () => {
  const m = menu();
  m.toggle.events.click();
  let prevented = false;
  m.events.keydown({ key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(m.panel.hidden, true);
  assert.equal(m.toggle.focused, true);
  assert.equal(prevented, true);
});

test('un collegamento, un click esterno o il focus esterno chiudono il menu', () => {
  const m = menu();
  m.toggle.events.click();
  m.panel.events.click({ target: { closest: () => m.link } });
  assert.equal(m.panel.hidden, true);
  m.toggle.events.click();
  m.events.click({ target: {} });
  assert.equal(m.panel.hidden, true);
  m.toggle.events.click();
  m.events.focusin({ target: {} });
  assert.equal(m.panel.hidden, true);
});

test('il cambio lingua mantiene corretta l’etichetta di apertura o chiusura', () => {
  const m = menu();
  m.toggle.events.click();
  m.setEnglish();
  assert.equal(m.toggle.attributes['aria-label'], 'Close menu');
  m.toggle.events.click();
  assert.equal(m.toggle.attributes['aria-label'], 'Open menu');
});

test('Shop e tutti i collegamenti del menu puntano a sezioni esistenti', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const panel = html.match(/<div class="menu-panel"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
  assert.ok(panel);
  const links = [...panel[1].matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
  assert.ok(links.includes('shop'));
  assert.ok(links.includes('iscriviti'));
  assert.ok(links.length >= 6);
  for (const id of links) assert.ok(html.includes('id="' + id + '"'), 'Sezione mancante: ' + id);
  assert.match(html, /aria-controls="siteMenu"/);
});
