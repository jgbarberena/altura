<#
.SYNOPSIS
    Deploy completo: regenera indices + SEO + sitemap, commit a GitHub y sube a produccion por FTP.

.PARAMETER Message
    Mensaje del commit. Si no se especifica, se genera con fecha/hora.

.PARAMETER SkipScripts
    Salta la regeneracion de indices, SEO y sitemap.

.PARAMETER SkipFtp
    Solo hace commit/push, sin subir por FTP.

.PARAMETER SkipGit
    Solo sube por FTP, sin commit/push a GitHub.

.EXAMPLE
    .\deploy.ps1
    .\deploy.ps1 -Message "mejoras formulario"
    .\deploy.ps1 -SkipFtp
    .\deploy.ps1 -SkipScripts -SkipGit
#>

param(
    [string]$Message    = "",
    [switch]$SkipScripts,
    [switch]$SkipFtp,
    [switch]$SkipGit
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

$pwshCmd = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh' } else { 'powershell' }

# ── FTP: lee config de .vscode/sftp.json ─────────────────────────────────────

$ftpCfg    = Get-Content ".vscode/sftp.json" -Raw | ConvertFrom-Json
$FtpHost   = $ftpCfg.host
$FtpPort   = $ftpCfg.port
$FtpUser   = $ftpCfg.username
$FtpPass   = $ftpCfg.password
$FtpBase   = $ftpCfg.remotePath.TrimStart('/')
$FtpCreds  = New-Object System.Net.NetworkCredential($FtpUser, $FtpPass)

function Should-Ignore([string]$path) {
    $p = $path -replace '\\', '/'
    if ($p -eq '.git' -or $p.StartsWith('.git/'))        { return $true }
    if ($p -eq '.vscode' -or $p.StartsWith('.vscode/'))  { return $true }
    if ($p -eq '.claude' -or $p.StartsWith('.claude/'))  { return $true }
    if ($p -match '(^|/)node_modules/')                  { return $true }
    if ($p -eq 'README.md')                              { return $true }
    if ($p -match '^CLAUDE.*\.md$')                      { return $true }
    if ($p -eq 'deploy.ps1')                             { return $true }
    if ($p -match '\.ps1$')                              { return $true }
    if ($p -match '\.zip$')                              { return $true }
    if ($p -match '(^|/)index-template\.html$')          { return $true }
    return $false
}

function Ensure-FtpDir([string]$url) {
    try {
        $req = [System.Net.FtpWebRequest]::Create($url)
        $req.Method = [System.Net.WebRequestMethods+Ftp]::MakeDirectory
        $req.Credentials = $FtpCreds
        $req.UsePassive = $true
        $req.GetResponse().Close()
    } catch { }
}

function Upload-FtpFile([string]$localPath, [string]$remoteUrl) {
    $dir = $remoteUrl.Substring(0, $remoteUrl.LastIndexOf('/'))
    Ensure-FtpDir $dir

    $req = [System.Net.FtpWebRequest]::Create($remoteUrl)
    $req.Method = [System.Net.WebRequestMethods+Ftp]::UploadFile
    $req.Credentials = $FtpCreds
    $req.UsePassive = $true
    $req.UseBinary = $true
    $req.KeepAlive = $false

    $data = [System.IO.File]::ReadAllBytes($localPath)
    $req.ContentLength = $data.Length
    $stream = $req.GetRequestStream()
    $stream.Write($data, 0, $data.Length)
    $stream.Close()
    $req.GetResponse().Close()
}

function Get-GitChangedFiles {
    $files = @()
    git status --porcelain | ForEach-Object {
        if ($_.Length -lt 3) { return }
        $xy   = $_.Substring(0, 2)
        $path = $_.Substring(3).Trim()

        # Renombrados: "old -> new" — nos quedamos con el nuevo
        if ($path -match ' -> (.+)$') { $path = $Matches[1] }
        $path = $path.Trim('"')

        # Solo archivos que existen (omitir eliminados)
        if ($xy -match 'D') { return }
        if (-not (Test-Path (Join-Path $Root $path))) { return }

        $files += $path
    }
    return $files
}

Write-Host ""

# ── PASO 1: Regenerar indices ─────────────────────────────────────────────────

if (-not $SkipScripts) {
    Write-Host "[1/4] Regenerando indices, SEO y sitemap..." -ForegroundColor Cyan

    Push-Location (Join-Path $Root 'guias')
    try {
        & $pwshCmd -ExecutionPolicy Bypass -NonInteractive -File "generate-index.ps1" | Out-Null
        Write-Host "  + guias/index.html" -ForegroundColor Green
    } catch {
        Write-Host "  ! guias/generate-index.ps1: $_" -ForegroundColor Yellow
    }
    Pop-Location

    Push-Location (Join-Path $Root 'faq')
    try {
        & $pwshCmd -ExecutionPolicy Bypass -NonInteractive -File "generate-faqHTML.ps1" | Out-Null
        Write-Host "  + faq/index.html" -ForegroundColor Green
    } catch {
        Write-Host "  ! faq/generate-faqHTML.ps1: $_" -ForegroundColor Yellow
    }
    Pop-Location

    try {
        & $pwshCmd -ExecutionPolicy Bypass -NonInteractive -File "GenerateFolderAutoSEO.ps1" | Out-Null
        Write-Host "  + SEO actualizado" -ForegroundColor Green
    } catch {
        Write-Host "  ! GenerateFolderAutoSEO.ps1: $_" -ForegroundColor Yellow
    }

    try {
        & $pwshCmd -ExecutionPolicy Bypass -NonInteractive -File "GenerateSitemapXML.ps1" | Out-Null
        Write-Host "  + sitemap.xml" -ForegroundColor Green
    } catch {
        Write-Host "  ! GenerateSitemapXML.ps1: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "[1/4] Scripts omitidos (-SkipScripts)" -ForegroundColor Gray
}

# ── Capturar archivos modificados (antes del commit) ─────────────────────────

$changedFiles = Get-GitChangedFiles

Write-Host ""
Write-Host "  Archivos con cambios: $($changedFiles.Count)" -ForegroundColor Gray
if ($changedFiles.Count -gt 0) {
    $changedFiles | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
}
Write-Host ""

# ── PASO 2: Git commit y push ─────────────────────────────────────────────────

if (-not $SkipGit) {
    Write-Host "[2/4] Git commit y push..." -ForegroundColor Cyan

    if ($changedFiles.Count -eq 0) {
        Write-Host "  Sin cambios pendientes en git." -ForegroundColor Gray
    } else {
        if ($Message -eq "") {
            $Message = "deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
        }
        git add -A
        git commit -m $Message
        git push
        Write-Host "  + Commit: '$Message'" -ForegroundColor Green
    }
} else {
    Write-Host "[2/4] Git omitido (-SkipGit)" -ForegroundColor Gray
}

# ── PASO 3: FTP Upload ────────────────────────────────────────────────────────

if (-not $SkipFtp) {
    $toUpload = $changedFiles | Where-Object { -not (Should-Ignore $_) }

    Write-Host "[3/4] Subiendo a produccion por FTP ($($toUpload.Count) archivos)..." -ForegroundColor Cyan

    if ($toUpload.Count -eq 0) {
        Write-Host "  Nada que subir." -ForegroundColor Gray
    } else {
        $ok = 0; $err = 0
        foreach ($file in $toUpload) {
            $localPath  = Join-Path $Root $file
            $remoteUrl  = "ftp://${FtpHost}:${FtpPort}/${FtpBase}/$($file -replace '\\', '/')"

            try {
                Upload-FtpFile $localPath $remoteUrl
                Write-Host "  + $file" -ForegroundColor Green
                $ok++
            } catch {
                Write-Host "  x $file -- $_" -ForegroundColor Red
                $err++
            }
        }

        $color = if ($err -gt 0) { 'Yellow' } else { 'Green' }
        Write-Host "  FTP: $ok subidos, $err errores." -ForegroundColor $color
    }
} else {
    Write-Host "[3/4] FTP omitido (-SkipFtp)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[4/4] Deploy completado." -ForegroundColor Cyan
Write-Host ""
