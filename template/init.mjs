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
//   node init.mjs setup          # Esegue gli step del task "setup" (install librerie, preparazione ambiente, ...).
//   node init.mjs build          # Esegue gli step del task "build" (compilazione, packaging, ...).
//   node init.mjs worker on      # Abilita l'external worker (externalWorker.enabled = true).
//   node init.mjs worker off     # Disabilita l'external worker (externalWorker.enabled = false).
//   node init.mjs worker check   # Preflight CLI-agnostico: verifica che externalWorker.command funzioni.
//   node init.mjs worker run     # Lancia un external worker per una specifica issue.
//
// Formato di init.config.json:
//   {
//     "tasks": {
//       "setup": { "workingDirectory": ".", "steps": [ { "description": "...", "command": "..." } ] },
//       "build": { "workingDirectory": ".", "steps": [ { "description": "...", "command": "..." } ] }
//     },
//     "externalWorker": {
//       "enabled": false,
//       "command": "<comando con il placeholder obbligatorio {promptFile}>"
//     }
//   }
//
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const task = process.argv[2] || "setup";

const DEFAULT_EXTERNAL_WORKER_COMMAND =
  "ollama launch claude --model gemma4:31b-cloud -- -p {promptFile} --dangerously-skip-permissions";
const PROMPT_FILE_PLACEHOLDER = "{promptFile}";
const SMOKE_PROMPT = "Reply exactly READY. Use no tools.";

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

