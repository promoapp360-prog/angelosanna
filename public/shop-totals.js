(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChefShopTotals = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  function parseShippingEuros(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return 0;
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return null;
    var cents = Math.round(Number(text.replace(',', '.')) * 100);
    return Number.isSafeInteger(cents) && cents <= 10000000 ? cents : null;
  }
  function shippingCost(product) {
    if (!product.richiedeSpedizione || product.costoSpedizione == null) return 0;
    var value = product.costoSpedizione;
    if (!Number.isSafeInteger(value) || value < 0 || value > 10000000) throw new Error('Costo di spedizione non valido.');
    return value;
  }
  function calculateTotals(rows) {
    var subtotale = 0, costoSpedizione = 0;
    rows.forEach(function (row) {
      subtotale += row.prezzo * row.qty;
      costoSpedizione += shippingCost(row) * row.qty;
    });
    return { subtotale: subtotale, costoSpedizione: costoSpedizione, totale: subtotale + costoSpedizione };
  }
  return { parseShippingEuros: parseShippingEuros, shippingCost: shippingCost, calculateTotals: calculateTotals };
});
