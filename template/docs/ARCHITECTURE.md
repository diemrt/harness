# ARCHITECTURE.md

## 1. Panoramica

Panoramica del progetto in circa 500-1000 parole massimo.

## 2. Stack tecnologico

| Area                | Tecnologia |
|---------------------|------------|
|                     |            |

## 3. Struttura del codice

```
folder/
├─ example.txt                   # Comment
├─ hooks/                        # git hook dell'harness (installati da hooks/install.mjs)
│  ├─ pre-commit                 # shim POSIX -> node pre-commit.mjs
│  ├─ pre-commit.mjs             # blocca commit solo con HARNESS_ROLE=worker
│  ├─ post-commit                # shim POSIX -> node post-commit.mjs
│  ├─ post-commit.mjs            # crea issue docs automatiche (non blocca il commit)
│  ├─ match.mjs                  # matcher glob per docsGate.include/docsGate.exclude
│  └─ install.mjs                # imposta git config core.hooksPath hooks (idempotente)
└─  subfolder/
   ├─ example.txt                # Contratto provider telefonico (GetManagedBusinessRecords, DownloadBusinessRecords)
   └─ ICustomerConfiguration.cs  # Contratto elaborazione specifica per cliente (ManageRecordings)
```

## x. Altre sezioni

Aggiungere con ulteriori sezioni se necessario.
