# Punto unico di setup e verifica dell'ambiente di sviluppo.
#
# Runner generico e indipendente dallo stack: non contiene alcun comando
# specifico di una tecnologia. I comandi effettivi sono definiti nel file
# di configurazione `init.config.json` (nella stessa cartella di questo script),
# cosi lo stesso script puo fare da scaffolding per qualsiasi stack (Node,
# Python, Go, .NET, ...). Per adattare l'harness a un progetto basta modificare
# `init.config.json`, senza toccare questo script.
#
# Uso:
#   .\init.ps1 setup   # Esegue gli step del task "setup" (install librerie, preparazione ambiente, ...).
#   .\init.ps1 build   # Esegue gli step del task "build" (compilazione, packaging, ...).
#
# Formato di init.config.json:
#   {
#     "tasks": {
#       "setup": { "workingDirectory": ".", "steps": [ { "description": "...", "command": "..." } ] },
#       "build": { "workingDirectory": ".", "steps": [ { "description": "...", "command": "..." } ] }
#     }
#   }

param(
    [string]$task = "setup"
)

$ErrorActionPreference = "Stop"

# 0. Localizza e carica il file di configurazione accanto allo script.
$configPath = Join-Path $PSScriptRoot "init.config.json"
if (-not (Test-Path $configPath)) {
    Write-Host "Errore: file di configurazione non trovato: $configPath" -ForegroundColor Red
    Write-Host "Crea un init.config.json con i task 'setup' e 'build' (vedi commento in cima a init.ps1)."
    exit 1
}

try {
    $config = Get-Content -Path $configPath -Raw | ConvertFrom-Json
}
catch {
    Write-Host "Errore: impossibile leggere/parsare init.config.json: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 1. Recupera la definizione del task richiesto.
$taskDef = $null
if ($config.tasks -and ($config.tasks.PSObject.Properties.Name -contains $task)) {
    $taskDef = $config.tasks.$task
}

if ($null -eq $taskDef) {
    Write-Host "Task non valido: '$task'. Task disponibili in init.config.json: $([string]::Join(', ', @($config.tasks.PSObject.Properties.Name)))"
    exit 1
}

# 2. Determina la working directory del task (default: cartella dello script).
$workingDirectory = $PSScriptRoot
if ($taskDef.workingDirectory) {
    $workingDirectory = Join-Path $PSScriptRoot $taskDef.workingDirectory
}
if (-not (Test-Path $workingDirectory)) {
    Write-Host "Errore: workingDirectory non trovata: $workingDirectory" -ForegroundColor Red
    exit 1
}

# 3. Esegue gli step in ordine, fermandosi al primo errore.
$steps = @($taskDef.steps)
if ($steps.Count -eq 0) {
    Write-Host "Attenzione: il task '$task' non ha step da eseguire." -ForegroundColor Yellow
    exit 0
}

Push-Location $workingDirectory
try {
    foreach ($step in $steps) {
        $description = if ($step.description) { $step.description } else { $step.command }
        Write-Host "[$task] $description" -ForegroundColor Cyan

        if ([string]::IsNullOrWhiteSpace($step.command)) {
            Write-Host "Errore: step senza 'command' nel task '$task'." -ForegroundColor Red
            exit 1
        }

        $global:LASTEXITCODE = 0
        try {
            Invoke-Expression $step.command
            $code = $LASTEXITCODE
        }
        catch {
            Write-Host "Errore: lo step '$description' ha sollevato un'eccezione: $($_.Exception.Message)" -ForegroundColor Red
            exit 1
        }

        if ($code -ne 0) {
            Write-Host "Errore: lo step '$description' e' fallito (exit code $code)." -ForegroundColor Red
            exit 1
        }
    }
}
finally {
    Pop-Location
}

Write-Host "Task '$task' completato." -ForegroundColor Green
exit 0
