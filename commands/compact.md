---
description: Propone blocchi tematici per compattare le issue done, chiede conferma esplicita e solo dopo chiama la primitiva --compact. Senza argomenti propone blocchi su tutte le issue done del tracker.
argument-hint: "[indicazioni libere sul raggruppamento]"
allowed-tools: Bash, Read, Write
---

Compatta lo storico del tracker del progetto corrente. La primitiva `--compact` non decide
niente — il giudizio sul raggruppamento sta qui. Contratto completo (validazioni, ordine dei
rifiuti, formato dell'archivio) in
`${CLAUDE_PLUGIN_ROOT}/skills/harness/references/issues.md`, sezione `--compact`: leggila
prima di comporre un payload fuori dai casi sotto.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" <flag> [--project-dir <path>]
```

Argomenti: `$ARGUMENTS` — indicazioni libere dell'utente su come raggruppare (es. "tieni
separati i comandi dallo schema"). Nessun argomento: proponi i blocchi su tutte le issue
`done`, senza filtri.

## 1. Leggi le issue done

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --get-all --status done --page-size 50 | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('totalCount '+j.data.totalCount);for(const i of j.data.issues)console.log(i.id.slice(0,8)+' | '+i.title)})"
```

**Proietta id e titolo prima che l'output arrivi in contesto.** `--get-all` restituisce
l'oggetto issue intero, description e criteri di validazione compresi: su questo repository
sono stati 162.5KB per 88 issue, di cui la proposta usa due campi. Senza proiezione il comando
si strozza proprio sui tracker grandi, cioè dove compattare serve di più.

Scorri tutte le pagine con `--page <n>` se `totalCount` supera quanto mostrato: la proiezione
toglie campi, non issue. Meno di due issue `done` → dillo e fermati: non c'è niente da
compattare.

## 2. Proponi i blocchi

Raggruppa per argomento, non per ordine cronologico e non un blocco per issue: sapere che due
issue chiuse parlano dello stesso argomento è un giudizio che la primitiva non fa. Per ogni
blocco proposto mostra `title`, `description` e la lista `id` (accorciato) + `title` delle
issue che copre. Tieni conto di `$ARGUMENTS` se l'utente ha dato indicazioni sul
raggruppamento.

## 3. Aspetta conferma esplicita

**Non chiamare la primitiva finché l'utente non conferma il raggruppamento mostrato.** Un
blocco scritto è un archivio da disfare a mano: correggi la proposta finché non va bene,
procedi solo dopo un sì esplicito.

## 4. Chiama la primitiva

Scrivi il payload confermato su file e passalo con `--issue-data-file` (nessun escaping di
quote da gestire nella shell):

```json
{ "blocks": [ { "title": "…", "description": "…", "issue_ids": ["<guid>", "<guid>"] } ] }
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/issue-manager.mjs" --compact --issue-data-file <path>
```

## 5. Riporta l'esito

Successo → riporta `archivePath` e, per ogni blocco creato, `id` e `title`.

Errori: leggi `code` e non ritentare alla cieca con lo stesso payload.

- `INVALID_DEPENDENCY` → l'errore elenca gli id delle issue vive che puntano a un id da
  archiviare. Scollegale prima (aggiorna il loro `depends_on` con `/harness:issue`), poi
  rilancia lo stesso payload.
- `FORBIDDEN_ROLE` → a chiamare `--compact` è un worker (`HARNESS_ROLE=worker`): questo
  comando va lanciato fuori da quel ruolo, non ritentare con lo stesso payload.
- `NOT_FOUND` / `INVALID_STATUS` → un id nel payload non esiste o non è `done`: correggi la
  proposta e richiedi conferma da capo.
- `INVALID_INPUT` / `LIMIT_EXCEEDED` / `INVALID_ID` → il payload viola forma o limiti: correggi
  e riproponi prima di richiamare la primitiva.
