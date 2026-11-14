# Chef on Board — Landing + pannello Admin

Sito del corso **Chef on Board** di Chef Angelo Sanna. Contiene:

- la **landing** pubblica (`public/index.html`), con i prossimi corsi caricati in automatico;
- il **pannello admin** (`/admin`), con due sezioni:
  - **Corsi**: date, sede, argomenti, numero massimo di partecipanti, programma, pubblicato/bozza;
  - **Contatti**: le richieste dal sito arrivano da sole; si aggiungono a mano i contatti da Instagram, WhatsApp, telefono, passaparola. Ogni contatto ha uno stato (Nuovo → Contattato → Colloquio → **Partecipante** / Non interessato) e un corso collegato. Quando diventa *Partecipante*, i posti occupati del corso si aggiornano da soli (e si liberano se torna indietro o viene eliminato). Statistiche di conversione, filtri ed export CSV;
- `STRATEGIA-MARKETING.md`, la strategia per le sponsorizzate.

Server: `server.js`, Node 20+ senza framework. Le dipendenze autorizzate sono `pg` (PostgreSQL) e Nodemailer (Gmail SMTP).

## Avvio su Replit
1. Importa il repo GitHub `promoapp360-prog/angelosanna` su Replit.
2. **Tools → Secrets**: aggiungi `ADMIN_PASSWORD` con la password del pannello.
3. **Database PostgreSQL Replit**: lo schema sorgente è in `database/schema.sql`. Applicarlo solo in sviluppo; in produzione lo schema viene gestito dal flusso Publish. Il server usa `DATABASE_URL` e importa senza sovrascrivere le chiavi ancora mancanti dal precedente Key-Value, quando disponibile.
4. Premi **Run**, poi **Deploy** per avere l'indirizzo pubblico.

Il pannello si apre da `tuo-sito/admin` (link "Admin" in fondo alla pagina).

> Installare prima le dipendenze (`npm install` oppure `pnpm install`). Senza database il server può usare `data/` solo per prove locali; il checkout live non accetta l'archivio su file.

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

La sezione **Shop** è divisa in **Corsi** e **Prodotti**. Da **/admin → Shop e prodotti** si possono aggiungere, modificare, pubblicare o nascondere articoli e assegnarli a una categoria, con titolo, descrizione, prezzo e dettagli. Il prodotto iniziale è il corso online a **890 €**.

Il pagamento avviene su **Stripe Checkout**. La sola presenza di una chiave non attiva gli addebiti. La sandbox può verificare lo stato al ritorno da Stripe anche senza webhook; per gli incassi reali il webhook è obbligatorio. Klarna e PayPal vanno abilitati nella dashboard Stripe.

**Solo per provare in sviluppo, senza addebiti:** imposta `PAYMENT_MODE=simulated` nell'ambiente **Development** di Replit. La modalità simulata non contatta Stripe, registra gli ordini con stato "simulato" e non li conta negli incassi. Non impostare `PAYMENT_MODE` in Shared o Production.

**Checkout Stripe sandbox:** in **Development** imposta `PAYMENT_MODE=stripe_test` e inserisci la chiave segreta sandbox nei Secrets. Il server accetta solo chiavi con prefisso `sk_test_` e sessioni Stripe con `livemode=false`, rifiutando le chiavi live. Usa esclusivamente dati fittizi e carte di test Stripe, per esempio `4242 4242 4242 4242`, una scadenza futura e tre cifre per il CVC. Gli ordini sandbox sono identificati nell'admin ed esclusi dagli incassi, anche se lo stato è "pagato". La chiave pubblicabile non serve per questo checkout con reindirizzamento. La chiave API non è il segreto webhook.

**Pagamenti reali, separati dalla sandbox:** solo dopo il consenso del titolare, configurare i Secrets `STRIPE_LIVE_SECRET_KEY` (chiave `sk_live_` di Angelo, oppure `rk_live_` con i permessi necessari per leggere l'account e gestire le sessioni Checkout) e `STRIPE_LIVE_WEBHOOK_SECRET` (segreto `whsec_` dell'endpoint live). Non sovrascrivere la chiave sandbox `STRIPE_SECRET_KEY`. Eseguire `node scripts/check-stripe-account.js --live` per identificare l'account senza creare pagamenti o mostrare la chiave. Verificare con il titolare l'account e la sua abilitazione agli incassi; impostare il suo ID non segreto in `STRIPE_LIVE_ACCOUNT_ID` e `PAYMENT_MODE=live` soltanto in **Production**, poi ripubblicare. Il server confronta l'ID dell'account prima di creare sessioni: una chiave di un altro account blocca i pagamenti, senza ripiegare su credenziali alternative. I controlli riusciti sono riutilizzati per cinque minuti, gli errori per trenta secondi.

