# generate-index.ps1

$dir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $dir

function Read-File($path) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Get-Attr($tag, $attr) {
    $pattern = [regex]::Escape($attr) + '\s*=\s*["'']([^"'']+)["'']'
    $m = [regex]::Match($tag, $pattern, 'IgnoreCase')
    if ($m.Success) { return $m.Groups[1].Value.Trim() }
    return $null
}

function Split-ImagePath($path) {
    $ext = [System.IO.Path]::GetExtension($path)
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
    $_.Name -notin @('index.html','index-template.html')
}

$metas = @()

foreach ($file in $files) {
    $text = Read-File $file.FullName

    $m = [regex]::Match($text, '<article\b[^>]*>', 'IgnoreCase')
    if (!$m.Success) { continue }

    $tag = $m.Value

    $title   = Get-Attr $tag 'data-title'
    $resumen = Get-Attr $tag 'data-resumen'
    $img     = Get-Attr $tag 'data-img'

    if (!$title -or !$resumen -or !$img) { continue }

    $alt    = Get-Attr $tag 'data-alt'; if (!$alt) { $alt = $title }
    $cat    = Get-Attr $tag 'data-category'; if (!$cat) { $cat = 'rest' }
    $feat   = Get-Attr $tag 'data-feature'; if (!$feat) { $feat = '' }
    $topics = Get-Attr $tag 'data-topics'; if (!$topics) { $topics = '' }

    $imgParts = Split-ImagePath $img
    $base = $imgParts.Base
    $ext  = $imgParts.Ext

    # Rutas relativas (HTML)
    $imgMobile  = "$base`_mobile$ext"
    $imgDesktop = "$base`_desktop$ext"

    # Rutas absolutas (JSON)
    $imgAbs        = Normalize-ImagePath $img
    $imgMobileAbs  = Normalize-ImagePath $imgMobile
    $imgDesktopAbs = Normalize-ImagePath $imgDesktop

    $url = "guias/$($file.Name)"

    $metas += [PSCustomObject]@{
        File = $file.Name
        Url  = $url
        Title = $title
        Resumen = $resumen

        Img = $imgAbs
        ImgMobile = $imgMobileAbs
        ImgDesktop = $imgDesktopAbs

        Alt = $alt
        Category = $cat.ToLower()
        Feature = $feat.ToLower()
        Topic = $topics.ToLower()
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

$template = Read-File ".\index-template.html"

$tplDest = [regex]::Match($template, '(?s)<template id="tpl-destacado">(.*?)</template>').Groups[1].Value
$tplList = [regex]::Match($template, '(?s)<template id="tpl-listado">(.*?)</template>').Groups[1].Value

# =========================
# GENERAR HTML
# =========================

$cards = ""
foreach ($m in $dest) {
    $c = $tplDest
    $c = $c -replace '{{TITLE}}', $m.Title
    $c = $c -replace '{{RESUMEN}}', $m.Resumen
    $c = $c -replace '{{IMAGE_MOBILE}}', "../$($m.ImgMobile)"
    $c = $c -replace '{{IMAGE_DESKTOP}}', "../$($m.ImgDesktop)"
    $c = $c -replace '{{PAGE_URL}}', "../$($m.Url)"
    $c = $c -replace '{{IMAGE_ALT}}', $m.Alt

    $cards += $c
}

$listHtml = ""
foreach ($m in $listado) {
    $c = $tplList
    $c = $c -replace '{{TITLE}}', $m.Title
    $c = $c -replace '{{RESUMEN}}', $m.Resumen
    $c = $c -replace '{{IMAGE_MOBILE}}', "../$($m.ImgMobile)"
    $c = $c -replace '{{IMAGE_DESKTOP}}', "../$($m.ImgDesktop)"
    $c = $c -replace '{{PAGE_URL}}', "../$($m.Url)"
    $c = $c -replace '{{IMAGE_ALT}}', $m.Alt

    $listHtml += $c
}

# =========================
# INSERTAR EN TEMPLATE
# =========================

$output = $template
$output = $output -replace '{{DESTACADOS}}', $cards
$output = $output -replace '{{LISTADO}}', $listHtml

# =========================
# ELIMINAR TEMPLATES DEL OUTPUT
# =========================

$output = [regex]::Replace(
    $output,
    '(?s)<!-- ================== TEMPLATES \(NO SE RENDERIZAN\) ================== -->.*?<!-- ================== FIN TEMPLATES ================== -->',
    ''
)

# =========================
# JSON COMPACTO (CORRECTO)
# =========================

$json = $metas | ConvertTo-Json -Depth 5 -Compress

$output = $output -replace '<!--GUIAS_JSON-->', "<script id='guias-data' type='application/json'>$json</script>"

# =========================
# GUARDAR
# =========================

[System.IO.File]::WriteAllText("index.html", $output, (New-Object System.Text.UTF8Encoding($false)))