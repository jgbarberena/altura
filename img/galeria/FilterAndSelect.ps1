# ============================================================
# ImageClassifier.ps1
# Herramienta de clasificacion y metadatos de imagenes
# Ejecutar desde la carpeta que contiene las imagenes
# ============================================================

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ============================================================
# CONFIGURACION
# ============================================================

$exiftool      = "D:\ImageProcessing\exiftool\exiftool.exe"
$LOW_RES_LIMIT = 600

# ============================================================
# ESTADO GLOBAL
# ============================================================

$script:WorkFolder  = $PWD.Path
$script:ImageGroups = @()
$script:CurrentIdx  = 0
$script:ImgDesktop  = $null
$script:ImgMobile   = $null

# ============================================================
# FUNCIONES AUXILIARES
# ============================================================

function Get-BaseName ($filename) {
    $name = [System.IO.Path]::GetFileNameWithoutExtension($filename)
    $name = $name -replace '_(desktop|mobile)$', ''
    return $name
}

function Get-ImageSet ($folder, $baseName) {
    return @(
        [System.IO.Path]::Combine($folder, "${baseName}_desktop.jpg"),
        [System.IO.Path]::Combine($folder, "${baseName}_desktop.webp"),
        [System.IO.Path]::Combine($folder, "${baseName}_mobile.jpg"),
        [System.IO.Path]::Combine($folder, "${baseName}_mobile.webp")
    )
}

function Load-ImageGroups ($folder) {
    $exts  = @(".jpg", ".webp")
    $files = Get-ChildItem -Path $folder -File |
             Where-Object { $exts -contains $_.Extension.ToLower() } |
             Where-Object { $_.Name -match '_(desktop|mobile)\.' }
    $bases = $files | ForEach-Object { Get-BaseName $_.Name } | Sort-Object -Unique
    $script:ImageGroups = @($bases)
}

function Read-Metadata ($filePath) {
    $result = @{ Alt = ""; Categories = ""; Rank = "" }
    if (-not (Test-Path $exiftool)) { return $result }
    if (-not $filePath -or -not (Test-Path $filePath)) { return $result }
    $raw = & $exiftool -XMP-dc:Description -XMP-dc:Subject -XMP-xmp:Rating -s3 $filePath 2>$null
    if ($raw -and $raw.Count -ge 3) {
        $result.Alt        = $raw[0]
        $result.Categories = $raw[1]
        $result.Rank       = $raw[2]
    } elseif ($raw -and $raw.Count -eq 2) {
        $result.Alt        = $raw[0]
        $result.Categories = $raw[1]
    } elseif ($raw -and $raw.Count -eq 1) {
        $result.Alt = $raw[0]
    }
    return $result
}

function Save-Metadata ($folder, $baseName, $alt, $categories, $rank) {
    if (-not (Test-Path $exiftool)) { return }
    $files = Get-ImageSet $folder $baseName | Where-Object { Test-Path $_ }
    foreach ($f in $files) {
        $eArgs = @("-overwrite_original", "-XMP-dc:Description=$alt", "-XMP-dc:Subject=$categories")
        if ($rank -ne "") { $eArgs += "-XMP-xmp:Rating=$rank" }
        $eArgs += $f
        & $exiftool @eArgs 2>$null | Out-Null
    }
}

function Move-ImageSet ($folder, $baseName, $destSubfolder) {
    $destPath = [System.IO.Path]::Combine($folder, $destSubfolder)
    if (-not (Test-Path $destPath)) { New-Item -ItemType Directory -Path $destPath | Out-Null }
    foreach ($f in (Get-ImageSet $folder $baseName)) {
        if (Test-Path $f) {
            $dst = [System.IO.Path]::Combine($destPath, [System.IO.Path]::GetFileName($f))
            Move-Item -LiteralPath $f -Destination $dst -Force
        }
    }
}

