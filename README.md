# Chef on Board — Landing + pannello Admin

Sito del corso **Chef on Board** di Chef Angelo Sanna. Contiene:

- la **landing** pubblica (`public/index.html`), con i prossimi corsi caricati in automatico;
- il **pannello admin** (`/admin`), dove Angelo inserisce date, sede, argomenti, numero di partecipanti e programma, e vede le richieste arrivate dal modulo;
- `STRATEGIA-MARKETING.md`, la strategia per le sponsorizzate.

Server: `server.js`, scritto in Node puro senza dipendenze esterne.

## Avvio su Replit
1. Importa il repo GitHub `promoapp360-prog/angelosanna` su Replit.
2. **Tools → Secrets**: aggiungi `ADMIN_PASSWORD` con la password del pannello.
3. **Tools → Database (Key-Value)**: attivalo, così corsi e richieste restano salvati anche dopo un nuovo deploy. Il server lo rileva da solo tramite `REPLIT_DB_URL`.
4. Premi **Run**, poi **Deploy** per avere l'indirizzo pubblico.

Il pannello si apre da `tuo-sito/admin` (link "Admin" in fondo alla pagina).

> Senza il Database di Replit i dati vengono scritti nella cartella `data/`. In locale va bene, ma su un deploy Autoscale quei file si possono perdere.

## Sicurezza
- Dopo 5 password sbagliate l'accesso si blocca per 15 minuti.
- La sessione dura 12 ore.
- Una password corta (6 lettere) è facile da indovinare. Meglio mescolare lettere e numeri, per esempio `mare26`.

## Da personalizzare
- **Logo:** il monogramma "AS" è ricostruito in vettoriale. Per usare il file originale, salvarlo in `public/assets/logo.png`.
- **Meta Pixel:** incollare il codice nel `<head>` di `public/index.html`. Il modulo lancia già l'evento `Lead`.
