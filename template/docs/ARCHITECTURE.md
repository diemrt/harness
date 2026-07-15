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
│  ├─ pre-commit.mjs             # gate documentale pre-commit (bypass: HARNESS_DOCS_VERIFIED=1)
│  └─ install.mjs                # imposta git config core.hooksPath hooks (idempotente)
└─  subfolder/
   ├─ example.txt                # Contratto provider telefonico (GetManagedBusinessRecords, DownloadBusinessRecords)
   └─ ICustomerConfiguration.cs  # Contratto elaborazione specifica per cliente (ManageRecordings)
```

## x. Altre sezioni

Aggiungere con ulteriori sezioni se necessario.