Nel pannello Stripe live di Angelo registrare l'endpoint `https://angelosanna.promoapp.it/api/stripe/webhook`, con gli eventi `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` e `checkout.session.expired`. Copiare il segreto di firma dell'endpoint nel Secret live dedicato. L'endpoint non conferma ordini con firme scadute/non valide, modalità test/live errata, sessione, importo o valuta non corrispondenti. Le notifiche duplicate non duplicano gli incassi e non annullano ordini già pagati.

Completare e far verificare condizioni di vendita, recesso e fatturazione prima di iniziare a vendere. Non inserire chiavi in Git e non abilitare modalità live nella preview.

**Archivio degli ordini reali:** PostgreSQL ha precedenza sul precedente Key-Value. Le chiavi e i valori JSON restano invariati nella tabella `chef_on_board_store`; i dati precedenti vengono copiati solo se la chiave non esiste, mai cancellati o sostituiti da un fallback. Nessun DDL viene eseguito all'avvio. Il server non ripiega sui file quando PostgreSQL non risponde. L'importazione una tantum `scripts/import-legacy-development.js` è riservata allo sviluppo e richiede un marcatore temporaneo creato tramite SQL sul database di sviluppo. Al primo Publish del database selezionare l'inizializzazione con i dati di sviluppo; non sovrascrivere un database di produzione già popolato. Verificare anche la conservazione di eventuali contatti/ordini nel vecchio deployment prima di ripubblicare: i suoi file non sono automaticamente accessibili dal workspace. Se il salvataggio di un ordine fallisce, il checkout non viene restituito e la sessione Stripe viene chiusa quando possibile. Restare su una singola Reserved VM: le scritture degli ordini sono serializzate nel processo.

### Ordini ed email

Gli acquisti avvengono esclusivamente dal checkout del sito: non esiste più un'alternativa di ordine via WhatsApp. WhatsApp resta un contatto per le richieste di informazioni. Dopo la conferma verificata del pagamento, il server invia due email separate: un riepilogo con dati cliente e consegna ad Angelo e una conferma al cliente, in italiano o inglese secondo la lingua scelta. Il codice fiscale compare soltanto nella notifica al venditore. Non vengono inviate email reali per prove, simulazioni, ordini non pagati o ordini storici precedenti a questa funzione.

**Gmail dedicato al progetto:** impostare `ORDER_EMAIL_PROVIDER=gmail` e salvare nei Secrets `GMAIL_APP_PASSWORD`, la password per app generata da Google nell'account di Angelo con verifica in due passaggi attiva. Non usare la password normale dell'account. SMTP usa TLS, mittente e autenticazione fissi su `yachtchefangelosanna@gmail.com`; non usa il connettore Gmail globale dell'agenzia né account alternativi. `node scripts/check-gmail.js` verifica l'autenticazione senza inviare messaggi. Il checkout controlla l'autenticazione prima di aprire nuovi pagamenti; errori temporanei vengono riprovati con la coda persistente. Gmail ha limiti di invio e può sospendere il servizio: per volumi elevati valutare un mittente transazionale dedicato.

Il precedente trasporto Resend resta disponibile solo con scelta esplicita `ORDER_EMAIL_PROVIDER=resend`, `ORDER_EMAIL_RESEND_API_KEY` e `ORDER_EMAIL_FROM` su un dominio verificato di questo cliente. Non esiste ripiego automatico da Gmail a Resend. Il checkout live resta bloccato se la configurazione email manca.

Gli esiti dei due invii sono salvati nell'ordine e visibili nell'admin. “Accettata dal servizio” non garantisce il recapito in casella: controllare mancati recapiti e cartella spam. Un problema email non annulla un pagamento riuscito: il webhook richiede una riprova e la Reserved VM controlla ogni minuto le email mancanti, con attesa crescente fino a un'ora. Dall'admin è disponibile “Riprova email mancanti”, senza reinviare quelle già registrate come accettate. Resend offre idempotenza per 24 ore; Gmail SMTP non offre questa garanzia. Con Gmail viene usato un Message-ID stabile, ma un'interruzione fra accettazione e salvataggio può causare una ripetizione: controllare la posta inviata prima di riprovare manualmente dopo un'interruzione.

