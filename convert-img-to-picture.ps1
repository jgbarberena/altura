$root = "."   # Carpeta raíz del proyecto
$imgExt = @(".jpg", ".jpeg", ".png", ".webp")

# Archivo de informe para imágenes sin alt
$report = Join-Path $root "imagenes_sin_alt.txt"
Remove-Item $report -ErrorAction SilentlyContinue
Add-Content $report "IMÁGENES SIN ALT:`n"

# Regex para <img> con alt
$regexWithAlt = '<img\s+([^>]*?)src="([^"]+)"([^>]*?)alt="([^"]+)"([^>]*)>'
# Regex para <img> sin alt
$regexNoAlt = '<img\s+([^>]*?)src="([^"]+)"(?![^>]*alt=)[^>]*>'

Get-ChildItem -Path $root -Recurse -Filter *.html | ForEach-Object {

    $file = $_.FullName
    $content = Get-Content $file -Raw
    $modified = $false

    # 1. Detectar imágenes sin alt
    $matchesNoAlt = [regex]::Matches($content, $regexNoAlt)
    foreach ($m in $matchesNoAlt) {
        $line = ($content.Substring(0, $m.Index).Split("`n").Count)
        Add-Content $report "$file (línea $line): $($m.Groups[2].Value)"
    }

    # 2. Sustituir imágenes con alt
    if ($content -match $regexWithAlt) {

        Write-Host "Procesando $file" -ForegroundColor Cyan

        # Copia de seguridad
        Copy-Item $file "$file.bak" -Force

        $newContent = [regex]::Replace($content, $regexWithAlt, {
            param($match)

            # Capturas
            $beforeSrc = $match.Groups[1].Value
            $src = $match.Groups[2].Value
            $between = $match.Groups[3].Value
            $alt = $match.Groups[4].Value
            $afterAlt = $match.Groups[5].Value

            # Ruta absoluta de la imagen original
            $imgPath = Join-Path (Split-Path $file) $src

            # Generar rutas nuevas
            $ext = [IO.Path]::GetExtension($src)
            $base = $src.Substring(0, $src.Length - $ext.Length)

            $mobile = "${base}_mobile$ext"
            $desktop = "${base}_desktop$ext"

            # Crear copias de imagen
            $imgDir = Split-Path $imgPath
            $origImg = Join-Path $imgDir (Split-Path $src -Leaf)
            $mobileImg = Join-Path $imgDir (Split-Path $mobile -Leaf)
            $desktopImg = Join-Path $imgDir (Split-Path $desktop -Leaf)

            if (Test-Path $origImg) {
                Copy-Item $origImg $mobileImg -Force
                Copy-Item $origImg $desktopImg -Force
            }

            # Construir el <picture> con lazy loading
            return @"
<picture>
    <source media="(max-width: 768px)" srcset="$mobile">
    <source media="(min-width: 769px)" srcset="$desktop">
    <img src="$desktop" alt="$alt" loading="lazy">
</picture>
"@
        })

        $modified = $true
        Set-Content -Path $file -Value $newContent -Encoding UTF8
    }
}

Write-Host "`nProceso completado." -ForegroundColor Green
Write-Host "Revisa el archivo: $report" -ForegroundColor Yellow
