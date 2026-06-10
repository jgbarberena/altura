# ============================================================
# GenerateFolderAutoSEO.ps1
# Genera y sobreescribe los bloques AUTO-SEO HEAD e AUTO-SEO BODY
# en todos los archivos .html del proyecto (excepto carpetas excluidas).
# ============================================================


# ============================================================
# CONFIGURACION — todo lo que puede necesitar mantenimiento
# esta aqui arriba. No hay que tocar nada mas abajo salvo
# que se cambie la logica del script.
# ============================================================

# ---- Sitio web ----
$baseUrl = "https://www.experienciasanfermin.com"

# ---- Favicon ----
$faviconUrl = "$baseUrl/img/logos/VIVESF_FAVICON.ico"

# ---- Organizacion ----
$orgName          = "Vive San Fermin desde dentro"
$orgLogo          = "$baseUrl/img/logos/sanfermin-logo-black.png"
$orgCity          = "Pamplona"
$orgCountry       = "ES"
$orgSameAs        = @(
    "https://www.linkedin.com/in/pauladiazechalecu",
    "https://www.instagram.com/pauladiazechalecu"
)

# ---- Articulos: valores por defecto si la pagina no los declara ----
$articleAuthorDefault    = "Paula Diaz Echalecu"
$articlePublishedDefault = "2025-06-01"

# ---- Ofertas: rango de precios fallback para paginas sin precios en el HTML ----
$offerPriceMin = 50
$offerPriceMax = 1200

# ---- CTA del WebPage (potentialAction) ----
$ctaName   = "Solicitar experiencia personalizada"
$ctaTarget = "$baseUrl/#contacto"

# ---- Breadcrumb: nombre legible por carpeta ----
$breadcrumbMap = @{
    "experiencias" = "Experiencias"
    "toko"         = "Tienda San Fermin"
    "guias"        = "Guias San Fermin"
    "momenticos"   = "Experiencias reales"
    "empresa"      = "Servicios para empresas"
}

# ---- Carpetas excluidas del procesado SEO ----
$excludeFolders = @("img", "css", "js", "components", "admin")

# ---- Eventos: fechas y ubicaciones fijas (el anyo lo calcula el script) ----
# Para asignar un evento especifico a una pagina, añade data-event-key="clave"
# al elemento page-data de esa pagina. Si no hay data-event-key, se usa el default.
# placeName:     nombre del lugar para el schema Event
# streetAddress: calle concreta si el evento es en un lugar fijo; vacio si es un recorrido
$eventSchedules = @{
    "encierro"    = @{ startMonth = 7; startDay = 7;  startTime = "08:00"; endMonth = 7; endDay = 14; endTime = "08:30"; placeName = "Casco Antiguo de Pamplona";      streetAddress = ""                  }
    "chupinazo"   = @{ startMonth = 7; startDay = 6;  startTime = "10:00"; endMonth = 7; endDay = 6;  endTime = "12:30"; placeName = "Plaza Consistorial, Pamplona";   streetAddress = "Plaza Consistorial" }
    "procesion"   = @{ startMonth = 7; startDay = 7;  startTime = "10:00"; endMonth = 7; endDay = 7;  endTime = "14:30"; placeName = "Casco Antiguo de Pamplona";      streetAddress = ""                  }
    "gigantes"    = @{ startMonth = 7; startDay = 14; startTime = "12:00"; endMonth = 7; endDay = 14; endTime = "13:00"; placeName = "Plaza Consistorial, Pamplona";   streetAddress = "Plaza Consistorial" }
    "pobre-de-mi" = @{ startMonth = 7; startDay = 14; startTime = "23:00"; endMonth = 7; endDay = 15; endTime = "00:30"; placeName = "Plaza Consistorial, Pamplona";   streetAddress = "Plaza Consistorial" }
}
# Evento por defecto: marco general San Fermin (7-14 julio)
$eventScheduleDefault = @{
    startMonth = 7; startDay = 7;  startTime = "00:00"
    endMonth   = 7; endDay   = 14; endTime   = "23:59"
    placeName     = "Casco Antiguo de Pamplona"
    streetAddress = ""
}


# ============================================================
# INTERNOS — calculados automaticamente, no editar
# ============================================================

$rootPath = (Get-Location).Path

