# Used from AI to get, insert, update, and delete issues in the issues.json file. This script can include tasks such as retrieving issue details, creating new issues, updating existing issues, and deleting issues.

# Example usage:
# .\issue-manager.ps1 -help
# .\issue-manager.ps1 -get -issueId <issueId>
# .\issue-manager.ps1 -getAll -order desc -page 0 -pageSize 10 -status backlog
# .\issue-manager.ps1 -insert -issueDataFile .\new-issue.json
# .\issue-manager.ps1 -update -issueId <issueId> -issueData '<json>'
# .\issue-manager.ps1 -delete -issueId <issueId>

# Machine-readable contract (stdout is always a single line of JSON):
#   success -> {"ok":true,"data":<payload>}                      exit code 0
#   failure -> {"ok":false,"error":"<message>","code":"<CODE>"}  exit code 1
# Nothing is ever written to stderr, so `script | ConvertFrom-Json` works for both outcomes.
# Exception: -help prints plain text.
#
# Error codes: INVALID_ID, INVALID_STATUS, INVALID_STATE, INVALID_INPUT, INVALID_JSON,
#              NOT_FOUND, FILE_NOT_FOUND, MISSING_ARGS, UNKNOWN_COMMAND.

# Every issue in the issues.json file should have the following structure:
# {
#     "id": "<guid>",
#     "title": "<string>",
#     "description": "<string>",
#     "status": "<backlog|in_progress|blocked|done>",
#     "validation": { "criteria": "<string>", "state": "<unknown|pass|fail>" }|null,
#     "created_at": "<datetime>",
#     "updated_at": "<datetime>"
# }
#
# validation.criteria: set at creation time to define acceptance criteria (state="unknown");
# updated at closure with the verification evidence (state="pass"|"fail").
# validation can be null if no criteria are defined.
#
# -insert requires the full payload. -update merges: omitted fields keep their current value,
# while an explicit "validation": null clears the validation object.

# 0. Switch case to handle different issue management tasks based on the provided argument
param(
    [switch]$help,
    [switch]$get,
    [switch]$getAll,
    [switch]$insert,
    [switch]$update,
    [switch]$delete,

    [string]$issueId,
    [string]$issueData,
    [string]$issueDataFile,
    [string]$order = "asc",
    [int]$page = 0,
    [int]$pageSize = 10,
    [string]$status = "backlog"
)

# Variables:
$issuesFilePath = ".\issues.json"

# Helper: emit the success envelope on stdout and terminate
function Write-Ok {
    param($data)
    [PSCustomObject]@{ ok = $true; data = $data } |
        ConvertTo-Json -Depth 10 -Compress | Write-Output
    exit 0
}

# Helper: emit the failure envelope on stdout and terminate with a non-zero exit code.
# Failures go to stdout, not stderr: the caller parses one stream for both outcomes and
# tells them apart via `ok` or the exit code.
function Write-Fail {
    param(
        [string]$message,
        [string]$code = "ERROR"
    )
    [PSCustomObject]@{ ok = $false; error = $message; code = $code } |
        ConvertTo-Json -Depth 10 -Compress | Write-Output
    exit 1
}

# Helper: id generator for new issues
function Generate-NewId {
    return [guid]::NewGuid().ToString()
}

# Helper: true when the object carries the named property, even if its value is null
function Test-HasProp {
    param ($obj, [string]$name)
    return ($null -ne $obj.PSObject.Properties[$name])
}

# Helper: validate the provided status value
function Validate-Status {
    param ($status)
    $validStatuses = @("backlog", "in_progress", "blocked", "done")
    if ($validStatuses -notcontains $status) {
        Write-Fail "Invalid status value '$status'. Valid values are: backlog, in_progress, blocked, done." "INVALID_STATUS"
    }
}

# Helper: validate the provided validation.state value
function Validate-State {
    param ($state)
    $validStates = @("unknown", "pass", "fail")
    if ($validStates -notcontains $state) {
        Write-Fail "Invalid validation.state value '$state'. Valid values are: unknown, pass, fail." "INVALID_STATE"
    }
}

