$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Invoke-TestCommand {
    param(
        [Parameter(Mandatory)] [string] $Command,
        [Parameter(ValueFromRemainingArguments)] [string[]] $Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw ('Test command failed with exit code ' + $LASTEXITCODE + ': ' + $Command)
    }
}

Push-Location (Join-Path $repoRoot 'backend')
try {
    Invoke-TestCommand python -m pytest
}
finally {
    Pop-Location
}

Push-Location $repoRoot
try {
    Invoke-TestCommand python -m pytest file_guard/tests
}
finally {
    Pop-Location
}

Push-Location (Join-Path $repoRoot 'frontend')
try {
    Invoke-TestCommand npm test
}
finally {
    Pop-Location
}
