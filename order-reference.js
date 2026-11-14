'use strict';

function orderNumber(order) {
  return order.numero || 'COB-' + String(order.data || '').slice(0, 4) + '-' + String(order.id).slice(0, 8).toUpperCase();
}

function customerOrder(order) {
  return {
    id: order.id, numero: orderNumber(order), data: order.data, stato: order.stato,
    righe: order.righe, totale: order.totale, subtotale: order.subtotale == null ? order.totale : order.subtotale,
    costoSpedizione: order.costoSpedizione || 0, sandbox: order.sandbox === true,
    simulato: order.simulato === true, indirizzo: order.indirizzo || order.spedizione || null,
  };
}

function inOrderEnvironment(order, live) {
  return live ? !order.sandbox && !order.simulato : !!(order.sandbox || order.simulato);
}

module.exports = { orderNumber, customerOrder, inOrderEnvironment };