# Helper: validate the full input payload for insert/update operations
# Enforces the canonical schema: title, description, status, validation (object or null).
# Rejects any extra/unknown top-level fields (including id, created_at, updated_at — these are auto-managed).
# With -Partial (used by -update), absent fields are allowed; fields that ARE present are still validated.
function Validate-IssueInput {
    param (
        $issue,
        [switch]$Partial
    )

    # Strict unknown-field check — only these keys are allowed from the caller
    # Enumerate the properties themselves: `.Properties.Name` yields $null on an empty object,
    # and @($null) is a one-element array holding $null — which would read as an unknown field.
    $allowedFields = @("title", "description", "status", "validation")
    $providedFields = @($issue.PSObject.Properties | ForEach-Object { $_.Name })
    $unknownFields = @($providedFields | Where-Object { $allowedFields -notcontains $_ })
    if ($unknownFields.Count -gt 0) {
        Write-Fail "Unknown field(s) not allowed in issue input: $($unknownFields -join ', '). Allowed input fields: $($allowedFields -join ', ')." "INVALID_INPUT"
    }

    if ($Partial -and $providedFields.Count -eq 0) {
        Write-Fail "No updatable field provided. Allowed input fields: $($allowedFields -join ', ')." "INVALID_INPUT"
    }

    # Required non-empty string: title
    if (Test-HasProp $issue 'title') {
        if ([string]::IsNullOrWhiteSpace($issue.title)) {
            Write-Fail "'title' must be a non-empty string." "INVALID_INPUT"
        }
    } elseif (-Not $Partial) {
        Write-Fail "'title' is required and must be a non-empty string." "INVALID_INPUT"
    }

    # Required non-empty string: description
    if (Test-HasProp $issue 'description') {
        if ([string]::IsNullOrWhiteSpace($issue.description)) {
            Write-Fail "'description' must be a non-empty string." "INVALID_INPUT"
        }
    } elseif (-Not $Partial) {
        Write-Fail "'description' is required and must be a non-empty string." "INVALID_INPUT"
    }

    # Required valid status
    if (Test-HasProp $issue 'status') {
        if ([string]::IsNullOrWhiteSpace($issue.status)) {
            Write-Fail "'status' is required." "INVALID_INPUT"
        }
        Validate-Status -status $issue.status
    } elseif (-Not $Partial) {
        Write-Fail "'status' is required." "INVALID_INPUT"
    }

    # validation: must be null or a well-formed object { criteria (non-empty), state (valid) }
    if ($null -ne $issue.validation) {
        $v = $issue.validation
        $allowedValidationFields = @("criteria", "state")
        $providedValidationFields = @($v.PSObject.Properties | ForEach-Object { $_.Name })
        $unknownValidationFields = @($providedValidationFields | Where-Object { $allowedValidationFields -notcontains $_ })
        if ($unknownValidationFields.Count -gt 0) {
            Write-Fail "Unknown field(s) in 'validation' object: $($unknownValidationFields -join ', '). Allowed fields: criteria, state." "INVALID_INPUT"
        }
        if (-Not (Test-HasProp $v 'criteria') -or [string]::IsNullOrWhiteSpace($v.criteria)) {
            Write-Fail "'validation.criteria' is required and must be a non-empty string when 'validation' is provided." "INVALID_INPUT"
        }
        if (-Not (Test-HasProp $v 'state') -or [string]::IsNullOrWhiteSpace($v.state)) {
            Write-Fail "'validation.state' is required when 'validation' is provided." "INVALID_INPUT"
        }
        Validate-State -state $v.state
    }
}

#Helper: validate that issue id is a valid GUID
function Validate-IssueId {
    param ($issueId)
    $parsedGuid = [guid]::Empty
    if (-Not [guid]::TryParse($issueId, [ref]$parsedGuid)) {
        Write-Fail "Invalid issue ID format. It should be a valid GUID." "INVALID_ID"
    }
}

# Helper: parse a JSON payload coming from the caller
function ConvertFrom-IssueData {
    param ([string]$issueData)
    try {
        return $issueData | ConvertFrom-Json
    } catch {
        Write-Fail "Provided issueData is not valid JSON." "INVALID_JSON"
    }
}

# Helper: load issues.json and return the root data object
function Read-IssuesFile {
    if (-Not (Test-Path -Path $issuesFilePath)) {
        Write-Fail "issues.json file not found. Please ensure it exists." "FILE_NOT_FOUND"
    }
    return Get-Content -Path $issuesFilePath -Raw | ConvertFrom-Json
}

# Helper: save the root data object back to issues.json, updating last_updated
function Write-IssuesFile {
    param ($data)
    $data.last_updated = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    $data | ConvertTo-Json -Depth 10 | Set-Content -Path $issuesFilePath -Encoding UTF8
}

