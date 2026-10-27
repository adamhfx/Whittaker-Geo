param(
    [string]$Python = '',
    [string]$ModelVersion = '2.1.0-candidate.1',
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
if ($ModelVersion -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$') { throw 'Invalid local model version.' }
$repoRoot = Split-Path -Parent $PSScriptRoot
$settingsPath = Join-Path $repoRoot '.env.local'
if (-not (Test-Path -LiteralPath $settingsPath)) {
    throw 'Create .env.local using docs/MODEL_RUNTIME.md first.'
}

# Read data only. Do not dot-source or execute an environment file.
$allowed = @('CALC_ENGINE_URL', 'CALC_ENGINE_SECRET', 'SOFFICE_BIN', 'UNO_PYTHON_BIN', 'LOCAL_MODEL_REVIEW')
foreach ($line in [System.IO.File]::ReadAllLines($settingsPath)) {
    if ($line -match '^\s*([A-Z_]+)=(.*)$' -and $allowed -contains $Matches[1]) {
        $settingName = $Matches[1]
        $settingValue = $Matches[2].Trim()
        if ($settingValue.Length -ge 2 -and
            (($settingValue.StartsWith('"') -and $settingValue.EndsWith('"')) -or
             ($settingValue.StartsWith("'") -and $settingValue.EndsWith("'")))) {
            $settingValue = $settingValue.Substring(1, $settingValue.Length - 2)
        }
        [Environment]::SetEnvironmentVariable($settingName, $settingValue, 'Process')
    }
}

if ($env:LOCAL_MODEL_REVIEW -ne 'true') { throw 'LOCAL_MODEL_REVIEW must be true for this local-only helper.' }
if ($env:CALC_ENGINE_SECRET.Length -lt 32) { throw 'Configure a random CALC_ENGINE_SECRET of at least 32 characters.' }
$engineUri = $null
if (-not [Uri]::TryCreate($env:CALC_ENGINE_URL, [UriKind]::Absolute, [ref]$engineUri) -or
    $engineUri.Scheme -ne 'http' -or $engineUri.Host -ne '127.0.0.1' -or
    $engineUri.AbsolutePath -ne '/' -or $engineUri.Query -or $engineUri.Fragment -or $engineUri.UserInfo -or
    $engineUri.Port -lt 1024) {
    throw 'CALC_ENGINE_URL must be http://127.0.0.1:<unprivileged port> for local review.'
}
foreach ($binary in @($env:SOFFICE_BIN, $env:UNO_PYTHON_BIN)) {
    if (-not $binary -or -not (Test-Path -LiteralPath $binary -PathType Leaf)) {
        throw 'Configure existing SOFFICE_BIN and UNO_PYTHON_BIN paths; see docs/MODEL_RUNTIME.md.'
    }
}
foreach ($relativePath in @("models/state-rent/$ModelVersion.json", "private/models/state-rent/$ModelVersion.xlsx")) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $relativePath) -PathType Leaf)) {
        throw "Missing private model file: $relativePath"
    }
}
if (-not $Python) { $Python = Join-Path $repoRoot '.venv/Scripts/python.exe' }
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw 'Install worker/requirements.txt in .venv, or pass -Python with your configured interpreter path.'
}
if ($Check) {
    Write-Output 'Local review settings and required file paths are ready. No service was started.'
    exit 0
}

Push-Location $repoRoot
try {
    Write-Output 'Starting private model review on loopback. Keep this terminal open; press Ctrl+C to stop.'
    & $Python -m worker.local_review --port $engineUri.Port --manifest (Join-Path $repoRoot "models/state-rent/$ModelVersion.json") --template (Join-Path $repoRoot "private/models/state-rent/$ModelVersion.xlsx")
    if ($LASTEXITCODE -ne 0) { throw "The local review service exited with code $LASTEXITCODE." }
} finally {
    Pop-Location
}