function Load-ImageSafe ($path) {
    if (-not $path -or -not (Test-Path $path)) { return $null }
    try {
        $tmp = New-Object System.Drawing.Bitmap($path)
        $bmp = New-Object System.Drawing.Bitmap($tmp.Width, $tmp.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $g   = [System.Drawing.Graphics]::FromImage($bmp)
        $g.DrawImage($tmp, 0, 0)
        $g.Dispose()
        $tmp.Dispose()
        return $bmp
    } catch { return $null }
}

function Draw-Preview ($panel, $img, $iW, $iH) {
    $bmp = New-Object System.Drawing.Bitmap([Math]::Max(1,$panel.Width), [Math]::Max(1,$panel.Height))
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::FromArgb(35, 35, 38))
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    if ($img -ne $null -and $panel.Width -gt 10 -and $panel.Height -gt 10) {
        $pw    = $panel.Width  - 10
        $ph    = $panel.Height - 10
        $scale = [Math]::Min($pw / $img.Width, $ph / $img.Height)
        $dw    = [int]($img.Width  * $scale)
        $dh    = [int]($img.Height * $scale)
        $dx    = [int](($panel.Width  - $dw) / 2)
        $dy    = [int](($panel.Height - $dh) / 2)
        $g.DrawImage($img, $dx, $dy, $dw, $dh)
        if ($iW -lt $LOW_RES_LIMIT -or $iH -lt $LOW_RES_LIMIT) {
            $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Red, 4)
            $g.DrawRectangle($pen, $dx, $dy, $dw - 1, $dh - 1)
            $pen.Dispose()
        }
    }
    $g.Dispose()
    if ($panel.BackgroundImage -ne $null) { $panel.BackgroundImage.Dispose() }
    $panel.BackgroundImage = $bmp
}

function Update-ResLabel ($lbl, $img, $w, $h) {
    if ($img -eq $null) { $lbl.Text = ""; return }
    if ($w -lt $LOW_RES_LIMIT -or $h -lt $LOW_RES_LIMIT) {
        $lbl.Text      = "(!!) BAJA RESOLUCION: ${w}x${h} px"
        $lbl.ForeColor = [System.Drawing.Color]::FromArgb(255, 80, 80)
    } else {
        $lbl.Text      = "${w}x${h} px"
        $lbl.ForeColor = [System.Drawing.Color]::FromArgb(100, 200, 100)
    }
}

function Dispose-CurrentImages {
    if ($script:ImgDesktop -ne $null) { $script:ImgDesktop.Dispose(); $script:ImgDesktop = $null }
    if ($script:ImgMobile  -ne $null) { $script:ImgMobile.Dispose();  $script:ImgMobile  = $null }
}

# ============================================================
# FORMULARIO - layout fijo, sin Dock en paneles internos
# Alturas fijas: titulo=32, preview=300, meta=180, botones=76
# ============================================================

$TITLE_H   = 32
$PREVIEW_H = 300
$META_H    = 180
$BTN_H     = 76
$FORM_H    = $TITLE_H + $PREVIEW_H + $META_H + $BTN_H + 40   # +40 barra titulo OS
$FORM_W    = 1100

$form               = New-Object System.Windows.Forms.Form
$form.Text          = "ImageClassifier"
$form.ClientSize    = New-Object System.Drawing.Size($FORM_W, ($TITLE_H + $PREVIEW_H + $META_H + $BTN_H))
$form.MinimumSize   = New-Object System.Drawing.Size(800, 500)
$form.BackColor     = [System.Drawing.Color]::FromArgb(28, 28, 30)
$form.ForeColor     = [System.Drawing.Color]::FromArgb(220, 220, 220)
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.Font          = New-Object System.Drawing.Font("Segoe UI", 9)

# --- Titulo ---
$lblTitle            = New-Object System.Windows.Forms.Label
$lblTitle.SetBounds(0, 0, $FORM_W, $TITLE_H)
$lblTitle.Anchor     = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$lblTitle.TextAlign  = [System.Drawing.ContentAlignment]::MiddleCenter
$lblTitle.Font       = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor  = [System.Drawing.Color]::FromArgb(180, 180, 180)
$lblTitle.BackColor  = [System.Drawing.Color]::FromArgb(38, 38, 40)
$form.Controls.Add($lblTitle)

# --- Panel preview ---
$previewY = $TITLE_H
$pnPreview = New-Object System.Windows.Forms.Panel
$pnPreview.SetBounds(0, $previewY, $FORM_W, $PREVIEW_H)
$pnPreview.Anchor    = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$pnPreview.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 30)
$form.Controls.Add($pnPreview)

