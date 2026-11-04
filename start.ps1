param(
    [switch]$Demo,
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $version = '24.11.1'
    $tools = Join-Path $PSScriptRoot '.tools'
    $runtime = Join-Path $tools "node-v$version-win-x64"
    if (-not (Test-Path (Join-Path $runtime 'node.exe'))) {
        New-Item -ItemType Directory -Force -Path $tools | Out-Null
        $archiveName = "node-v$version-win-x64.zip"
        $archive = Join-Path $tools $archiveName
        Write-Host 'Installation locale de Node.js depuis nodejs.org...'
        Invoke-WebRequest "https://nodejs.org/dist/v$version/$archiveName" -OutFile $archive -UseBasicParsing
        $checksums = (Invoke-WebRequest "https://nodejs.org/dist/v$version/SHASUMS256.txt" -UseBasicParsing).Content
        $expected = (($checksums -split "`n" | Where-Object { $_.Trim().EndsWith($archiveName) }) -split '\s+')[0]
        if (-not $expected -or (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne $expected) {
            throw 'La verification du telechargement Node.js a echoue.'
        }
        Expand-Archive -LiteralPath $archive -DestinationPath $tools -Force
        Remove-Item -LiteralPath $archive
    }
    $env:PATH = "$runtime;$env:PATH"
}
if (-not (Test-Path 'node_modules\vite\package.json')) {
    & npm.cmd install --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { throw 'Installation des dependances impossible.' }
}
if ($Demo) {
    & npm.cmd run seed
    if ($LASTEXITCODE -ne 0) { throw 'Initialisation de demonstration impossible.' }
}
if (-not $PrepareOnly) {
    Write-Host 'Application : http://localhost:5173 - Ctrl+C pour arreter.'
    & npm.cmd run dev
    if ($LASTEXITCODE -ne 0) { throw 'Le demarrage a echoue.' }
}