'use strict';

// Importa soltanto nel database di SVILUPPO già configurato. Nessun DDL.
// La prima creazione del database di produzione avviene nel flusso Publish.
const confirmationIndex = process.argv.indexOf('--confirm-development-db');
const confirmation = confirmationIndex >= 0 ? process.argv[confirmationIndex + 1] : '';
if (!process.argv.includes('--development') || !/^[0-9a-f-]{36}$/.test(confirmation || '') ||
  /^(1|true)$/i.test(process.env.REPLIT_DEPLOYMENT || '')) {
  console.error('Importazione consentita solo con conferma esplicita del database di sviluppo.');
  process.exit(1);
}
(async () => {
  // Import dinamici: lo script funziona anche nel package scripts ESM del workspace.
  const { default: pg } = await import('pg');
  const path = await import('node:path');
  const { createStorage } = await import('../storage.js');
  const { SAMPLE_PRODUCTS_KEY, SAMPLE_IMAGES_KEY } = await import('../sample-products.js');
  const keys = ['corsi', 'richieste', 'ordini', 'prodotti',
    'migrazione-prezzo-corso-online-890-v1', SAMPLE_PRODUCTS_KEY, SAMPLE_IMAGES_KEY];
  if (!process.env.DATABASE_URL) throw new Error();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  let confirmed = false;
  try {
    // Il marcatore viene creato esclusivamente tramite il comando SQL di sviluppo.
    // Non dedurre il database di destinazione da REPLIT_ENVIRONMENT del workspace.
    const marker = await pool.query('SELECT value FROM public.chef_on_board_store WHERE key = $1', ['_development_import_confirmation']);
    if (!marker.rows.length || marker.rows[0].value !== confirmation) throw new Error();
    confirmed = true;
    const storage = createStorage({ pool, legacyUrl: process.env.REPLIT_DB_URL || '',
      dataDir: path.resolve(path.dirname(path.resolve(process.argv[1])), '../data') });
    for (const key of keys) await storage.load(key, null);
    const result = await pool.query('SELECT key, CASE WHEN jsonb_typeof(value) = $1 THEN jsonb_array_length(value) END AS records FROM public.chef_on_board_store ORDER BY key', ['array']);
    console.log(JSON.stringify({ developmentImport: true, keys: result.rows }));
  } finally {
    if (confirmed) await pool.query('DELETE FROM public.chef_on_board_store WHERE key = $1', ['_development_import_confirmation']);
    await pool.end();
  }
})().catch(() => { console.error('Importazione sviluppo non riuscita. Nessun dato precedente eliminato.'); process.exitCode = 1; });