// 0.5 Dispatcher per sottocomandi harness-generici e indipendenti dallo stack,
// valutato PRIMA della lookup in config.tasks cosi 'setup'/'build' restano intatti.
if (task === "worker") {
  handleWorkerCommand(process.argv[3]);
  // handleWorkerCommand termina sempre il processo (process.exit).
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

// --- Sottocomando 'worker' -------------------------------------------------
//
// Toggle opt-in + preflight CLI-agnostico per un external worker (qualunque
// CLI a riga di comando in grado di ricevere un prompt da file: Claude Code,
// Ollama, o altro). Nessuna dipendenza da uno stack specifico: il comando e'
// interamente definito da `externalWorker.command` in init.config.json.

/**
 * Gestisce `node init.mjs worker <on|off|check|run>`. Termina sempre il processo
 * con process.exit (non ritorna mai al chiamante).
 * @param {string|undefined} subcommand
 */
function handleWorkerCommand(subcommand) {
  if (subcommand === "on") {
    setExternalWorkerEnabled(true);
  } else if (subcommand === "off") {
    setExternalWorkerEnabled(false);
  } else if (subcommand === "check") {
    runExternalWorkerCheck();
  } else if (subcommand === "run") {
    runExternalWorker();
  } else {
    console.error(`Sottocomando 'worker' non valido: '${subcommand ?? ""}'.`);
    console.error("Uso: node init.mjs worker on|off|check|run");
    process.exit(1);
  }
}

/**
 * Garantisce che config.externalWorker esista, creandolo con la forma di
 * default (enabled=false + comando placeholder) se mancante. Ritorna il
 * blocco (possibilmente appena creato).
 */
function ensureExternalWorkerBlock() {
  if (!config.externalWorker || typeof config.externalWorker !== "object") {
    config.externalWorker = {
      enabled: false,
      command: DEFAULT_EXTERNAL_WORKER_COMMAND,
    };
  }
  return config.externalWorker;
}

function writeConfigBack() {
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/**
 * @param {boolean} enabled
 */
function setExternalWorkerEnabled(enabled) {
  const externalWorker = ensureExternalWorkerBlock();
  externalWorker.enabled = enabled;
  writeConfigBack();
  console.log(
    `External worker ${enabled ? "abilitato" : "disabilitato"} (externalWorker.enabled = ${enabled}) in ${configPath}.`
  );
  process.exit(0);
}

/**
 * Preflight CLI-agnostico: verifica che externalWorker.command sia
 * configurato correttamente e che il CLI sottostante risponda a un prompt di
 * smoke test scritto su file temporaneo.
 */
function runExternalWorkerCheck() {
  const externalWorker = config.externalWorker;
  const commandTemplate = externalWorker && externalWorker.command;

  if (typeof commandTemplate !== "string" || !commandTemplate.includes(PROMPT_FILE_PLACEHOLDER)) {
    console.error(
      `Errore: 'externalWorker.command' mancante o privo del placeholder obbligatorio '${PROMPT_FILE_PLACEHOLDER}' in ${configPath}.`
    );
    console.error(
      `Esempio valido: "some-cli -p ${PROMPT_FILE_PLACEHOLDER}" (il placeholder viene sostituito con il path di un file di prompt).`
    );
    process.exit(1);
  }

  const promptFilePath = join(tmpdir(), `harness-worker-check-${process.pid}-${Date.now()}.txt`);
  writeFileSync(promptFilePath, SMOKE_PROMPT, "utf8");

  try {
    const command = commandTemplate.split(PROMPT_FILE_PLACEHOLDER).join(promptFilePath);
    console.log(`[worker check] Esecuzione: ${command}`);

    const result = spawnSync(command, { shell: true, encoding: "utf8" });

    if (result.error) {
      console.error(`Errore: il comando dell'external worker ha sollevato un'eccezione: ${result.error.message}`);
      process.exit(1);
    }

    const combinedOutput = `${result.stdout || ""}${result.stderr || ""}`;
    const statusOk = result.status === 0;
    const containsReady = combinedOutput.includes("READY");

    if (statusOk || containsReady) {
      console.log("[worker check] PASS: l'external worker ha risposto correttamente.");
      if (combinedOutput.trim() !== "") {
        console.log("--- output ---");
        console.log(combinedOutput);
      }
      process.exit(0);
    }

    console.error(
      `[worker check] FAIL: l'external worker non ha risposto come atteso (exit code ${result.status}, nessun 'READY' nell'output).`
    );
    console.error("Possibili cause: CLI non installato/non nel PATH, comando/argomenti errati, modello non disponibile.");
    console.error("--- output ---");
    console.error(combinedOutput || "(nessun output)");
    process.exit(1);
  } finally {
    try {
      unlinkSync(promptFilePath);
    } catch {
      // Best-effort cleanup: se il file temporaneo non esiste piu' o non e'
      // rimovibile non e' un errore fatale per il preflight.
    }
  }
}

/**
 * Lancia l'external worker con log e HARNESS_ROLE garantiti.
 * Uso: node init.mjs worker run --issue <issueId> --prompt <promptFile>
 */
function runExternalWorker() {
  const externalWorker = config.externalWorker;

  // 1. Validazione Config
  if (!externalWorker || externalWorker.enabled === false) {
    console.error("Errore: external worker disabilitato in init.config.json.");
    process.exit(1);
  }

  const commandTemplate = externalWorker.command;
  if (typeof commandTemplate !== "string" || !commandTemplate.includes(PROMPT_FILE_PLACEHOLDER)) {
    console.error(`Errore: 'externalWorker.command' privo di ${PROMPT_FILE_PLACEHOLDER} in ${configPath}.`);
    process.exit(1);
  }

  // 2. Validazione Argomenti
  const args = process.argv.slice(4);
  const issueIdx = args.indexOf("--issue");
  const promptIdx = args.indexOf("--prompt");

  if (issueIdx === -1 || promptIdx === -1) {
    console.error("Errore: mancano gli argomenti obbligatori --issue e --prompt.");
    console.error("Uso: node init.mjs worker run --issue <issueId> --prompt <promptFile>");
    process.exit(1);
  }

  const issueId = args[issueIdx + 1];
  const promptFile = args[promptIdx + 1];

  if (!issueId || !promptFile) {
    console.error("Errore: valori mancanti per --issue o --prompt.");
    process.exit(1);
  }

  if (!existsSync(promptFile)) {
    console.error(`Errore: file di prompt non trovato: ${promptFile}`);
    process.exit(1);
  }

  // 3. Setup Log
  const runsDir = join(scriptDir, ".harness", "runs");
  mkdirSync(runsDir, { recursive: true });

  const timestamp = Date.now();
  const logFileName = `${issueId}-${timestamp}.log`;
  const logPath = join(runsDir, logFileName);

  // 4. Risoluzione Comando
  const resolvedCommand = commandTemplate.split(PROMPT_FILE_PLACEHOLDER).join(promptFile);

  // Scrive comando in testa al log e a video
  const header = `Command: ${resolvedCommand}\n`;
  process.stdout.write(header);
  writeFileSync(logPath, header, "utf8");

  // 5. Esecuzione
  const result = spawnSync(resolvedCommand, {
    shell: true,
    encoding: "utf8",
    env: { ...process.env, HARNESS_ROLE: "worker" },
  });

  // 6. Logging Output
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  process.stdout.write(output);
  writeFileSync(logPath, output, { flag: "a" }); // append

  // 7. Propagazione Exit Code
  const code = result.status === null ? 1 : result.status;
  process.exit(code);
}
