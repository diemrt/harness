# Board delle issue

> **Stato:** contratto definito, implementazione in corso (issue "Board server: issues.html
> servito dal plugin con live reload"). Finché non è pronta, salta il passo 4 del clock-in e
> leggi le issue via CLI.

Il board è una pagina che mostra le issue del progetto e si aggiorna **da sola** quando
`issues.json` cambia: apri il browser una volta all'inizio della sessione e lo vedi muoversi
mentre il lavoro procede.

Non è un file nel progetto. È un server locale avviato dal plugin, che serve la pagina dal
plugin e i dati dal progetto corrente: nel repository non finisce nessun HTML.

## Ciclo di vita

- **Avvio** — al clock-in, automaticamente. Il server ascolta su `127.0.0.1` su una porta
  libera scelta a runtime.
- **URL** — stampalo **una volta sola**, quando parte. Non aprire il browser da solo: rubare
  il focus a ogni sessione è più fastidioso di un click.
- **Aggiornamento** — il server osserva `issues.json` e spinge il refresh al browser. Nessun
  reload manuale, nessun polling da parte tua.
- **Stop** — al clock-out. Non lasciare processi orfani a fine sessione.

## Cosa non fa

- Non scrive niente nel progetto.
- Non è raggiungibile dall'esterno: solo loopback.
- Non è un'interfaccia di modifica: le issue si cambiano con la CLI
  ([issues.md](issues.md)), così ogni scrittura passa dalle stesse validazioni.