$lblTD = New-Object System.Windows.Forms.Label
$lblTD.Text      = "DESKTOP"
$lblTD.AutoSize  = $false
$lblTD.Height    = 20
$lblTD.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$lblTD.ForeColor = [System.Drawing.Color]::FromArgb(130, 130, 130)
$pnPreview.Controls.Add($lblTD)

$lblTM = New-Object System.Windows.Forms.Label
$lblTM.Text      = "MOBILE"
$lblTM.AutoSize  = $false
$lblTM.Height    = 20
$lblTM.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$lblTM.ForeColor = [System.Drawing.Color]::FromArgb(130, 130, 130)
$pnPreview.Controls.Add($lblTM)

$panelDesktop           = New-Object System.Windows.Forms.Panel
$panelDesktop.BackColor = [System.Drawing.Color]::FromArgb(35, 35, 38)
$pnPreview.Controls.Add($panelDesktop)

$panelMobile            = New-Object System.Windows.Forms.Panel
$panelMobile.BackColor  = [System.Drawing.Color]::FromArgb(35, 35, 38)
$pnPreview.Controls.Add($panelMobile)

$lblResD = New-Object System.Windows.Forms.Label
$lblResD.AutoSize  = $false
$lblResD.Height    = 22
$lblResD.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$lblResD.Font      = New-Object System.Drawing.Font("Segoe UI", 8, [System.Drawing.FontStyle]::Bold)
$pnPreview.Controls.Add($lblResD)

$lblResM = New-Object System.Windows.Forms.Label
$lblResM.AutoSize  = $false
$lblResM.Height    = 22
$lblResM.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$lblResM.Font      = New-Object System.Drawing.Font("Segoe UI", 8, [System.Drawing.FontStyle]::Bold)
$pnPreview.Controls.Add($lblResM)

function Layout-Preview {
    $w    = $pnPreview.Width
    $h    = $pnPreview.Height
    $half = [int](($w - 6) / 2)
    $topH = 20
    $botH = 22
    $imgH = $h - $topH - $botH
    $lblTD.SetBounds(0,       0,     $half,      $topH)
    $lblTM.SetBounds($half+6, 0,     $w-$half-6, $topH)
    $panelDesktop.SetBounds(0,       $topH, $half,      $imgH)
    $panelMobile.SetBounds( $half+6, $topH, $w-$half-6, $imgH)
    $lblResD.SetBounds(0,       $h-$botH, $half,      $botH)
    $lblResM.SetBounds($half+6, $h-$botH, $w-$half-6, $botH)
}

$pnPreview.Add_Resize({ Layout-Preview })

# --- Panel metadatos ---
$metaY = $previewY + $PREVIEW_H
$pnMeta = New-Object System.Windows.Forms.Panel
$pnMeta.SetBounds(0, $metaY, $FORM_W, $META_H)
$pnMeta.Anchor    = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$pnMeta.BackColor = [System.Drawing.Color]::FromArgb(38, 38, 40)
$form.Controls.Add($pnMeta)

function Add-Label ($panel, $text, $x, $y) {
    $l           = New-Object System.Windows.Forms.Label
    $l.Text      = $text
    $l.Location  = New-Object System.Drawing.Point($x, $y)
    $l.AutoSize  = $true
    $l.ForeColor = [System.Drawing.Color]::FromArgb(140, 140, 140)
    $l.Font      = New-Object System.Drawing.Font("Segoe UI", 8)
    $panel.Controls.Add($l)
}

function New-TB ($x, $y, $w) {
    $t             = New-Object System.Windows.Forms.TextBox
    $t.Location    = New-Object System.Drawing.Point($x, $y)
    $t.Size        = New-Object System.Drawing.Size($w, 24)
    $t.BackColor   = [System.Drawing.Color]::FromArgb(50, 50, 54)
    $t.ForeColor   = [System.Drawing.Color]::FromArgb(220, 220, 220)
    $t.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $t.Font        = New-Object System.Drawing.Font("Segoe UI", 9)
    return $t
}

Add-Label $pnMeta "Nombre de archivo:" 16 10
$txtNombre = New-TB 16 28 700
$pnMeta.Controls.Add($txtNombre)

