'use strict';

// Esempi editoriali, non offerte reali: l'admin deve disattivare il flag esempio.
const SAMPLE_PRODUCTS_KEY = 'shop-cinque-esempi-inseriti-v1';
const SAMPLE_PRODUCTS = [
  { id: 'esempio-grembiule', titolo: 'Esempio — Grembiule da cucina', prezzo: 2900,
    descrizione: 'Esempio di scheda per un grembiule da cucina. Angelo può sostituire titolo, descrizione e prezzo dall’admin.' },
  { id: 'esempio-utensili', titolo: 'Esempio — Set utensili da cucina', prezzo: 3900,
    descrizione: 'Esempio di set per la preparazione dei piatti. Inserire contenuto, materiali e disponibilità prima della vendita.' },
  { id: 'esempio-tagliere', titolo: 'Esempio — Tagliere da cucina', prezzo: 4500,
    descrizione: 'Esempio di prodotto per lo shop. Specificare dimensioni, materiali e istruzioni per la cura prima di attivarlo.' },
  { id: 'esempio-pinza', titolo: 'Esempio — Pinza da chef', prezzo: 1800,
    descrizione: 'Esempio di utensile per l’impiattamento. Tutti i dettagli sono modificabili dal pannello admin.' },
  { id: 'esempio-telo', titolo: 'Esempio — Telo da cucina', prezzo: 1200,
    descrizione: 'Esempio di accessorio per la cucina. Angelo può modificarlo, nasconderlo o eliminarlo liberamente.' },
].map(product => ({ ...product, categoria: 'prodotto', richiedeSpedizione: true,
  pubblicato: true, esempio: true, include: ['Scheda dimostrativa: non ancora acquistabile'] }));

module.exports = { SAMPLE_PRODUCTS_KEY, SAMPLE_PRODUCTS };
