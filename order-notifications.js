'use strict';

// La coda usa lo stesso archivio persistente degli ordini, non memoria volatile.
function createOrderNotifications({ mailer, enabled, loadOrders, updateOrder, now = Date.now }) {
  const active = new Map();
  const roles = ['angelo', 'cliente'];
  const eligible = order => order && order.emailRichiesta === true && order.stato === 'pagato' && order.pagato &&
    !order.sandbox && !order.simulato && String(order.stripeSessionId || '').startsWith('cs_live_');

  async function deliver(id, force) {
    const order = (await loadOrders()).find(o => o.id === id);
    if (!eligible(order)) return { ok: true, skipped: true };
    if (!enabled || !mailer.ready) return { ok: false, configured: false };
    const notices = order.emailOrdine || {};
    for (const role of roles) {
      const previous = notices[role] || {};
      if (previous.stato === 'inviata') continue;
      if (!force && previous.riprovaDopo && Date.parse(previous.riprovaDopo) > now()) continue;
      const attempt = { stato: 'in attesa', tentativi: (previous.tentativi || 0) + 1,
        ultimoTentativo: new Date(now()).toISOString() };
      notices[role] = attempt;
      await updateOrder(id, { emailOrdine: notices });
      try {
        const providerId = await mailer.send(order, role);
        notices[role] = { ...attempt, stato: 'inviata', providerId, inviata: new Date(now()).toISOString() };
      } catch (_) {
        notices[role] = { ...attempt, stato: 'errore', errore: 'Invio non riuscito; nuovo tentativo programmato.',
          riprovaDopo: new Date(now() + Math.min(3600000, 60000 * 2 ** Math.min(attempt.tentativi - 1, 6))).toISOString() };
      }
      await updateOrder(id, { emailOrdine: notices });
    }
    return { ok: roles.every(role => notices[role] && notices[role].stato === 'inviata') };
  }
  function send(id, force = false) {
    if (active.has(id)) return active.get(id);
    const operation = deliver(id, force).finally(() => active.delete(id));
    active.set(id, operation);
    return operation;
  }
  async function retryPending() {
    if (!enabled || !mailer.ready) return;
    const pending = (await loadOrders()).filter(o => eligible(o) &&
      roles.some(role => !o.emailOrdine || !o.emailOrdine[role] || o.emailOrdine[role].stato !== 'inviata'));
    for (const order of pending.slice(0, 20)) await send(order.id);
  }
  function start() {
    if (!enabled || !mailer.ready) return;
    const run = () => retryPending().catch(() => console.error('Riprova email ordini non riuscita.'));
    run();
    const timer = setInterval(run, 60000);
    timer.unref();
  }
  return { send, retryPending, start };
}

module.exports = { createOrderNotifications };