Add-Label $pnMeta "Alt (descripcion SEO):" 16 62
$txtAlt = New-TB 16 80 560
$pnMeta.Controls.Add($txtAlt)

Add-Label $pnMeta "Rank (1-5):" 590 62
$txtRank = New-TB 590 80 80
$pnMeta.Controls.Add($txtRank)

Add-Label $pnMeta "Categorias (separadas por coma):" 16 115
$txtCategories = New-TB 16 133 700
$pnMeta.Controls.Add($txtCategories)

# --- Panel botones ---
$btnY = $metaY + $META_H
$pnBtn = New-Object System.Windows.Forms.Panel
$pnBtn.SetBounds(0, $btnY, $FORM_W, $BTN_H)
$pnBtn.Anchor    = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$pnBtn.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 30)
$form.Controls.Add($pnBtn)

function New-Btn ($text, $x, $bgR, $bgG, $bgB, $fgR, $fgG, $fgB) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text      = $text
    $b.Size      = New-Object System.Drawing.Size(185, 44)
    $b.Location  = New-Object System.Drawing.Point($x, 14)
    $b.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $b.BackColor = [System.Drawing.Color]::FromArgb($bgR, $bgG, $bgB)
    $b.ForeColor = [System.Drawing.Color]::FromArgb($fgR, $fgG, $fgB)
    $b.Font      = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
    $b.FlatAppearance.BorderSize = 0
    $b.Cursor    = [System.Windows.Forms.Cursors]::Hand
    return $b
}

$btnSiguiente   = New-Btn "Siguiente" 20  45  90  45  120 230 120
$btnPersonas    = New-Btn "Personas" 215  30  60 100  100 170 255
$btnProvisional = New-Btn "Provisional" 410  80  60  20  255 200  80
$btnDescartar   = New-Btn "Descartar"  610  90  25  25  255 100 100

$pnBtn.Controls.Add($btnSiguiente)
$pnBtn.Controls.Add($btnPersonas)
$pnBtn.Controls.Add($btnProvisional)
$pnBtn.Controls.Add($btnDescartar)

# ============================================================
# LOGICA
# ============================================================

function Load-Current {
    if ($script:CurrentIdx -ge $script:ImageGroups.Count) {
        Show-Finished
        return
    }

    Dispose-CurrentImages

    $base   = $script:ImageGroups[$script:CurrentIdx]
    $folder = $script:WorkFolder
    $total  = $script:ImageGroups.Count
    $num    = $script:CurrentIdx + 1

    $lblTitle.Text = "Imagen $num de $total  -  $base"

    $desktopPath = $null
    foreach ($ext in @(".jpg", ".webp")) {
        $c = [System.IO.Path]::Combine($folder, "${base}_desktop${ext}")
        if (Test-Path $c) { $desktopPath = $c; break }
    }

    $mobilePath = $null
    foreach ($ext in @(".jpg", ".webp")) {
        $c = [System.IO.Path]::Combine($folder, "${base}_mobile${ext}")
        if (Test-Path $c) { $mobilePath = $c; break }
    }

    $script:ImgDesktop = Load-ImageSafe $desktopPath
    $script:ImgMobile  = Load-ImageSafe $mobilePath

    $dW = if ($script:ImgDesktop) { $script:ImgDesktop.Width  } else { 0 }
    $dH = if ($script:ImgDesktop) { $script:ImgDesktop.Height } else { 0 }
    $mW = if ($script:ImgMobile)  { $script:ImgMobile.Width   } else { 0 }
    $mH = if ($script:ImgMobile)  { $script:ImgMobile.Height  } else { 0 }

    Draw-Preview $panelDesktop $script:ImgDesktop $dW $dH
    Draw-Preview $panelMobile  $script:ImgMobile  $mW $mH
    Update-ResLabel $lblResD $script:ImgDesktop $dW $dH
    Update-ResLabel $lblResM $script:ImgMobile  $mW $mH

    $metaSource = if ($desktopPath) { $desktopPath } else { $mobilePath }
    $meta = Read-Metadata $metaSource

    $txtNombre.Text     = $base
    $txtAlt.Text        = $meta.Alt
    $txtCategories.Text = $meta.Categories
    $txtRank.Text       = $meta.Rank
}

