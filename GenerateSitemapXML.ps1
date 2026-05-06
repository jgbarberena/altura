$rootPath = (Get-Location).Path
$baseUrl  = "https://www.experienciasanfermin.com"

$excludeFolders = @("img", "css", "js", "components")
$excludeFiles   = @("index-template.html")

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# =========================
# HELPERS
# =========================

function Get-Attribute($html, $attr) {
    $m = [regex]::Match($html, $attr + '="([^"]*)"')
    if ($m.Success) { return $m.Groups[1].Value.Trim() }
    return ""
}

# URLs canónicas: /index.html -> /  ,  /guias/index.html -> /guias/
function Clean-Url($url) {
    if ($url -match '/index\.html$') {
        return $url -replace '/index\.html$', '/'
    }
    return $url
}

# changefreq se infiere del tipo de página — no necesita data-* propio
function Get-ChangeFreq([string]$pageType) {
    switch ($pageType) {
        "website" { return "weekly"  }
        "landing" { return "monthly" }
        "index"   { return "weekly"  }
        "article" { return "monthly" }
        "faq"     { return "monthly" }
        "about"   { return "monthly" }
        "store"   { return "weekly"  }
        "legal"   { return "yearly"  }
        default   { return "monthly" }
    }
}

# Prioridad por defecto si no hay data-priority explícito en la página
function Get-DefaultPriority([string]$pageType) {
    switch ($pageType) {
        "website" { return "1.0" }
        "landing" { return "0.9" }
        "store"   { return "0.8" }
        "index"   { return "0.7" }
        "faq"     { return "0.7" }
        "about"   { return "0.6" }
        "article" { return "0.6" }
        "legal"   { return "0.3" }
        default   { return "0.5" }
    }
}

# =========================
# ESCANEAR HTML
# =========================

$pages = @()

Get-ChildItem -Path $rootPath -Recurse -Filter "*.html" | Where-Object {

    $path = $_.FullName

    foreach ($f in $excludeFolders) {
        if ($path -like "*\$f\*") { return $false }
    }

    if ($excludeFiles -contains $_.Name) { return $false }

    return $true

} | ForEach-Object {

    $file = $_.FullName
    $html = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

    # Solo páginas del sitio: deben tener class="...page-data..."
    if ($html -notmatch 'class="[^"]*\bpage-data\b') { return }

    [string]$pageType = Get-Attribute $html "data-page-type"
    [string]$modified = Get-Attribute $html "data-modified"
    [string]$priority = Get-Attribute $html "data-priority"

    # Prioridad: data-priority explícito si existe y no está vacío, si no default por tipo
    if ([string]::IsNullOrWhiteSpace($priority)) {
        $priority = Get-DefaultPriority $pageType
    }

    # Fecha: data-modified si existe, si no hoy
    if ([string]::IsNullOrEmpty($modified)) {
        $modified = (Get-Date -Format "yyyy-MM-dd")
    }

    [string]$changefreq = Get-ChangeFreq $pageType
    [string]$relative   = $file.Substring($rootPath.Length).Replace("\", "/").TrimStart("/")
    [string]$url        = Clean-Url "$baseUrl/$relative"

    $pages += [PSCustomObject]@{
        Url        = $url
        LastMod    = $modified
        ChangeFreq = $changefreq
        Priority   = $priority
    }

    Write-Host "OK [$priority] $relative"
}

# =========================
# SITEMAP.XML
# =========================

$urlEntries = ""
foreach ($p in $pages | Sort-Object { [float]$_.Priority } -Descending) {
    $urlEntries += @"
  <url>
    <loc>$($p.Url)</loc>
    <lastmod>$($p.LastMod)</lastmod>
    <changefreq>$($p.ChangeFreq)</changefreq>
    <priority>$($p.Priority)</priority>
  </url>
"@
}

$sitemap = @"
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
$urlEntries</urlset>
"@

[System.IO.File]::WriteAllText("$rootPath\sitemap.xml", $sitemap, $utf8NoBom)
Write-Host "`nOK: sitemap.xml generado con $($pages.Count) URLs"

# =========================
# ROBOTS.TXT
# =========================

# Solo bloquear lo que Google no necesita para renderizar ni indexar.
# CSS, JS e imágenes deben estar accesibles para que Google renderice correctamente.
$robots = @"
User-agent: *
Allow: /

Disallow: /components/
Disallow: /admin/

Sitemap: $baseUrl/sitemap.xml
"@

[System.IO.File]::WriteAllText("$rootPath\robots.txt", $robots, $utf8NoBom)
Write-Host "OK: robots.txt generado"