# Simbolo euro como char para mantener el script en ASCII puro
$euro = [char]0x20AC

# Anyo San Fermin: a partir del 1 de agosto usa anyo+1
$today    = Get-Date
$sfYear   = if ($today -ge (Get-Date "$($today.Year)-08-01")) { $today.Year + 1 } else { $today.Year }
$todayStr = $today.ToString("yyyy-MM-dd")

# ============================================================
# FUNCIONES DE UTILIDAD
# ============================================================

function Clean-Text($text) {
    $t = $text -replace "<.*?>", " "
    $t = $t -replace "\s+", " "
    return $t.Trim()
}

function Get-InnerText($html, $className) {
    $pattern = '(?i)<([a-z][a-z0-9]*)[^>]*class="[^"]*\b' + $className + '\b[^"]*"[^>]*>(.*?)</\1>'
    $match = [regex]::Match($html, $pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if ($match.Success) {
        return Clean-Text $match.Groups[2].Value
    }
    return ""
}

function Get-Attribute($html, $attr) {
    $m = [regex]::Match($html, $attr + '="([^"]*)"')
    if ($m.Success) { return $m.Groups[1].Value }
    return ""
}

function Normalize-ImagePath($path) {
    $p = $path -replace '^(\.\./)+', '/'
    if (-not $p.StartsWith('/')) { $p = '/' + $p }
    return $p
}

function Clean-Url($url) {
    if ($url -match '/index\.html$') {
        return $url -replace '/index\.html$', '/'
    }
    return $url
}

function Capitalize($text) {
    $t = ($text -replace "-", " ").ToLower()
    $words = $t -split " "
    $result = @()
    foreach ($w in $words) {
        if ($w.Length -gt 0) {
            $result += $w.Substring(0,1).ToUpper() + $w.Substring(1)
        }
    }
    return $result -join " "
}

# Anade el anyo de San Fermin a cualquier texto que contenga "San Fermin"
# (con o sin tilde en la i). Solo actua sobre variables SEO, nunca sobre el HTML fuente.
# La i con tilde se construye como char para mantener el script ASCII puro.
function Add-SfYear($text, $year) {
    if ([string]::IsNullOrWhiteSpace($text)) { return $text }
    $iTilde  = [char]0xED   # i con tilde (i)
    $pattern = "San\s+Ferm(?:i|$iTilde)n"
    # Evita duplicar si ya contiene un anyo de 4 cifras tras "San Fermin"
    if ($text -match "$pattern\s+\d{4}") { return $text }
    return [regex]::Replace($text, "($pattern)", "`$1 $year")
}

# ============================================================
# EXTRACCION DE PRECIOS
# Busca patrones NNN<euro> o <euro>NNN en el HTML fuente (sin bloque AUTO-SEO).
# Prioridad: faq-answer > main completo.
# Devuelve @{ min = N; max = N } o $null si no hay rango valido.
# ============================================================

function Extract-Prices($html, $euroChar) {

    # Eliminar bloque AUTO-SEO para no releer precios escritos por el propio script
    $cleanHtml = [regex]::Replace(
        $html,
        "<!-- AUTO-SEO BODY INIT -->.*?<!-- AUTO-SEO BODY END -->",
        "",
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )

    # Patron: 100<euro>  <euro>100  1.200<euro>  1,200<euro>
    # El char del euro se inyecta como parametro para mantener el script ASCII puro
    $e = [regex]::Escape($euroChar)
    $pricePattern = "(?:(\d{1,4}(?:[.,]\d{3})*)\s*$e|$e\s*(\d{1,4}(?:[.,]\d{3})*))"

    function Parse-Prices($sourceHtml) {
        $ms = [regex]::Matches($sourceHtml, $pricePattern)
        $values = @()
        foreach ($m in $ms) {
            $raw = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
            $raw = $raw -replace '[.,]', ''
            $n = 0
            if ([int]::TryParse($raw, [ref]$n) -and $n -gt 0) { $values += $n }
        }
        return $values
    }

    # 1. Buscar dentro de faq-answer (dentro de faq-item)
    $faqAnswers = [regex]::Matches(
        $cleanHtml,
        '(?i)<[^>]*\bfaq-item\b[^>]*>.*?<[^>]*\bfaq-answer\b[^>]*>(.*?)</[a-z][a-z0-9]*>',
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    if ($faqAnswers.Count -gt 0) {
        $faqText = ($faqAnswers | ForEach-Object { $_.Groups[1].Value }) -join " "
        $vals = Parse-Prices $faqText
        if ($vals.Count -ge 2) {
            $minVal = ($vals | Measure-Object -Minimum).Minimum
            $maxVal = ($vals | Measure-Object -Maximum).Maximum
            if ($minVal -ne $maxVal) { return @{ min = $minVal; max = $maxVal } }
        }
    }

    # 2. Buscar en el main completo
    $mainMatch = [regex]::Match(
        $cleanHtml,
        '(?i)<main[^>]*>(.*?)</main>',
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    if ($mainMatch.Success) {
        $vals = Parse-Prices $mainMatch.Groups[1].Value
        if ($vals.Count -ge 2) {
            $minVal = ($vals | Measure-Object -Minimum).Minimum
            $maxVal = ($vals | Measure-Object -Maximum).Maximum
            if ($minVal -ne $maxVal) { return @{ min = $minVal; max = $maxVal } }
        }
    }

    return $null
}

# ============================================================
# SCHEMA EVENT
# ============================================================

function Build-Event-Schema($html, $pageType, $eventKey, $serviceName, $image, $url, $euroChar) {

    $sched = if (-not [string]::IsNullOrWhiteSpace($eventKey) -and $eventSchedules.ContainsKey($eventKey)) {
        $eventSchedules[$eventKey]
    } else {
        $eventScheduleDefault
    }

    $startDate = "$sfYear-$('{0:D2}' -f $sched.startMonth)-$('{0:D2}' -f $sched.startDay)T$($sched.startTime):00+02:00"
    $endDate   = "$sfYear-$('{0:D2}' -f $sched.endMonth)-$('{0:D2}' -f $sched.endDay)T$($sched.endTime):00+02:00"

    $eventName = if (-not [string]::IsNullOrWhiteSpace($serviceName)) {
        Add-SfYear $serviceName $sfYear
    } else {
        "Fiestas de San Fermin $sfYear"
    }

    # Construir address: con streetAddress solo si el evento tiene lugar fijo
    $address = [ordered]@{
        "@type"           = "PostalAddress"
        "addressLocality" = "$orgCity"
        "postalCode"      = "31001"
        "addressCountry"  = "$orgCountry"
    }
    if (-not [string]::IsNullOrWhiteSpace($sched.streetAddress)) {
        $address["streetAddress"] = $sched.streetAddress
    }

    $eventSchema = [ordered]@{
        "@context"            = "https://schema.org"
        "@type"               = "Event"
        "name"                = $eventName
        "startDate"           = $startDate
        "endDate"             = $endDate
        "eventStatus"         = "https://schema.org/EventScheduled"
        "eventAttendanceMode" = "https://schema.org/OfflineEventAttendanceMode"
        "image"               = "$baseUrl$image"
        "url"                 = $url
        "location"            = [ordered]@{
            "@type"   = "Place"
            "name"    = $sched.placeName
            "address" = $address
        }
        "organizer"           = [ordered]@{
            "@type" = "Organization"
            "name"  = "$orgName"
            "url"   = $baseUrl
        }
    }

    # Offers: extraer del HTML; fallback para website/landing; omitir para toko
    if ($pageType -ne "toko") {
        $prices   = Extract-Prices $html $euroChar
        $offerMin = $null
        $offerMax = $null

        if ($null -ne $prices) {
            $offerMin = $prices.min
            $offerMax = $prices.max
            Write-Host "  Precios extraidos del HTML: $offerMin - $offerMax EUR"
        } elseif ($pageType -eq "website" -or $pageType -eq "landing") {
            $offerMin = $offerPriceMin
            $offerMax = $offerPriceMax
            Write-Host "  Precios: fallback por defecto (50-1200 EUR)"
        }

        if ($null -ne $offerMin) {
            $eventSchema["offers"] = [ordered]@{
                "@type"         = "AggregateOffer"
                "lowPrice"      = "$offerMin"
                "highPrice"     = "$offerMax"
                "priceCurrency" = "EUR"
                "availability"  = "https://schema.org/InStock"
                "validFrom"     = "$($sfYear - 1)-08-01"
                "validThrough"  = "$sfYear-07-14T23:59:00+02:00"
                "url"           = $url
            }
        }
    }

    return $eventSchema | ConvertTo-Json -Depth 6 -Compress
}

# ============================================================
# BREADCRUMB
# ============================================================

function Build-Breadcrumb([string]$filePath, [string]$rootPath, [string]$pageTitle) {
    $relative = $filePath.Substring($rootPath.Length).TrimStart("\", "/")
    $parts = $relative -split "[/\\]"

    $breadcrumbs = New-Object System.Collections.ArrayList
    [void]$breadcrumbs.Add(@{ name = "Home"; url = "/" })

    $pathAccum = ""

    for ($i = 0; $i -lt $parts.Length; $i++) {
        $part = $parts[$i]
        if ($part -ne "index.html") {
            if ($i -eq $parts.Length - 1) {
                if (-not [string]::IsNullOrWhiteSpace($pageTitle)) {
                    [void]$breadcrumbs.Add(@{
                        name = [string]$pageTitle
                        url  = "/" + ($relative -replace "\\", "/")
                    })
                }
            } else {
                $pathAccum += "/" + $part
                [string]$label = $breadcrumbMap[$part]
                if ([string]::IsNullOrEmpty($label)) { $label = Capitalize $part }
                [void]$breadcrumbs.Add(@{
                    name = [string]$label
                    url  = $pathAccum + "/"
                })
            }
        }
    }

    return , $breadcrumbs.ToArray()
}

function Build-Breadcrumb-Schema($breadcrumbs) {
    $items = @()
    $pos = 1
    foreach ($bc in $breadcrumbs) {
        $items += @{
            "@type"    = "ListItem"
            "position" = $pos
            "name"     = [string]$bc.name
            "item"     = $baseUrl + $bc.url
        }
        $pos++
    }
    return @{
        "@context"        = "https://schema.org"
        "@type"           = "BreadcrumbList"
        "itemListElement" = $items
    } | ConvertTo-Json -Depth 5 -Compress
}

# ============================================================
# FAQ SCHEMA
# ============================================================

function Build-FAQ-Schema($html) {
    $faqItems = @()

    $blockPattern = '(?i)<([a-z][a-z0-9]*)[^>]*\bfaq-item\b[^>]*>(.*?)</\1>'
    $blocks = [regex]::Matches($html, $blockPattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)

    foreach ($b in $blocks) {
        $block = $b.Groups[2].Value
        $q = ""
        $a = ""

        $qMatch = [regex]::Match($block, '(?i)<[^>]*\bfaq-question\b[^>]*>(.*?)</[a-z][a-z0-9]*>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
        if ($qMatch.Success) { $q = Clean-Text $qMatch.Groups[1].Value }

        $aStartMatch = [regex]::Match($block, '(?i)<[^>]*\bfaq-answer\b[^>]*>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
        if ($aStartMatch.Success) {
            $a = Clean-Text $block.Substring($aStartMatch.Index)
        }

        if ($q -and $a) {
            $faqItems += @{
                "@type"          = "Question"
                "name"           = $q
                "acceptedAnswer" = @{ "@type" = "Answer"; "text" = $a }
            }
        }
    }

    if ($faqItems.Count -eq 0) { return "" }

    return @{
        "@context"   = "https://schema.org"
        "@type"      = "FAQPage"
        "mainEntity" = $faqItems
    } | ConvertTo-Json -Depth 6 -Compress
}

# ============================================================
# BUCLE PRINCIPAL
# ============================================================

Get-ChildItem -Path $rootPath -Recurse -Filter *.html | Where-Object {
    $path = $_.FullName
    foreach ($f in $excludeFolders) {
        if ($path -like "*/$f/*" -or $path -like "*\$f\*") { return $false }
    }
    return $true
} | ForEach-Object {

    $file = $_.FullName
    $html = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

    # ---- Extraer metadatos ----

    [string]$pageDataBlock = ""
    $pageDataMatch = [regex]::Match($html, '(?i)<([a-z][a-z0-9]*)[^>]*class="[^"]*\bpage-data\b[^"]*"[^>]*>(.*?)</\1>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if ($pageDataMatch.Success) { $pageDataBlock = $pageDataMatch.Groups[0].Value }

    [string]$title = ""
    if (-not [string]::IsNullOrWhiteSpace($pageDataBlock)) {
        $title = Get-Attribute $pageDataBlock "data-page-title"
    }
    if ([string]::IsNullOrWhiteSpace($title)) {
        $title = Get-InnerText $html "page-title-source"
    }

    [string]$description = Get-InnerText $html "page-description-source"
    [string]$pageType    = Get-Attribute $html "data-page-type"
    [string]$author      = Get-Attribute $html "data-author"
    [string]$published   = Get-Attribute $html "data-published"
    [string]$serviceName = Get-Attribute $html "data-service-name"
    [string]$eventKey    = Get-Attribute $html "data-event-key"

    [string]$image = ""
    $imgMatch = [regex]::Match(
        $html,
        '(?i)<picture[^>]*class="[^"]*\bpage-image-source\b[^"]*"[^>]*>.*?<img[^>]*src="([^"]+)"',
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    if ($imgMatch.Success) {
        $image = Normalize-ImagePath $imgMatch.Groups[1].Value
    }
    if ([string]::IsNullOrEmpty($image)) {
        [string]$raw = Get-Attribute $html "data-image-fallback"
        if (-not [string]::IsNullOrEmpty($raw)) {
            $image = Normalize-ImagePath $raw
            Write-Host "INFO: imagen fallback usada en $file"
        }
    }

    [string]$relative = $file.Substring($rootPath.Length).Replace("\", "/")
    [string]$url = Clean-Url ($baseUrl + $relative)

    if ([string]::IsNullOrWhiteSpace($title))       { Write-Host "FALTA TITLE en $file";                  return }
    if ([string]::IsNullOrWhiteSpace($description)) { Write-Host "FALTA DESCRIPTION en $file";            return }
    if ([string]::IsNullOrWhiteSpace($image))       { Write-Host "FALTA IMAGE (y sin fallback) en $file"; return }

    # ---- Aplicar anyo San Fermin a variables SEO (nunca al HTML fuente) ----
    [string]$titleSeo       = Add-SfYear $title $sfYear
    [string]$descriptionSeo = Add-SfYear $description $sfYear
    [string]$serviceNameSeo = Add-SfYear $serviceName $sfYear

    # ---- Actualizar data-modified en el HTML fuente a la fecha de hoy ----
    $html = [regex]::Replace($html, 'data-modified="[^"]*"', "data-modified=`"$todayStr`"")

    # ---- Construir HEAD SEO ----
    [string]$ogType = if ($pageType -eq "article") { "article" } else { "website" }

    $headSeo = @"
<title>$titleSeo</title>
<meta name="description" content="$descriptionSeo">
<link rel="canonical" href="$url">
<link rel="icon" href="$faviconUrl" type="image/x-icon">

<meta property="og:title" content="$titleSeo">
<meta property="og:description" content="$descriptionSeo">
<meta property="og:image" content="$baseUrl$image">
<meta property="og:url" content="$url">
<meta property="og:type" content="$ogType">
"@

    # ---- Construir schemas ----
    $schemas = @()

    # Organization
    $schemas += (@{
        "@context" = "https://schema.org"
        "@type"    = "Organization"
        "@id"      = "$baseUrl/#organization"
        "name"     = "$orgName"
        "url"      = $baseUrl
        "logo"     = "$orgLogo"
        "sameAs"   = $orgSameAs
    } | ConvertTo-Json -Compress)

    # LocalBusiness
    $schemas += (@{
        "@context" = "https://schema.org"
        "@type"    = "LocalBusiness"
        "@id"      = "$baseUrl/#localbusiness"
        "name"     = "$orgName"
        "image"    = "$orgLogo"
        "address"  = @{
            "@type"           = "PostalAddress"
            "addressLocality" = "$orgCity"
            "addressCountry"  = "$orgCountry"
        }
        "sameAs"   = $orgSameAs
    } | ConvertTo-Json -Compress)

    # Service
    if (-not [string]::IsNullOrWhiteSpace($serviceNameSeo)) {
        $schemas += (@{
            "@context"    = "https://schema.org"
            "@type"       = "Service"
            "@id"         = "$url#service"
            "name"        = $serviceNameSeo
            "description" = $descriptionSeo
            "provider"    = @{
                "@type" = "LocalBusiness"
                "@id"   = "$baseUrl/#localbusiness"
                "name"  = "$orgName"
            }
            "areaServed"  = @{ "@type" = "Place"; "name" = "$orgCity" }
            "mentions"    = @(
                @{ "@type" = "Place"; "name" = "$orgCity" },
                @{ "name" = "Fiestas de San Fermin $sfYear" }
            )
        } | ConvertTo-Json -Depth 4 -Compress)
    }

    # WebPage
    $webPageType = switch ($pageType) {
        "website" { "WebSite"     }
        "about"   { "AboutPage"   }
        "contact" { "ContactPage" }
        default   { "WebPage"     }
    }

    $webPageSchema = [ordered]@{
        "@context"    = "https://schema.org"
        "@type"       = $webPageType
        "@id"         = "$url#webpage"
        "name"        = $titleSeo
        "description" = $descriptionSeo
        "url"         = $url
        "about"       = @(
            @{ "@type" = "Place"; "name" = "$orgCity" },
            @{ "name" = "Fiestas de San Fermin $sfYear" }
        )
    }
    if ($pageType -eq "website" -or $pageType -eq "landing") {
        $webPageSchema["potentialAction"] = @{
            "@type"  = "ReserveAction"
            "target" = "$ctaTarget"
            "name"   = "$ctaName"
        }
    }
    $schemas += ($webPageSchema | ConvertTo-Json -Depth 5 -Compress)

    # Event — solo para website, landing y toko
    if (@("website", "landing", "toko") -contains $pageType) {
        Write-Host "  Generando schema Event ($pageType) [$eventKey] en $($_.Name)"
        $schemas += (Build-Event-Schema $html $pageType $eventKey $serviceName $image $url $euro)
    }

    # Breadcrumb
    $breadcrumbs      = Build-Breadcrumb $file $rootPath $titleSeo
    $breadcrumbSchema = Build-Breadcrumb-Schema $breadcrumbs
    $schemas += $breadcrumbSchema

    # FAQ
    $faqSchema = Build-FAQ-Schema $html
    if ($faqSchema) { $schemas += $faqSchema }

    # Article
    if ($pageType -eq "article") {
        if ([string]::IsNullOrEmpty($author))    { $author    = $articleAuthorDefault }
        if ([string]::IsNullOrEmpty($published)) { $published = $articlePublishedDefault }

        $schemas += (@{
            "@context"         = "https://schema.org"
            "@type"            = "Article"
            "headline"         = $titleSeo
            "description"      = $descriptionSeo
            "image"            = "$baseUrl$image"
            "author"           = @{ "@type" = "Person"; "name" = $author }
            "datePublished"    = $published
            "dateModified"     = $todayStr
            "mainEntityOfPage" = @{ "@type" = "WebPage"; "@id" = "$url#webpage" }
            "publisher"        = @{
                "@type" = "Organization"
                "name"  = "$orgName"
                "logo"  = @{ "@type" = "ImageObject"; "url" = "$orgLogo" }
            }
        } | ConvertTo-Json -Depth 5 -Compress)
    }

    # ---- Ensamblar bloque BODY ----
    $bodySeo = "<div id=`"cookie-banner-placeholder`"></div>`n"
    $bodySeo += "<script src=`"https://www.experienciasanfermin.com/js/analytics.js`"></script>`n"
    foreach ($s in $schemas) {
        $bodySeo += "<script type=`"application/ld+json`">$s</script>`n"
    }

    # ---- Escribir bloques AUTO-SEO ----
    $html = [regex]::Replace(
        $html,
        "<!-- AUTO-SEO HEAD INIT -->.*?<!-- AUTO-SEO HEAD END -->",
        "<!-- AUTO-SEO HEAD INIT -->`n$headSeo`n<!-- AUTO-SEO HEAD END -->",
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )

    $html = [regex]::Replace(
        $html,
        "<!-- AUTO-SEO BODY INIT -->.*?<!-- AUTO-SEO BODY END -->",
        "<!-- AUTO-SEO BODY INIT -->`n$bodySeo`n<!-- AUTO-SEO BODY END -->",
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )

    [System.IO.File]::WriteAllText($file, $html, [System.Text.Encoding]::UTF8)

    Write-Host "OK: $file"
}