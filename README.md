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

## Shop, prodotti e pagamenti (Stripe)

La sezione **Shop** mostra tutti i prodotti pubblicati. Da **/admin → Shop e prodotti** si possono aggiungere, modificare, pubblicare o nascondere prodotti con titolo, descrizione, prezzo e contenuti inclusi. Il prodotto iniziale è il corso online a **890 €**.

Il pagamento avviene su **Stripe Checkout**. Per attivare gli addebiti reali, aggiungi la chiave `STRIPE_SECRET_KEY` nei Secrets di Replit; per le conferme automatiche via webhook aggiungi `STRIPE_WEBHOOK_SECRET`. Klarna e PayPal vanno abilitati nella dashboard Stripe.

**Solo per provare in sviluppo, senza addebiti:** imposta `PAYMENT_MODE=simulated` nell'ambiente **Development** di Replit. La modalità simulata non contatta Stripe, registra gli ordini con stato "simulato" e non li conta negli incassi. Non impostare `PAYMENT_MODE` in Shared o Production.

**Ordini:** compaiono in **/admin → Shop e prodotti → Ordini** (in attesa, pagato, annullato, rimborsato, simulato), con nome, email, telefono e codice fiscale del cliente. Quando un prodotto richiede la spedizione, nell'ordine viene salvato anche l'indirizzo in Italia. I rimborsi si gestiscono nella dashboard Stripe, poi si aggiorna lo stato dell'ordine nell'admin.

Nell'admin, spunta **Richiede indirizzo di spedizione** per i prodotti fisici; per gli altri prodotti il cliente non deve inserire un indirizzo. Il sito non calcola le spese di spedizione e non gestisce corrieri, tracking o evasione degli ordini.

**Da completare prima di incassare:** pagine legali (condizioni di vendita, diritto di recesso per contenuti digitali, privacy) e fatturazione: il sito non le genera.

## Pubblicare solo la pagina "stiamo arrivando"

Per mostrare online **solo** `public/presto.html` (immagine, annuncio della nuova piattaforma con acquisto online, pagamento comodo e Gift Card, e un modulo "avvisami al lancio") senza esporre il resto del sito:
1. Nei **Secrets di Replit** aggiungi `COMING_SOON` = `1`, poi riavvia/Deploy.
2. Il pubblico vede solo la pagina di attesa: tutto il resto (landing, foto, video, carrello, API) risponde "non trovato". `/admin` continua a funzionare e i contatti del modulo arrivano in **Contatti** con la nota "Lista d'attesa".
3. Quando il sito è pronto, **elimina il secret** (o mettilo a `0`) e rifai il Deploy.

L'immagine da condividere sui social (1080×1350) è `public/assets/presto/condividi.png`.