### Cinque schede di esempio

Lo shop aggiunge una sola volta cinque esempi di prodotti fisici, senza sostituire il corso o altri prodotti. Angelo può modificarli, nasconderli ed eliminarli dalla sezione Shop dell'admin, raggiungibile anche dal footer. Le modifiche e le eliminazioni non vengono annullate da riavvii. Gli esempi sono visibili ma non acquistabili; dopo avere verificato prodotto reale, disponibilità, prezzo e condizioni, togliere la spunta “Scheda di esempio, non acquistabile” per attivarli. Il blocco è applicato anche sul server.

I controlli automatici della sandbox si eseguono con `node --test tests/stripe-sandbox.test.js`: usano chiavi fittizie e non contattano Stripe.

**Account corretto:** per Chef on Board usare esclusivamente lo Stripe di Angelo Sanna. Prima di attivare la sandbox, eseguire `node scripts/check-stripe-account.js`: effettua soltanto una lettura dell'identità dell'account associato alla chiave locale, senza stampare la chiave e mostrando l'email mascherata. Il checkout usa il Secret del progetto, non i connettori Stripe autorizzati in Replit; un connettore di un altro progetto non va riutilizzato.

**Ordini:** compaiono in **/admin → Shop e prodotti → Ordini** (in attesa, pagato, annullato, rimborsato, simulato), con nome, email, telefono e codice fiscale del cliente. Quando un prodotto richiede la spedizione, nell'ordine viene salvato anche l'indirizzo in Italia. I rimborsi si gestiscono nella dashboard Stripe, poi si aggiorna lo stato dell'ordine nell'admin.

I cinque prodotti dimostrativi hanno foto illustrative generate con AI, salvate localmente e ottimizzate in WebP. L'aggiunta delle foto agli esempi già presenti non ricrea prodotti eliminati e non modifica quelli rinominati, già personalizzati con una foto o attivati come prodotti reali. Le immagini dei prototipi non attestano caratteristiche o disponibilità di prodotti reali.

Nell'admin, spunta **Richiede indirizzo di spedizione** per i prodotti fisici e imposta **Costo spedizione in euro per pezzo** (0 = gratuita). Il costo si moltiplica per la quantità; con più prodotti si sommano i costi. Per gli articoli già presenti senza costo impostato rimane 0: nessuna tariffa viene inventata. Il server ricalcola sempre le spese dai prodotti salvati, ignorando importi inviati dal cliente; vengono mostrate separatamente nel carrello, addebitate in Stripe, salvate nell'ordine e riportate nell'admin e nelle email. Per i prodotti senza spedizione il costo è 0 e non viene richiesto un indirizzo. Il sito non gestisce corrieri, tracking o evasione degli ordini.

Le pagine **/privacy** e **/cookies** sono disponibili in italiano e inglese; sono bozze informative da far verificare. Lo shop accetta solo acquirenti maggiorenni e il server verifica la dichiarazione prima di creare un ordine.

**Da completare prima di incassare:** condizioni di vendita, diritto di recesso e regole per i contenuti digitali, oltre alla fatturazione: il sito non le genera. Aggiornare l'informativa prima di attivare strumenti pubblicitari o analytics.

## Pubblicare solo la pagina "stiamo arrivando"

Per mostrare online **solo** `public/presto.html` (immagine, annuncio della nuova piattaforma con acquisto online, pagamento comodo e Gift Card, e un modulo "avvisami al lancio") senza esporre il resto del sito:
1. Nei **Secrets di Replit** aggiungi `COMING_SOON` = `1`, poi riavvia/Deploy.
2. Il pubblico vede solo la pagina di attesa: tutto il resto (landing, foto, video, carrello, API) risponde "non trovato". `/admin` continua a funzionare e i contatti del modulo arrivano in **Contatti** con la nota "Lista d'attesa".
3. Quando il sito è pronto, **elimina il secret** (o mettilo a `0`) e rifai il Deploy.

L'immagine da condividere sui social (1080×1350) è `public/assets/presto/condividi.png`.
