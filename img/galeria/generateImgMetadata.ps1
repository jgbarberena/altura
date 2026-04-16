$exiftool = "D:\ImageProcessing\exiftool\exiftool.exe"

$jsonPath = "./galeria.json"

if (!(Test-Path $jsonPath)) {
    Write-Host "galeria.json not found"
    exit
}

# Leer JSON en UTF-8
$jsonText = Get-Content $jsonPath -Raw -Encoding UTF8
$images = $jsonText | ConvertFrom-Json

Write-Host "Reescribiendo metadatos XMP..."

foreach ($img in $images) {

    # Convertir rutas web a rutas locales reales
    $desktopPath = "." + ($img.desktop -replace "^/img/galeria/", "/")
    $mobilePath  = "." + ($img.mobile  -replace "^/img/galeria/", "/")

    $desktopPath = $desktopPath -replace "^./", "./"
    $mobilePath  = $mobilePath  -replace "^./", "./"

    foreach ($filePath in @($desktopPath, $mobilePath)) {

        if (!(Test-Path $filePath)) {
            Write-Host "Missing file: $filePath"
            continue
        }

        $description = $img.alt
        $subject     = $img.clasificacion
        $rating      = $img.weight

        Write-Host "Actualizando: $filePath"

        # UTF-8 sin BOM, con validación estricta
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false, $true)

        $descFile = [System.IO.Path]::GetTempFileName()
        $subjFile = [System.IO.Path]::GetTempFileName()

        [System.IO.File]::WriteAllText($descFile, $description, $utf8NoBom)
        [System.IO.File]::WriteAllText($subjFile, $subject,     $utf8NoBom)

        & $exiftool `
            -overwrite_original `
            "-XMP:Description<=$descFile" `
            "-XMP:Subject<=$subjFile" `
            -XMP:Rating=$rating `
            $filePath

        Remove-Item $descFile, $subjFile -ErrorAction SilentlyContinue
    }
}

Write-Host "Metadatos reescritos correctamente."
