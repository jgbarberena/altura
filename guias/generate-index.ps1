# generate-index.ps1 (version limpia sin tildes en literales)
# ejecutar desca carpeta guias con: powershell -NoProfile -ExecutionPolicy Bypass -File .\generate-index.ps1
# Usa main.template.html con plantillas internas para generar cards y listado.

$dir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $dir

function Read-File($path) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $utf8 = [System.Text.Encoding]::UTF8.GetString($bytes)
    if ($utf8 -match 'Ã|�') {
        return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::Default)
    }
    return $utf8
}

function Get-Attr($tag, $attr) {
    $pattern = [regex]::Escape($attr) + '\s*=\s*["'']([^"'']+)["'']'
    $m = [regex]::Match($tag, $pattern, 'IgnoreCase')
    if ($m.Success) { return $m.Groups[1].Value.Trim() }
    return $null
}

# Archivos a ignorar
$skip = @('index.html','generate-index.ps1','main.template.html')

# Buscar articulos
$htmlFiles = Get-ChildItem -Filter '*.html' | Where-Object { $skip -notcontains $_.Name }

$metas = @()

foreach ($file in $htmlFiles) {
    $text = Read-File $file.FullName

    $m = [regex]::Match($text, '<article\b[^>]*>', 'IgnoreCase,Singleline')
    if (-not $m.Success) { continue }
    $tag = $m.Value

    $title = Get-Attr $tag 'data-title'
    $resumen = Get-Attr $tag 'data-resumen'
    $img = Get-Attr $tag 'data-img'
    if (-not $title -or -not $resumen -or -not $img) { continue }

    $alt = Get-Attr $tag 'data-alt'; if (-not $alt) { $alt = $title }
    $cat = Get-Attr $tag 'data-category'; if (-not $cat) { $cat = 'rest' }
    $feat = Get-Attr $tag 'data-feature'; if (-not $feat) { $feat = '' }

    $metas += [PSCustomObject]@{
        File = $file.Name
        Url = "./$($file.Name)"
        Title = $title
        Resumen = $resumen
        Img = $img
        Alt = $alt
        Category = $cat.ToLower()
        Feature = $feat.ToLower()
    }
}

# Seleccion de destacados
$fixed = $metas | Where-Object { $_.Feature -in @('fixed','primary') }
$core = $metas | Where-Object { $_.Category -eq 'core' } | Select-Object -First 1
$rest = $metas | Where-Object { $_.Category -eq 'rest' } | Select-Object -First 1

$used = @{}
foreach ($f in $fixed) { $used[$f.File] = $true }
if ($core) { $used[$core.File] = $true }
if ($rest) { $used[$rest.File] = $true }

$dest = @()
$dest += $fixed
if ($core) { $dest += $core }
if ($rest) { $dest += $rest }

$listado = $metas | Where-Object { -not $used.ContainsKey($_.File) }

# Leer main.template.html
$mainTpl = Get-Content -Raw -Encoding UTF8 .\main.template.html

# Extraer plantillas internas
$tplDest = [regex]::Match($mainTpl, '<template id="tpl-destacado">(.*?)</template>', 'Singleline').Groups[1].Value
$tplList = [regex]::Match($mainTpl, '<template id="tpl-listado">(.*?)</template>', 'Singleline').Groups[1].Value

# Generar destacados
$cards = ""
foreach ($m in $dest) {
    $c = $tplDest
    $c = $c -replace '\{\{IMAGE_URL\}\}', $m.Img
    $c = $c -replace '\{\{IMAGE_ALT\}\}', $m.Alt
    $c = $c -replace '\{\{TITLE\}\}', $m.Title
    $c = $c -replace '\{\{RESUMEN\}\}', $m.Resumen
    $c = $c -replace '\{\{PAGE_URL\}\}', $m.Url
    $cards += $c + "`n"
}

# Generar listado
$listHtml = ""
foreach ($m in $listado) {
    $c = $tplList
    $c = $c -replace '\{\{IMAGE_URL\}\}', $m.Img
    $c = $c -replace '\{\{IMAGE_ALT\}\}', $m.Alt
    $c = $c -replace '\{\{TITLE\}\}', $m.Title
    $c = $c -replace '\{\{RESUMEN\}\}', $m.Resumen
    $c = $c -replace '\{\{PAGE_URL\}\}', $m.Url
    $listHtml += $c + "`n"
}

# Insertar en main
$mainFilled = $mainTpl -replace '\{\{CARDS\}\}', $cards
$mainFilled = $mainFilled -replace '\{\{LISTADO\}\}', $listHtml

# Leer index.template.html
$template = Read-File .\index.template.html

# Insertar main
$new = [regex]::Replace($template, '<main\b.*?>.*?</main>', $mainFilled, 'Singleline')

# Crear JSON
$json = $metas | ConvertTo-Json -Depth 5

# Insertar JSON al final del <body>
$new = $new -replace '<!--GUIAS_JSON-->', "<!--GUIAS_JSON-->`n<script id='guias-data' type='application/json'>$json</script>`n"

# Escribir index.html
[System.IO.File]::WriteAllText('.\index.html', $new, (New-Object System.Text.UTF8Encoding($false)))