function Save-CurrentMeta {
    if ($script:CurrentIdx -ge $script:ImageGroups.Count) { return }
    $base    = $script:ImageGroups[$script:CurrentIdx]
    $newBase = $txtNombre.Text.Trim()
    Save-Metadata $script:WorkFolder $base $txtAlt.Text $txtCategories.Text $txtRank.Text
    if ($newBase -ne "" -and $newBase -ne $base) {
        foreach ($suf in @("_desktop.jpg","_desktop.webp","_mobile.jpg","_mobile.webp")) {
            $src = [System.IO.Path]::Combine($script:WorkFolder, "${base}${suf}")
            $dst = [System.IO.Path]::Combine($script:WorkFolder, "${newBase}${suf}")
            if (Test-Path $src) {
                Rename-Item -LiteralPath $src -NewName ([System.IO.Path]::GetFileName($dst)) -Force
            }
        }
        $script:ImageGroups[$script:CurrentIdx] = $newBase
    }
}

function Go-Next {
    Save-CurrentMeta
    $script:CurrentIdx++
    Load-Current
}

function Move-To ($subfolder) {
    Save-CurrentMeta
    $base = $script:ImageGroups[$script:CurrentIdx]
    Move-ImageSet $script:WorkFolder $base $subfolder
    $script:CurrentIdx++
    Load-Current
}

function Show-Finished {
    Dispose-CurrentImages
    Draw-Preview $panelDesktop $null 0 0
    Draw-Preview $panelMobile  $null 0 0
    $lblTitle.Text     = "Clasificacion completada"
    $lblResD.Text      = ""
    $lblResM.Text      = ""
    $txtNombre.Text    = ""
    $txtAlt.Text       = ""
    $txtCategories.Text = ""
    $txtRank.Text      = ""
    $btnSiguiente.Enabled   = $false
    $btnPersonas.Enabled    = $false
    $btnProvisional.Enabled = $false
    $btnDescartar.Enabled   = $false
    [System.Windows.Forms.MessageBox]::Show(
        "Se han revisado todas las imagenes.",
        "Completado",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
}

# ============================================================
# EVENTOS
# ============================================================

$btnSiguiente.Add_Click({   Go-Next })
$btnPersonas.Add_Click({    Move-To "personas" })
$btnProvisional.Add_Click({ Move-To "provisional" })
$btnDescartar.Add_Click({   Move-To "descartadas" })

$panelDesktop.Add_Resize({
    $dW = if ($script:ImgDesktop) { $script:ImgDesktop.Width  } else { 0 }
    $dH = if ($script:ImgDesktop) { $script:ImgDesktop.Height } else { 0 }
    Draw-Preview $panelDesktop $script:ImgDesktop $dW $dH
})

$panelMobile.Add_Resize({
    $mW = if ($script:ImgMobile) { $script:ImgMobile.Width  } else { 0 }
    $mH = if ($script:ImgMobile) { $script:ImgMobile.Height } else { 0 }
    Draw-Preview $panelMobile $script:ImgMobile $mW $mH
})

$form.Add_Resize({
    $cw = $form.ClientSize.Width
    $ch = $form.ClientSize.Height
    $bH = $BTN_H
    $mH = $META_H
    $pH = $ch - $TITLE_H - $mH - $bH
    if ($pH -lt 50) { $pH = 50 }
    $lblTitle.Width    = $cw
    $pnPreview.SetBounds(0, $TITLE_H,              $cw, $pH)
    $pnMeta.SetBounds(   0, $TITLE_H + $pH,        $cw, $mH)
    $pnBtn.SetBounds(    0, $TITLE_H + $pH + $mH,  $cw, $bH)
    Layout-Preview
})

$form.Add_FormClosed({ Dispose-CurrentImages })

# ============================================================
# INICIO
# ============================================================

$form.Add_Shown({
    foreach ($sub in @("personas", "provisional", "descartadas")) {
        $p = [System.IO.Path]::Combine($script:WorkFolder, $sub)
        if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
    }
    Layout-Preview
    Load-ImageGroups $script:WorkFolder
    Load-Current
})

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::Run($form)