#!/usr/bin/env node
// Punto unico di setup e verifica dell'ambiente di sviluppo.
//
// Runner generico e indipendente dallo stack: non contiene alcun comando
// specifico di una tecnologia. I comandi effettivi sono definiti nel file
// di configurazione `init.config.json` (nella stessa cartella di questo script),
// cosi lo stesso script puo fare da scaffolding per qualsiasi stack (Node,
// Python, Go, .NET, ...). Per adattare l'harness a un progetto basta modificare
// `init.config.json`, senza toccare questo script.
//
// Uso:
//   node init.mjs setup   # Esegue gli step del task "setup" (install librerie, preparazione ambiente, ...).
//   node init.mjs build   # Esegue gli step del task "build" (compilazione, packaging, ...).
//
// Formato di init.config.json:
//   {
//     "tasks": {
//       "setup": { "workingDirectory": ".", "steps": [ { "description": "...", "command": "..." } ] },
//       "build": { "workingDirectory": ".", "steps": [ { "description": "...", "command": "..." } ] }
//     }
//   }

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const task = process.argv[2] || "setup";

// 0. Localizza e carica il file di configurazione accanto allo script.
const configPath = join(scriptDir, "init.config.json");
if (!existsSync(configPath)) {
  console.error(`Errore: file di configurazione non trovato: ${configPath}`);
  console.error("Crea un init.config.json con i task 'setup' e 'build' (vedi commento in cima a init.mjs).");
  process.exit(1);
}

let config;
try {
  const raw = readFileSync(configPath, "utf8");
  config = JSON.parse(raw);
} catch (err) {
  console.error(`Errore: impossibile leggere/parsare init.config.json: ${err.message}`);
  process.exit(1);
}

// 1. Recupera la definizione del task richiesto.
const tasks = (config && config.tasks) || {};
const taskNames = Object.keys(tasks);
const taskDef = tasks[task];

if (!taskDef) {
  console.error(`Task non valido: '${task}'. Task disponibili in init.config.json: ${taskNames.join(", ")}`);
  process.exit(1);
}

// 2. Determina la working directory del task (default: cartella dello script).
let workingDirectory = scriptDir;
if (taskDef.workingDirectory) {
  workingDirectory = join(scriptDir, taskDef.workingDirectory);
}
if (!existsSync(workingDirectory)) {
  console.error(`Errore: workingDirectory non trovata: ${workingDirectory}`);
  process.exit(1);
}

// 3. Esegue gli step in ordine, fermandosi al primo errore.
const steps = Array.isArray(taskDef.steps) ? taskDef.steps : [];
if (steps.length === 0) {
  console.warn(`Attenzione: il task '${task}' non ha step da eseguire.`);
  process.exit(0);
}

for (const step of steps) {
  const description = step.description || step.command;
  console.log(`[${task}] ${description}`);

  if (!step.command || typeof step.command !== "string" || step.command.trim() === "") {
    console.error(`Errore: step senza 'command' nel task '${task}'.`);
    process.exit(1);
  }

  const result = spawnSync(step.command, {
    shell: true,
    stdio: "inherit",
    cwd: workingDirectory,
  });

  if (result.error) {
    console.error(`Errore: lo step '${description}' ha sollevato un'eccezione: ${result.error.message}`);
    process.exit(1);
  }

  const code = result.status === null ? 1 : result.status;
  if (code !== 0) {
    console.error(`Errore: lo step '${description}' e' fallito (exit code ${code}).`);
    process.exit(1);
  }
}

console.log(`Task '${task}' completato.`);
process.exit(0);
