# --- Configuración ---
$exiftool = "D:\ImageProcessing\exiftool\exiftool.exe"

# Ejecutar dentro de img/galeria
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
        $groups[$base].desktop = $name
        continue
    }

    # Caso 2: archivo con _mobile
    if ($name -match "^(.*)_mobile\.jpg$") {
        $base = $matches[1]
        if (-not $groups.ContainsKey($base)) {
            $groups[$base] = @{ desktop = ""; mobile = "" }
        }
        $groups[$base].mobile = $name
        continue
    }

    # Caso 3: archivo sin sufijo -> usarlo para ambos
    if ($name -match "^(.*)\.jpg$") {
        $base = $matches[1]

        if (-not $groups.ContainsKey($base)) {
            $groups[$base] = @{ desktop = ""; mobile = "" }
        }

        # Asignar el mismo archivo a desktop y mobile
        $groups[$base].desktop = $name
        $groups[$base].mobile  = $name

        continue
    }
}

# --- Generar JSON ---
$result = @()

foreach ($base in ($groups.Keys | Sort-Object)) {

    $desktop = $groups[$base].desktop
    $mobile  = $groups[$base].mobile

    # Leer metadatos desde desktop (si existe)
    $description = ""
    $subject     = ""
    $rating      = ""

    if ($desktop -ne "") {
        $description = & $exiftool -s -s -s -XMP:Description "$folder/$desktop"
        $subject     = & $exiftool -s -s -s -XMP:Subject "$folder/$desktop"
        $rating      = & $exiftool -s -s -s -XMP:Rating "$folder/$desktop"
    }

    # ALT = description
    $alt = $description

    # --- Rutas: SOLO nombre de archivo ---
    $desktopRel = $desktop
    $mobileRel  = $mobile

    $obj = [PSCustomObject]@{
        id            = $base
        desktop       = $desktopRel
        mobile        = $mobileRel
        alt           = $alt
        clasificacion = $subject
        weight        = $rating
    }

    $result += $obj
}

# Guardar JSON en UTF-8 real
$result | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $outputJson

Write-Host "galeria.json generado correctamente (READ ONLY, sin modificar imágenes, sin rutas)."
