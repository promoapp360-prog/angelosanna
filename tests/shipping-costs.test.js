'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseShippingEuros, shippingCost, calculateTotals } = require('../public/shop-totals');

test('costi di spedizione: euro con virgola/punto, gratuità e validazione precisa', () => {
  for (const [input, cents] of [['5,90', 590], ['5.9', 590], ['0', 0], ['', 0], [undefined, 0], ['100000', 10000000]]) {
    assert.equal(parseShippingEuros(input), cents);
  }
  for (const input of ['-1', '2.999', '2e3', '2 euro', 'Infinity', '100000.01']) assert.equal(parseShippingEuros(input), null);
  assert.equal(shippingCost({ richiedeSpedizione: false, costoSpedizione: 590 }), 0);
  assert.equal(shippingCost({ richiedeSpedizione: true }), 0);
  assert.throws(() => shippingCost({ richiedeSpedizione: true, costoSpedizione: -1 }));
});

test('browser e server usano lo stesso calcolo per carrelli misti, quantità e rimozioni', () => {
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/shop-totals'), 'utf8'), browser);
  const rows = [{ prezzo: 89000, qty: 1 }, { prezzo: 2000, qty: 2, richiedeSpedizione: true, costoSpedizione: 590 },
    { prezzo: 1500, qty: 3, richiedeSpedizione: true, costoSpedizione: 350 }];
  for (const cart of [rows, rows.slice(0, 2), rows.slice(0, 1), []]) {
    assert.deepEqual(JSON.parse(JSON.stringify(browser.window.ChefShopTotals.calculateTotals(cart))), calculateTotals(cart));
  }
  assert.deepEqual(calculateTotals(rows), { subtotale: 97500, costoSpedizione: 2230, totale: 99730 });
});
