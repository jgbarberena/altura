$exiftool = "D:\ImageProcessing\exiftool\exiftool.exe"
$magick   = "D:\ImageProcessing\ImageMagick\magick.exe"

# Ejecutas este script dentro de img/galeria
$folder = "."
$outputJson = "./galeria.json"

# Obtener todos los JPG
$files = Get-ChildItem $folder -Filter *.jpg

# Diccionario para agrupar por nombre base
$groups = @{}

foreach ($file in $files) {

    $name = $file.Name

    # Caso 1: archivo con _desktop
    if ($name -match "^(.*)_desktop\.jpg$") {
        $base = $matches[1]
        if (-not $groups.ContainsKey($base)) {
            $groups[$base] = @{ desktop = ""; mobile = "" }
        }
        $groups[$base].desktop = "$folder/$name"
        continue
    }

    # Caso 2: archivo con _mobile
    if ($name -match "^(.*)_mobile\.jpg$") {
        $base = $matches[1]
        if (-not $groups.ContainsKey($base)) {
            $groups[$base] = @{ desktop = ""; mobile = "" }
        }
        $groups[$base].mobile = "$folder/$name"
        continue
    }

    # Caso 3: archivo sin sufijo -> crear ambos
    if ($name -match "^(.*)\.jpg$") {
        $base = $matches[1]

        $desktop = "$folder/${base}_desktop.jpg"
        $mobile  = "$folder/${base}_mobile.jpg"

        # Crear desktop
        & $magick "$folder/$name" -resize "1920x1080>" $desktop

        # Crear mobile
        & $magick "$folder/$name" -resize "800x600>" $mobile

        # Crear WebP
        & $magick $desktop -quality 85 "$folder/${base}_desktop.webp"
        & $magick $mobile  -quality 85 "$folder/${base}_mobile.webp"

        # Borrar original
        Remove-Item "$folder/$name"

        # Registrar en grupos
        $groups[$base] = @{
            desktop = $desktop
            mobile  = $mobile
        }

        continue
    }
}

# Asegurar que existen ambas versiones
foreach ($base in $groups.Keys) {

    $desktop = $groups[$base].desktop
    $mobile  = $groups[$base].mobile

    if ($desktop -eq "" -and $mobile -ne "") {
        $desktop = "$folder/${base}_desktop.jpg"
        & $magick $mobile -resize "1920x1080>" $desktop
        $groups[$base].desktop = $desktop
    }

    if ($mobile -eq "" -and $desktop -ne "") {
        $mobile = "$folder/${base}_mobile.jpg"
        & $magick $desktop -resize "800x600>" $mobile
        $groups[$base].mobile = $mobile
    }

    # Crear WebP si no existen
    $desktopWebp = "$folder/${base}_desktop.webp"
    $mobileWebp  = "$folder/${base}_mobile.webp"

    if (!(Test-Path $desktopWebp)) {
        & $magick $desktop -quality 85 $desktopWebp
    }

    if (!(Test-Path $mobileWebp)) {
        & $magick $mobile -quality 85 $mobileWebp
    }
}

# Generar JSON
$result = @()

foreach ($base in ($groups.Keys | Sort-Object)) {

    $desktopPath = $groups[$base].desktop
    $mobilePath  = $groups[$base].mobile

    # Leer metadatos desde desktop (UTF-8 real en PowerShell 7)
    $description = & $exiftool -s -s -s -XMP:Description $desktopPath
    $subject     = & $exiftool -s -s -s -XMP:Subject $desktopPath
    $rating      = & $exiftool -s -s -s -XMP:Rating $desktopPath

    # ALT con tildes correctas (no normalizamos)
    $alt = $description

    # Rutas absolutas correctas
    $desktopAbs = "/img/galeria/" + ($desktopPath -replace "^\.\/", "")
    $mobileAbs  = "/img/galeria/" + ($mobilePath -replace "^\.\/", "")

    $obj = [PSCustomObject]@{
        id            = $base
        desktop       = $desktopAbs
        mobile        = $mobileAbs
        alt           = $alt
        clasificacion = $subject
        weight        = $rating
    }

    $result += $obj
}

# PowerShell 7 escribe UTF-8 real por defecto
$result | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $outputJson

Write-Host "galeria.json generado correctamente (UTF-8 real, tildes preservadas)."
