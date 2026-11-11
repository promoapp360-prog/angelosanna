# Chef on Board — Landing + pannello Admin

Sito del corso **Chef on Board** di Chef Angelo Sanna. Contiene:

- la **landing** pubblica (`public/index.html`), con i prossimi corsi caricati in automatico;
- il **pannello admin** (`/admin`), con due sezioni:
  - **Corsi**: date, sede, argomenti, numero massimo di partecipanti, programma, pubblicato/bozza;
  - **Contatti**: le richieste dal sito arrivano da sole; si aggiungono a mano i contatti da Instagram, WhatsApp, telefono, passaparola. Ogni contatto ha uno stato (Nuovo → Contattato → Colloquio → **Partecipante** / Non interessato) e un corso collegato. Quando diventa *Partecipante*, i posti occupati del corso si aggiornano da soli (e si liberano se torna indietro o viene eliminato). Statistiche di conversione, filtri ed export CSV;
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

## Foto e video
- `public/assets/gallery/`: foto di yacht, ville, Angelo al lavoro e del corso in aula (ottimizzate per il web).
- `public/assets/video/`: video testimonianze (`t1`–`t5`) e video di gruppo, con le relative copertine `.jpg`.
- Per aggiungere una testimonianza: copiare il video in `public/assets/video/`, creare la copertina e duplicare un pulsante `.tcard` in `public/index.html`.

## Corso online, carrello e pagamenti (Stripe)

Il sito ha una sezione **Corso online** con carrello. Il cliente paga sulla pagina protetta di **Stripe Checkout**: carta, Apple Pay / Google Pay, **Klarna (Paga in 3 rate)** e **PayPal**. I dati della carta non passano mai dal nostro server.

**Attivazione (una volta sola):**
1. Su Stripe prendi la chiave segreta (`sk_live_…`, oppure `sk_test_…` per provare) e mettila nei **Secrets di Replit** come `STRIPE_SECRET_KEY`.
2. Nella dashboard Stripe, *Impostazioni → Metodi di pagamento*: attiva **Klarna** e **PayPal** (Stripe le mostra al cliente solo se l'importo è idoneo; Klarna Paga in 3 rate in Italia va da 1 a 1.500 €).
3. Webhook: in Stripe, *Sviluppatori → Webhook → Aggiungi endpoint* `https://TUO-SITO/api/stripe/webhook`, evento `checkout.session.completed` (aggiungi anche `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`). Copia il segreto `whsec_…` nei Secrets come `STRIPE_WEBHOOK_SECRET`.
4. (Facoltativo) `SITE_URL` con l'indirizzo pubblico, es. `https://angelosanna.com`, se i link di ritorno da Stripe non sono corretti.
5. Riavvia. Da **/admin → Corso online** imposta **titolo, descrizione, cosa include e prezzo**: finché il prezzo è 0 il prodotto non è acquistabile.

Senza `STRIPE_SECRET_KEY` il carrello resta visibile ma il cliente può solo ordinare via WhatsApp.

**Solo per provare in sviluppo, senza addebiti:** imposta `PAYMENT_MODE=simulated` e `SIMULATED_PRICE_EUR=890` nell'ambiente **Development** di Replit. Il server non contatta Stripe; registra gli ordini con stato "simulato" e non li conta negli incassi. Non impostare `PAYMENT_MODE` in Shared o Production.

**Ordini:** compaiono in **/admin → Corso online → Ordini** (in attesa, pagato, annullato, rimborsato, simulato). Il pagamento si conferma anche senza webhook quando il cliente torna sul sito; il webhook serve se chiude la pagina prima. I rimborsi si fanno dalla dashboard Stripe, poi segna l'ordine "Rimborsato".

**Da completare prima di incassare:** pagine legali (condizioni di vendita, diritto di recesso per contenuti digitali, privacy) e fatturazione: il sito non le genera.
