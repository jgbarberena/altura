$magick = "D:\ImageProcessing\ImageMagick\magick.exe"

Write-Host "=== Script iniciado ==="
Write-Host "Usando ImageMagick en: $magick"
Write-Host ""

$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Carpeta de trabajo: $folder"
Write-Host ""

$extensions = "*.jpg","*.jpeg","*.png","*.webp","*.tif","*.tiff","*.bmp","*.heic","*.HEIC"

$images = Get-ChildItem -Path "$folder\*" -Include $extensions -File

Write-Host "Imagenes encontradas: $($images.Count)"
Write-Host ""

if ($images.Count -eq 0) {
    Write-Host "No se encontraron imagenes. Saliendo..."
    exit
}

foreach ($img in $images) {

    Write-Host "---------------------------------------------"
    Write-Host "Procesando: $($img.Name)"

    Write-Host "Obteniendo dimensiones..."
    $info = & $magick identify -format "%w %h" "$($img.FullName)" 2>&1

    if (-not $info) {
        Write-Host "ERROR: ImageMagick no devolvio dimensiones."
        Write-Host "Salida completa:"
        Write-Host $info
        continue
    }

    $parts = $info.Split(" ")
    $w = [int]$parts[0]
    $h = [int]$parts[1]

    Write-Host "Dimensiones detectadas: ${w}x${h}"

    $targetW = 1920
    $targetH = 1080
    $targetRatio = $targetW / $targetH
    $imgRatio = $w / $h

    if ($imgRatio -gt $targetRatio) {
        $resize = "x1080"
        Write-Host "Imagen apaisada -> resize = $resize"
    } else {
        $resize = "1920x"
        Write-Host "Imagen vertical -> resize = $resize"
    }

    $newFile = Join-Path $folder ($img.BaseName + ".jpg")
    Write-Host "Archivo final: $newFile"

    Write-Host "Ejecutando ImageMagick:"
    Write-Host "$magick $($img.FullName) -resize $resize -quality 90 $newFile"

    $result = & $magick "$($img.FullName)" -resize $resize -quality 90 "$newFile" 2>&1

    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR ejecutando convert:"
        Write-Host $result
        continue
    }

    Write-Host "Conversion OK."

    if ($img.FullName -ne $newFile) {
        Write-Host "Eliminando original: $($img.FullName)"
        Remove-Item "$($img.FullName)"
    }

    Write-Host "Procesado correctamente."
}

Write-Host ""
Write-Host "=== Script finalizado ==="
