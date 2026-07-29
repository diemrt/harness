# Proposals

Cose scritte e messe da parte: non fanno parte del plugin, non vengono servite né caricate.
Vivono qui perché buttarle sarebbe uno spreco e tenerle in un branch le farebbe dimenticare.

## `board-minimal.html`

Una UI alternativa per il board delle issue: colonne per stato, zero dipendenze esterne
(nessun CDN, nessun font remoto), quindi funziona a macchina offline.

Nata per sbaglio — la issue del board server chiedeva di **servire** il board dal plugin, non
di ridisegnarlo — e messa da parte perché la UI in uso deve restare coerente con quella
storica del progetto. Rispetto a quella in uso perde contatori, vista WIP prioritizzata,
blocco validazione e stati di caricamento/errore.

Il trade-off vero fra le due: la UI in uso carica Tailwind, daisyUI e Lucide da CDN e senza
rete non si presenta; questa no. Da riprendere quando si deciderà se vendorizzare le
dipendenze della UI in uso o cambiarla.
