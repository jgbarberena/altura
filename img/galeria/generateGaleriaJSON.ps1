# =====================================
# generateGaleriaJSON.ps1
# Genera galeria.json leyendo los JPG existentes y sus metadatos XMP.
# Ejecutar dentro de img/galeria/
# Requiere exiftool instalado en la ruta indicada.
# =====================================

$exiftool   = "D:\ImageProcessing\exiftool\exiftool.exe"
$folder     = "."
$outputJson = "./galeria.json"

# =====================================
# 1. AGRUPAR JPG POR NOMBRE BASE
# =====================================
# Reconoce archivos con sufijo _desktop o _mobile.
# Ignora cualquier otro JPG (sin sufijo, _thumb, etc.)

$groups = @{}

foreach ($file in Get-ChildItem $folder -Filter *.jpg) {

    $name = $file.Name

    if ($name -match "^(.+)_desktop\.jpg$") {
        $base = $matches[1]
        if (-not $groups.ContainsKey($base)) { $groups[$base] = @{ desktop = ""; mobile = "" } }
        $groups[$base].desktop = $name
        continue
    }

    if ($name -match "^(.+)_mobile\.jpg$") {
        $base = $matches[1]
        if (-not $groups.ContainsKey($base)) { $groups[$base] = @{ desktop = ""; mobile = "" } }
        $groups[$base].mobile = $name
        continue
    }
}

# =====================================
# 2. FILTRAR GRUPOS INCOMPLETOS
# =====================================
# Solo incluir imágenes que tengan ambas versiones.

$complete = $groups.GetEnumerator() | Where-Object {
    $_.Value.desktop -ne "" -and $_.Value.mobile -ne ""
}

if (-not $complete) {
    Write-Host "No se encontraron pares _desktop/_mobile completos." -ForegroundColor Yellow
    exit
}

# =====================================
# 3. LEER METADATOS Y CONSTRUIR JSON
# =====================================

$result = @()
$total  = @($complete).Count
$i      = 0

foreach ($entry in ($complete | Sort-Object Name)) {
    $i++

    $base    = $entry.Name
    $desktop = $entry.Value.desktop
    $mobile  = $entry.Value.mobile

    Write-Host "Writing image: $base ($i of $total)..."

    # Leer metadatos XMP desde el archivo desktop
    $alt          = & $exiftool -s -s -s -XMP:Description "$folder/$desktop"
    $clasificacion = & $exiftool -s -s -s -XMP:Subject     "$folder/$desktop"
    $weight       = & $exiftool -s -s -s -XMP:Rating       "$folder/$desktop"

    # Avisar si faltan metadatos (no bloquea, el objeto se incluye igualmente)
    if (-not $alt)          { Write-Host "AVISO: sin Description en $desktop" -ForegroundColor Yellow }
    if (-not $clasificacion) { Write-Host "AVISO: sin Subject en $desktop"     -ForegroundColor Yellow }
    if (-not $weight)       { Write-Host "AVISO: sin Rating en $desktop"       -ForegroundColor Yellow }

    $result += [PSCustomObject]@{
        id            = $base
        desktop       = $desktop
        mobile        = $mobile
        alt           = "$alt"
        clasificacion = "$clasificacion"
        weight        = "$weight"
    }
}

# =====================================
# 4. ESCRIBIR JSON
# =====================================

$result | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $outputJson

Write-Host ""
Write-Host "galeria.json generado: $($result.Count) imágenes." -ForegroundColor Green