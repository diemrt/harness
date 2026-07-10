# Used from AI to get, insert, update, and delete issues in the issues.json file. This script can include tasks such as retrieving issue details, creating new issues, updating existing issues, and deleting issues.

# Example usage:
# .\issue-manager.ps1 -help
# .\issue-manager.ps1 -get <issueId>
# .\issue-manager.ps1 -get-all -order:desc <asc|desc> -page:0 <pageNumber> -pageSize:10 <pageSize> -status:backlog <status>
# .\issue-manager.ps1 -insert <issueData>
# .\issue-manager.ps1 -update <issueId> <issueData>
# .\issue-manager.ps1 -delete <issueId>

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
    [string]$order = "asc",
    [int]$page = 0,
    [int]$pageSize = 10,
    [string]$status = "backlog"
)

# Variables:
$issuesFilePath = ".\issues.json"

# Helper: id generator for new issues
function Generate-NewId {
    return [guid]::NewGuid().ToString()
}

# Helper: validate the provided status value
function Validate-Status {
    param ($status)
    $validStatuses = @("backlog", "in_progress", "blocked", "done")
    if ($validStatuses -notcontains $status) {
        Write-Host "Error: Invalid status value '$status'. Valid values are: backlog, in_progress, blocked, done."
        exit 1
    }
}

# Helper: validate the provided validation.state value
function Validate-State {
    param ($state)
    $validStates = @("unknown", "pass", "fail")
    if ($validStates -notcontains $state) {
        Write-Host "Error: Invalid validation.state value '$state'. Valid values are: unknown, pass, fail."
        exit 1
    }
}

# Helper: validate the full input payload for insert/update operations
# Enforces the canonical schema: title, description, status, validation (object or null).
# Rejects any extra/unknown top-level fields (including id, created_at, updated_at — these are auto-managed).
function Validate-IssueInput {
    param ($issue)

    # Strict unknown-field check — only these keys are allowed from the caller
    $allowedFields = @("title", "description", "status", "validation")
    $providedFields = $issue.PSObject.Properties.Name
    $unknownFields = @($providedFields | Where-Object { $allowedFields -notcontains $_ })
    if ($unknownFields.Count -gt 0) {
        Write-Host "Error: Unknown field(s) not allowed in issue input: $($unknownFields -join ', '). Allowed input fields: $($allowedFields -join ', ')."
        exit 1
    }

    # Required non-empty string: title
    if (-Not $issue.PSObject.Properties['title'] -or [string]::IsNullOrWhiteSpace($issue.title)) {
        Write-Host "Error: 'title' is required and must be a non-empty string."
        exit 1
    }

    # Required non-empty string: description
    if (-Not $issue.PSObject.Properties['description'] -or [string]::IsNullOrWhiteSpace($issue.description)) {
        Write-Host "Error: 'description' is required and must be a non-empty string."
        exit 1
    }

    # Required valid status
    if (-Not $issue.PSObject.Properties['status'] -or [string]::IsNullOrWhiteSpace($issue.status)) {
        Write-Host "Error: 'status' is required."
        exit 1
    }
    Validate-Status -status $issue.status

    # validation: must be null or a well-formed object { verification (non-empty), state (valid) }
    if ($null -ne $issue.validation) {
        $v = $issue.validation
        $allowedValidationFields = @("criteria", "state")
        $providedValidationFields = $v.PSObject.Properties.Name
        $unknownValidationFields = @($providedValidationFields | Where-Object { $allowedValidationFields -notcontains $_ })
        if ($unknownValidationFields.Count -gt 0) {
            Write-Host "Error: Unknown field(s) in 'validation' object: $($unknownValidationFields -join ', '). Allowed fields: criteria, state."
            exit 1
        }
        if (-Not $v.PSObject.Properties['criteria'] -or [string]::IsNullOrWhiteSpace($v.criteria)) {
            Write-Host "Error: 'validation.criteria' is required and must be a non-empty string when 'validation' is provided."
            exit 1
        }
        if (-Not $v.PSObject.Properties['state'] -or [string]::IsNullOrWhiteSpace($v.state)) {
            Write-Host "Error: 'validation.state' is required when 'validation' is provided."
            exit 1
        }
        Validate-State -state $v.state
    }
}

#Helper: validate that issue id is a valid GUID
function Validate-IssueId {
    param ($issueId)
    $parsedGuid = [guid]::Empty
    if (-Not [guid]::TryParse($issueId, [ref]$parsedGuid)) {
        Write-Host "Error: Invalid issue ID format. It should be a valid GUID."
        exit 1
    }
}