# 1. Function to display help information
function Show-Help {
    Write-Output "Usage:"
    Write-Output ".\issue-manager.ps1 -help"
    Write-Output ".\issue-manager.ps1 -get -issueId <id>"
    Write-Output ".\issue-manager.ps1 -getAll [-order asc|desc] [-page 0] [-pageSize 10] [-status backlog|in_progress|blocked|done]"
    Write-Output ".\issue-manager.ps1 -insert (-issueData '<json>' | -issueDataFile <path>)"
    Write-Output ".\issue-manager.ps1 -update -issueId <id> (-issueData '<json>' | -issueDataFile <path>)"
    Write-Output ".\issue-manager.ps1 -delete -issueId <id>"
    Write-Output ""
    Write-Output "Output contract (stdout is always one line of JSON, except for this help text):"
    Write-Output "  success : {""ok"":true,""data"":<payload>}                       exit code 0"
    Write-Output "  failure : {""ok"":false,""error"":""<msg>"",""code"":""<CODE>""}  exit code 1"
    Write-Output "Nothing is written to stderr: pipe stdout to ConvertFrom-Json in both cases."
    Write-Output ""
    Write-Output "Error codes: INVALID_ID, INVALID_STATUS, INVALID_STATE, INVALID_INPUT, INVALID_JSON,"
    Write-Output "             NOT_FOUND, FILE_NOT_FOUND, MISSING_ARGS, UNKNOWN_COMMAND"
    Write-Output ""
    Write-Output "data payload per command:"
    Write-Output "  -get     : the issue object"
    Write-Output "  -getAll  : { totalCount, page, pageSize, issues: [...] }"
    Write-Output "  -insert  : the created issue object (read .data.id for the new GUID)"
    Write-Output "  -update  : the updated issue object"
    Write-Output "  -delete  : { id, deleted }"
    Write-Output ""
    Write-Output "Passing the payload:"
    Write-Output "  -issueDataFile <path>  reads the JSON from a file — no shell quoting/escaping"
    Write-Output "  -issueData '<json>'    inline JSON; mutually exclusive with -issueDataFile"
    Write-Output ""
    Write-Output "Allowed input fields for -insert/-update: title, description, status, validation"
    Write-Output "  title        : non-empty string"
    Write-Output "  description  : non-empty string"
    Write-Output "  status       : backlog | in_progress | blocked | done"
    Write-Output "  validation   : null OR { criteria: <non-empty string>, state: unknown|pass|fail }"
    Write-Output "                 Set criteria at creation (state=unknown); update with evidence at closure (state=pass|fail)."
    Write-Output "-insert requires title, description and status."
    Write-Output "-update merges: omitted fields keep their current value; an explicit ""validation"": null clears it."
    Write-Output "Note: id, created_at, updated_at are auto-managed and must NOT be provided."
    exit 0
}

# 2. Function to get issue details by ID
function Get-Issue {
    param (
        [string]$issueId
    )
    Validate-IssueId -issueId $issueId
    $data = Read-IssuesFile
    $issue = @($data.issues) | Where-Object { $_.id -eq $issueId } | Select-Object -First 1
    if ($null -eq $issue) {
        Write-Fail "Issue with ID '$issueId' not found." "NOT_FOUND"
    }

    Write-Ok -data $issue
}

# 3. Function to get all issues with optional filtering, ordering, and pagination
function Get-AllIssues {
    param (
        [string]$order = "desc",
        [int]$page = 0,
        [int]$pageSize = 10,
        [string]$status = "backlog"
    )
    # A pageSize below 1 would make $endIndex fall behind $startIndex; PowerShell would then
    # walk the range backwards through negative (end-relative) indices and silently return
    # reordered or missing issues instead of an empty page.
    if ($pageSize -lt 1) {
        Write-Fail "'pageSize' must be greater than 0." "INVALID_INPUT"
    }

    $data = Read-IssuesFile
    $issues = @($data.issues)

    # Filter by status if provided
    if ($status) {
        $issues = @($issues | Where-Object { $_.status -eq $status })
    }

    # Order the issues
    if ($order -eq "asc") {
        $issues = @($issues | Sort-Object -Property id)
    } else {
        $issues = @($issues | Sort-Object -Property id -Descending)
    }

    # Pagination — an out-of-range page yields an empty array, never a reversed slice
    $totalIssues = $issues.Count
    $startIndex = [Math]::Max(0, $page) * $pageSize
    # Assign inside the if-block, not from it: `$x = if (...) { @(...) }` unrolls a
    # single-element array into a scalar and the JSON would then drop the array wrapper.
    $pagedIssues = @()
    if ($totalIssues -gt 0 -and $startIndex -lt $totalIssues) {
        $endIndex = [Math]::Min($startIndex + $pageSize - 1, $totalIssues - 1)
        $pagedIssues = @($issues[$startIndex..$endIndex])
    }

    # Output the paged issues and total count
    Write-Ok -data ([PSCustomObject]@{
        totalCount = $totalIssues
        page       = $page
        pageSize   = $pageSize
        issues     = $pagedIssues
    })
}

