$dir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
Set-Location $dir

function Read-File($path) {
    return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function Get-Attr($tag, $attr) {
    $pattern = [regex]::Escape($attr) + '\s*=\s*["'']([^"'']+)["'']'
    $m = [regex]::Match($tag, $pattern, 'IgnoreCase')
    if ($m.Success) { return $m.Groups[1].Value.Trim() }
    return $null
}

# Lee el texto visible de un elemento identificado por clase, quitando tags internos
function Get-InnerText($html, $className) {
    $pattern = '<[^>]*class="[^"]*\b' + $className + '\b[^"]*"[^>]*>(.*?)</[^>]+>'
    $m = [regex]::Match($html, $pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if ($m.Success) {
        return ($m.Groups[1].Value -replace '<.*?>', '').Trim()
    }
    return $null
}

# Devuelve la ruta del src del <img> dentro del <picture class="page-image-source">
# Si no existe, devuelve el valor de data-image-fallback (mismo fallback que auto-seo)
function Get-PageImage($html) {
    $m = [regex]::Match(
        $html,
        '(?i)<picture[^>]*class="[^"]*\bpage-image-source\b[^"]*"[^>]*>.*?<img[^>]*src="([^"]+)"',
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    if ($m.Success) { return $m.Groups[1].Value }

    # Fallback: data-image-fallback en cualquier elemento del HTML
    $fb = [regex]::Match($html, 'data-image-fallback="([^"]+)"')
    if ($fb.Success) { return $fb.Groups[1].Value }

    return $null
}

function Split-ImagePath($path) {
    $ext  = [System.IO.Path]::GetExtension($path)
    $base = $path.Substring(0, $path.Length - $ext.Length)
    return @{ Base = $base; Ext = $ext }
}

function Normalize-ImagePath($p) {
    return $p -replace '^\.\./', ''
}

# =========================
# LEER GUIAS
# =========================

$files = Get-ChildItem -Filter '*.html' | Where-Object {
    $_.Name -notin @('index.html', 'index-template.html')
}

$metas = @()

foreach ($file in $files) {
    $text = Read-File $file.FullName

    # --- Título: desde page-title-source ---
    $title = Get-InnerText $text "page-title-source"
    if (-not $title) { Write-Host "SKIP (sin title): $($file.Name)"; continue }

    # --- Descripción: desde page-description-source ---
    $resumen = Get-InnerText $text "page-description-source"
    if (-not $resumen) { Write-Host "SKIP (sin description): $($file.Name)"; continue }

    # --- Imagen: desde page-image-source o data-image-fallback ---
    $img = Get-PageImage $text
    if (-not $img) { Write-Host "SKIP (sin imagen): $($file.Name)"; continue }

    # --- Metadatos específicos de guía: desde el <article class="guia-articulo"> ---
    $articleMatch = [regex]::Match($text, '<article\b[^>]*\bguia-articulo\b[^>]*>', 'IgnoreCase')
    $articleTag   = if ($articleMatch.Success) { $articleMatch.Value } else { "" }

    $alt    = Get-Attr $articleTag 'data-alt';      if (-not $alt)    { $alt    = $title }
    $cat    = Get-Attr $articleTag 'data-category'; if (-not $cat)    { $cat    = 'rest' }
    $feat   = Get-Attr $articleTag 'data-feature';  if (-not $feat)   { $feat   = '' }
    $topics = Get-Attr $articleTag 'data-topics';   if (-not $topics) { $topics = '' }

	# Elimina sufijos _mobile/_desktop si ya los tiene la ruta leída del HTML,
    # y construye las variantes limpias
    $imgParts   = Split-ImagePath $img
    $ext        = $imgParts.Ext
    $base       = $imgParts.Base -replace '_mobile$|_desktop$', ''
    $imgMobile  = "${base}_mobile${ext}"
    $imgDesktop = "${base}_desktop${ext}"

    # Rutas absolutas para el JSON (sin el ../ inicial)
    $imgAbs        = Normalize-ImagePath $img
    $imgMobileAbs  = Normalize-ImagePath $imgMobile
    $imgDesktopAbs = Normalize-ImagePath $imgDesktop

    $url = "guias/$($file.Name)"

    $metas += [PSCustomObject]@{
        File       = $file.Name
        Url        = $url
        Title      = $title
        Resumen    = $resumen
        Img        = $imgAbs
        ImgMobile  = $imgMobileAbs
        ImgDesktop = $imgDesktopAbs
        Alt        = $alt
        Category   = $cat.ToLower()
        Feature    = $feat.ToLower()
        Topic      = $topics.ToLower()
    }
}

# =========================
# DESTACADOS
# =========================

$dest = @()
$dest += $metas | Where-Object { $_.Feature -eq 'fixed' }

if ($dest.Count -lt 3) {
    $dest += $metas | Where-Object {
        $_.Category -eq 'core' -and $_ -notin $dest
    } | Select-Object -First (3 - $dest.Count)
}

if ($dest.Count -lt 3) {
    $dest += $metas | Where-Object {
        $_ -notin $dest
    } | Select-Object -First (3 - $dest.Count)
}

$listado = $metas | Where-Object { $_ -notin $dest }

# =========================
# TEMPLATE
# =========================

$template = Read-File (Join-Path $dir "index-template.html")

$tplDest = [regex]::Match($template, '(?s)<template id="tpl-destacado">(.*?)</template>').Groups[1].Value
$tplList = [regex]::Match($template, '(?s)<template id="tpl-listado">(.*?)</template>').Groups[1].Value

# =========================
# GENERAR HTML — DESTACADOS
# =========================

$cards = ""
foreach ($m in $dest) {
    $c = $tplDest
    $c = $c -replace '{{TITLE}}',          $m.Title
    $c = $c -replace '{{RESUMEN}}',        $m.Resumen
    $c = $c -replace '{{IMAGE_MOBILE}}',   "../$($m.ImgMobile)"
    $c = $c -replace '{{IMAGE_DESKTOP}}',  "../$($m.ImgDesktop)"
    $c = $c -replace '{{PAGE_URL}}',       "../$($m.Url)"
    $c = $c -replace '{{IMAGE_ALT}}',      $m.Alt
    $cards += $c
}

# =========================
# GENERAR HTML — LISTADO
# =========================

$listHtml = ""
foreach ($m in $listado) {
    $c = $tplList
    $c = $c -replace '{{TITLE}}',          $m.Title
    $c = $c -replace '{{RESUMEN}}',        $m.Resumen
    $c = $c -replace '{{IMAGE_MOBILE}}',   "../$($m.ImgMobile)"
    $c = $c -replace '{{IMAGE_DESKTOP}}',  "../$($m.ImgDesktop)"
    $c = $c -replace '{{PAGE_URL}}',       "../$($m.Url)"
    $c = $c -replace '{{IMAGE_ALT}}',      $m.Alt
    $listHtml += $c
}

# =========================
# INSERTAR EN TEMPLATE
# =========================

$output = $template
$output = $output -replace '{{DESTACADOS}}', $cards
$output = $output -replace '{{LISTADO}}',    $listHtml

# =========================
# ELIMINAR BLOQUES DE TEMPLATE
# =========================

$output = [regex]::Replace(
    $output,
    '(?s)<!-- ================== TEMPLATES \(NO SE RENDERIZAN\) ================== -->.*?<!-- ================== FIN TEMPLATES ================== -->',
    ''
)

# =========================
# JSON COMPACTO PARA JS
# =========================

$json   = $metas | ConvertTo-Json -Depth 5 -Compress
$output = $output -replace '<!--GUIAS_JSON-->', "<script id='guias-data' type='application/json'>$json</script>"

# =========================
# GUARDAR
# =========================

[System.IO.File]::WriteAllText((Join-Path $dir "index.html"), $output, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "OK: index.html generado con $($metas.Count) guias ($($dest.Count) destacadas, $($listado.Count) en listado)"