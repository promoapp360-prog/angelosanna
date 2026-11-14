'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Lo schema PostgreSQL è gestito in sviluppo e applicato da Replit al Publish.
// Non eseguire DDL né ripiegare su file quando PostgreSQL non risponde.
function createStorage({ pool = null, legacyUrl = '', dataDir, transport = fetch }) {
  async function readLegacy(key) {
    if (legacyUrl) {
      const response = await transport(legacyUrl + '/' + encodeURIComponent(key), { signal: AbortSignal.timeout(15000) });
      if (response.status === 404) return { found: false };
      if (!response.ok) throw new Error('Archivio precedente non disponibile.');
      const text = await response.text();
      return text ? { found: true, value: JSON.parse(text) } : { found: false };
    }
    const file = path.join(dataDir, key + '.json');
    if (!fs.existsSync(file)) return { found: false };
    return { found: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  }
  async function load(key, fallback) {
    if (pool) {
      const result = await pool.query('SELECT value FROM public.chef_on_board_store WHERE key = $1', [key]);
      if (result.rows.length) return result.rows[0].value;
      const old = await readLegacy(key);
      if (!old.found) return fallback;
      // Importazione non distruttiva: un valore già presente, anche [], non cambia.
      await pool.query('INSERT INTO public.chef_on_board_store (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING',
        [key, JSON.stringify(old.value)]);
      const saved = await pool.query('SELECT value FROM public.chef_on_board_store WHERE key = $1', [key]);
      if (!saved.rows.length) throw new Error('Importazione archivio non confermata.');
      return saved.rows[0].value;
    }
    const old = await readLegacy(key);
    return old.found ? old.value : fallback;
  }
  async function save(key, value) {
    const json = JSON.stringify(value);
    if (pool) {
      await pool.query('INSERT INTO public.chef_on_board_store (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
        [key, json]);
      return;
    }
    if (legacyUrl) {
      const response = await transport(legacyUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: encodeURIComponent(key) + '=' + encodeURIComponent(json), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Archivio non disponibile.');
      return;
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, key + '.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
    fs.renameSync(file + '.tmp', file);
  }
  return {
    load, save, persistent: !!(pool || legacyUrl),
    backend: pool ? 'PostgreSQL' : legacyUrl ? 'Replit Database precedente' : 'file in ./data',
  };
}

module.exports = { createStorage };