# 4. Function to insert a new issue
function Insert-Issue {
    param (
        [string]$issueData
    )
    $newIssue = ConvertFrom-IssueData -issueData $issueData

    Validate-IssueInput -issue $newIssue

    $data = Read-IssuesFile
    $now = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")

    # Build the stored object with auto-managed fields; never trust caller-supplied id/timestamps
    $storedIssue = [PSCustomObject]@{
        id          = Generate-NewId
        title       = $newIssue.title
        description = $newIssue.description
        status      = $newIssue.status
        validation  = $newIssue.validation
        created_at  = $now
        updated_at  = $now
    }

    $data.issues = @($data.issues) + $storedIssue
    Write-IssuesFile -data $data
    Write-Ok -data $storedIssue
}

# 5. Function to update an existing issue by ID
# Merge semantics: a field absent from the payload keeps its current value.
function Update-Issue {
    param (
        [string]$issueId,
        [string]$issueData
    )
    Validate-IssueId -issueId $issueId
    $updatedIssue = ConvertFrom-IssueData -issueData $issueData

    Validate-IssueInput -issue $updatedIssue -Partial

    $data = Read-IssuesFile
    $issues = @($data.issues)

    $issueIndex = -1
    for ($i = 0; $i -lt $issues.Count; $i++) {
        if ($issues[$i].id -eq $issueId) {
            $issueIndex = $i
            break
        }
    }

    if ($issueIndex -eq -1) {
        Write-Fail "Issue with ID '$issueId' not found." "NOT_FOUND"
    }

    $existing = $issues[$issueIndex]

    # Rebuild the stored object: preserve id + created_at; set new updated_at
    $storedIssue = [PSCustomObject]@{
        id          = $issueId
        title       = if (Test-HasProp $updatedIssue 'title')       { $updatedIssue.title }       else { $existing.title }
        description = if (Test-HasProp $updatedIssue 'description') { $updatedIssue.description } else { $existing.description }
        status      = if (Test-HasProp $updatedIssue 'status')      { $updatedIssue.status }      else { $existing.status }
        validation  = if (Test-HasProp $updatedIssue 'validation')  { $updatedIssue.validation }  else { $existing.validation }
        created_at  = $existing.created_at
        updated_at  = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    }

    $issues[$issueIndex] = $storedIssue
    $data.issues = $issues

    Write-IssuesFile -data $data
    Write-Ok -data $storedIssue
}

# 6. Function to delete an issue by ID
function Delete-Issue {
    param (
        [string]$issueId
    )
    Validate-IssueId -issueId $issueId
    $data = Read-IssuesFile
    $issues = @($data.issues)

    $exists = $issues | Where-Object { $_.id -eq $issueId }
    if ($null -eq $exists) {
        Write-Fail "Issue with ID '$issueId' not found." "NOT_FOUND"
    }

    # Remove the issue from the list
    $data.issues = @($issues | Where-Object { $_.id -ne $issueId })

    Write-IssuesFile -data $data
    Write-Ok -data ([PSCustomObject]@{ id = $issueId; deleted = $true })
}

# 7. Resolve the payload source: -issueData (inline) or -issueDataFile (path), never both
if ($issueDataFile) {
    if ($issueData) {
        Write-Fail "-issueData and -issueDataFile are mutually exclusive. Provide only one." "MISSING_ARGS"
    }
    if (-Not (Test-Path -Path $issueDataFile)) {
        Write-Fail "Issue data file '$issueDataFile' not found." "FILE_NOT_FOUND"
    }
    $issueData = Get-Content -Path $issueDataFile -Raw
}

# 8. Switch case to handle different tasks based on the provided argument
switch ($true) {
    $help {
        Show-Help
    }
    $get {
        if (-Not $issueId) {
            Write-Fail "Please provide an issue ID to retrieve." "MISSING_ARGS"
        }
        Get-Issue -issueId $issueId
    }
    $getAll {
        Get-AllIssues -order $order -page $page -pageSize $pageSize -status $status
    }
    $insert {
        if (-Not $issueData) {
            Write-Fail "Please provide issue data in JSON format to insert (-issueData or -issueDataFile)." "MISSING_ARGS"
        }
        Insert-Issue -issueData $issueData
    }
    $update {
        if (-Not $issueId -or -Not $issueData) {
            Write-Fail "Please provide both issue ID and issue data in JSON format to update (-issueData or -issueDataFile)." "MISSING_ARGS"
        }
        Update-Issue -issueId $issueId -issueData $issueData
    }
    $delete {
        if (-Not $issueId) {
            Write-Fail "Please provide an issue ID to delete." "MISSING_ARGS"
        }
        Delete-Issue -issueId $issueId
    }
    default {
        Write-Fail "Invalid task specified. Use '-help' for usage information." "UNKNOWN_COMMAND"
    }
}