# Helper: load issues.json and return the root data object
function Read-IssuesFile {
    if (-Not (Test-Path -Path $issuesFilePath)) {
        Write-Host "Error: issues.json file not found. Please ensure it exists."
        exit 1
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
    Write-Host "Usage:"
    Write-Host ".\issue-manager.ps1 -help"
    Write-Host ".\issue-manager.ps1 -get -issueId <id>"
    Write-Host ".\issue-manager.ps1 -getAll [-order asc|desc] [-page 0] [-pageSize 10] [-status backlog|in_progress|blocked|done]"
    Write-Host ".\issue-manager.ps1 -insert -issueData '{""title"":""..."",""description"":""..."",""status"":""backlog"",""validation"":{""criteria"":""..."",""state"":""unknown""}}'"
    Write-Host ".\issue-manager.ps1 -update -issueId <id> -issueData '{""title"":""..."",""description"":""..."",""status"":""done"",""validation"":{""criteria"":""..."",""state"":""pass""}}'"
    Write-Host ".\issue-manager.ps1 -delete -issueId <id>"
    Write-Host ""
    Write-Host "Allowed input fields for -insert/-update: title, description, status, validation"
    Write-Host "  title        : required, non-empty string"
    Write-Host "  description  : required, non-empty string"
    Write-Host "  status       : required — backlog | in_progress | blocked | done"
    Write-Host "  validation   : null OR { criteria: <non-empty string>, state: unknown|pass|fail }"
    Write-Host "                 Set criteria at creation (state=unknown); update with evidence at closure (state=pass|fail)."
    Write-Host "Note: id, created_at, updated_at are auto-managed and must NOT be provided."
}

# 2. Function to get issue details by ID
function Get-Issue {
    param (
        [string]$issueId
    )
    Validate-IssueId -issueId $issueId
    $data = Read-IssuesFile
    $issue = @($data.issues) | Where-Object { $_.id -eq $issueId }
    if ($null -eq $issue) {
        Write-Host "Error: Issue with ID '$issueId' not found."
        exit 1
    }

    $issue | ConvertTo-Json -Depth 10 | Write-Host
}

# 3. Function to get all issues with optional filtering, ordering, and pagination
function Get-AllIssues {
    param (
        [string]$order = "desc",
        [int]$page = 0,
        [int]$pageSize = 10,
        [string]$status = "backlog"
    )
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

    # Pagination
    $totalIssues = $issues.Count
    $startIndex = $page * $pageSize
    $endIndex = [Math]::Min($startIndex + $pageSize - 1, $totalIssues - 1)
    $pagedIssues = if ($totalIssues -eq 0) { @() } else { $issues[$startIndex..$endIndex] }

    # Output the paged issues and total count
    [PSCustomObject]@{
        TotalCount = $totalIssues
        Issues     = $pagedIssues
    } | ConvertTo-Json -Depth 10 | Write-Host
}

# 4. Function to insert a new issue
function Insert-Issue {
    param (
        [string]$issueData
    )
    try {
        $newIssue = $issueData | ConvertFrom-Json
    } catch {
        Write-Host "Error: Provided issueData is not valid JSON."
        exit 1
    }

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
    Write-Host "Issue inserted successfully with ID: $($storedIssue.id)"
}

# 5. Function to update an existing issue by ID
function Update-Issue {
    param (
        [string]$issueId,
        [string]$issueData
    )
    Validate-IssueId -issueId $issueId
    try {
        $updatedIssue = $issueData | ConvertFrom-Json
    } catch {
        Write-Host "Error: Provided issueData is not valid JSON."
        exit 1
    }

    Validate-IssueInput -issue $updatedIssue

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
        Write-Host "Error: Issue with ID '$issueId' not found."
        exit 1
    }

    $existing = $issues[$issueIndex]

    # Rebuild the stored object: preserve id + created_at; set new updated_at
    $storedIssue = [PSCustomObject]@{
        id          = $issueId
        title       = $updatedIssue.title
        description = $updatedIssue.description
        status      = $updatedIssue.status
        validation  = $updatedIssue.validation
        created_at  = $existing.created_at
        updated_at  = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    }

    $issues[$issueIndex] = $storedIssue
    $data.issues = $issues

    Write-IssuesFile -data $data
    Write-Host "Issue with ID '$issueId' updated successfully."
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
        Write-Host "Error: Issue with ID '$issueId' not found."
        exit 1
    }

    # Remove the issue from the list
    $data.issues = @($issues | Where-Object { $_.id -ne $issueId })

    Write-IssuesFile -data $data
    Write-Host "Issue with ID '$issueId' deleted successfully."
}

# 7. Switch case to handle different tasks based on the provided argument
switch ($true) {
    $help {
        Show-Help
    }
    $get {
        if (-Not $issueId) {
            Write-Host "Error: Please provide an issue ID to retrieve."
            exit 1
        }
        Get-Issue -issueId $issueId
    }
    $getAll {
        Get-AllIssues -order $order -page $page -pageSize $pageSize -status $status
    }
    $insert {
        if (-Not $issueData) {
            Write-Host "Error: Please provide issue data in JSON format to insert."
            exit 1
        }
        Insert-Issue -issueData $issueData
    }
    $update {
        if (-Not $issueId -or -Not $issueData) {
            Write-Host "Error: Please provide both issue ID and issue data in JSON format to update."
            exit 1
        }
        Update-Issue -issueId $issueId -issueData $issueData
    }
    $delete {
        if (-Not $issueId) {
            Write-Host "Error: Please provide an issue ID to delete."
            exit 1
        }
        Delete-Issue -issueId $issueId
    }
    default {
        Write-Host "Error: Invalid task specified. Use '-help' for usage information."
        exit 1
    }
}