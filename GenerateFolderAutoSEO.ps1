$rootPath = (Get-Location).Path

$excludeFolders = @("img", "css", "js", "components")

$breadcrumbMap = @{
    "experiencias" = "Experiencias"
    "toko"         = "Tienda San Fermin"
    "guias"        = "Guias San Fermin"
    "momenticos"   = "Experiencias reales"
    "empresa"      = "Servicios para empresas"
}

$baseUrl = "https://www.experienciasanfermin.com"

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
            }
            else {
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

function Build-FAQ-Schema($html) {
    $faqItems = @()

    $blockPattern = '(?i)<([a-z][a-z0-9]*)[^>]*\bfaq-item\b[^>]*>(.*?)</\1>'
    $blocks = [regex]::Matches($html, $blockPattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)

    foreach ($b in $blocks) {
        $block = $b.Groups[2].Value

        $q = ""
        $a = ""

        # QUESTION: primer elemento con clase faq-question
        $qMatch = [regex]::Match($block, '(?i)<[^>]*\bfaq-question\b[^>]*>(.*?)</[a-z][a-z0-9]*>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
        if ($qMatch.Success) { $q = Clean-Text $qMatch.Groups[1].Value }

        # ANSWER: todo el texto desde el inicio del primer faq-answer hasta el final
        # del bloque. Captura automaticamente multiples parrafos, listas, etc.
        $aStartMatch = [regex]::Match($block, '(?i)<[^>]*\bfaq-answer\b[^>]*>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
        if ($aStartMatch.Success) {
            $answerSection = $block.Substring($aStartMatch.Index)
            $a = Clean-Text $answerSection
        }

        if ($q -and $a) {
            $faqItems += @{
                "@type"          = "Question"
                "name"           = $q
                "acceptedAnswer" = @{
                    "@type" = "Answer"
                    "text"  = $a
                }
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

Get-ChildItem -Path $rootPath -Recurse -Filter *.html | Where-Object {
    $path = $_.FullName
    foreach ($f in $excludeFolders) {
        if ($path -like "*\$f\*") { return $false }
    }
    return $true
} | ForEach-Object {

    $file = $_.FullName
    $html = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

    # Título: primero busca data-page-title en el elemento page-data; si no, usa page-title-source
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

    # DEBUG: descomenta para diagnosticar un archivo concreto
    # Write-Host "DEBUG $file"
    # Write-Host "  title=[$title]"
    # Write-Host "  desc=[$description]"

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

    [string]$pageType  = Get-Attribute $html "data-page-type"
    [string]$author    = Get-Attribute $html "data-author"
    [string]$published = Get-Attribute $html "data-published"
    [string]$modified  = Get-Attribute $html "data-modified"

    [string]$relative = $file.Substring($rootPath.Length).Replace("\", "/")
    [string]$url = Clean-Url ($baseUrl + $relative)

    if ([string]::IsNullOrWhiteSpace($title))       { Write-Host "FALTA TITLE en $file";                  return }
    if ([string]::IsNullOrWhiteSpace($description)) { Write-Host "FALTA DESCRIPTION en $file";            return }
    if ([string]::IsNullOrWhiteSpace($image))       { Write-Host "FALTA IMAGE (y sin fallback) en $file"; return }

    $breadcrumbs      = Build-Breadcrumb $file $rootPath $title
    $breadcrumbSchema = Build-Breadcrumb-Schema $breadcrumbs
    $faqSchema        = Build-FAQ-Schema $html

    [string]$ogType = if ($pageType -eq "article") { "article" } else { "website" }

    # Ruta relativa a js/analytics.js según profundidad del archivo.
    # Ejemplos: raíz → "js/analytics.js" | empresa/ → "../js/analytics.js"
    $relativeParts = $relative.TrimStart("/") -split "/"
    $depth         = $relativeParts.Length - 1
    $analyticsPath = if ($depth -eq 0) { "js/analytics.js" } else { ("../" * $depth) + "js/analytics.js" }

    $headSeo = @"
<script src="$analyticsPath"></script>

<title>$title</title>
<meta name="description" content="$description">
<link rel="canonical" href="$url">

<meta property="og:title" content="$title">
<meta property="og:description" content="$description">
<meta property="og:image" content="$baseUrl$image">
<meta property="og:url" content="$url">
<meta property="og:type" content="$ogType">
"@

    $schemas = @()

    $schemas += (@{
        "@context" = "https://schema.org"
        "@type"    = "Organization"
        "@id"      = "$baseUrl/#organization"
        "name"     = "Vive San Fermin a medida"
        "url"      = $baseUrl
        "logo"     = "$baseUrl/img/logos/sanfermin-logo-black.png"
        "sameAs"   = @(
            "https://www.linkedin.com/in/pauladiazechalecu",
            "https://www.instagram.com/pauladiazechalecu"
        )
    } | ConvertTo-Json -Compress)

    $schemas += (@{
        "@context" = "https://schema.org"
        "@type"    = "LocalBusiness"
        "@id"      = "$baseUrl/#localbusiness"
        "name"     = "Vive San Fermin a medida"
        "image"    = "$baseUrl/img/logos/sanfermin-logo-black.png"
        "address"  = @{
            "@type"           = "PostalAddress"
            "addressLocality" = "Pamplona"
            "addressCountry"  = "ES"
        }
        "sameAs"   = @(
            "https://www.linkedin.com/in/pauladiazechalecu",
            "https://www.instagram.com/pauladiazechalecu"
        )
    } | ConvertTo-Json -Compress)

    [string]$serviceName = Get-Attribute $html "data-service-name"
    if ([string]::IsNullOrWhiteSpace($serviceName)) { $serviceName = "Experiencias San Fermin" }

    $schemas += (@{
        "@context"    = "https://schema.org"
        "@type"       = "Service"
        "@id"         = "$url#service"
        "name"        = $serviceName
        "description" = $description
        "provider"    = @{
            "@type" = "LocalBusiness"
            "@id"   = "$baseUrl/#localbusiness"
            "name"  = "Vive San Fermin a medida"
        }
        "areaServed"  = @{
            "@type" = "Place"
            "name"  = "Pamplona"
        }
        "mentions"    = @(
            @{ "@type" = "Place"; "name" = "Pamplona" },
            @{ "@type" = "Event"; "name" = "Fiestas de San Fermin" }
        )
    } | ConvertTo-Json -Depth 4 -Compress)

    $webPageType = switch ($pageType) {
        "website" { "WebSite"     }
        "about"   { "AboutPage"   }
        "contact" { "ContactPage" }
        default   { "WebPage"     }
    }

    $hasCta = ($pageType -eq "website" -or $pageType -eq "landing")

    if ($hasCta) {
        $schemas += (@{
            "@context"        = "https://schema.org"
            "@type"           = $webPageType
            "@id"             = "$url#webpage"
            "name"            = $title
            "description"     = $description
            "url"             = $url
            "about"           = @(
                @{ "@type" = "Place"; "name" = "Pamplona" },
                @{ "@type" = "Event"; "name" = "Fiestas de San Fermin" }
            )
            "potentialAction" = @{
                "@type"  = "ReserveAction"
                "target" = "$baseUrl/#contacto"
                "name"   = "Solicitar experiencia personalizada"
            }
        } | ConvertTo-Json -Depth 5 -Compress)
    } else {
        $schemas += (@{
            "@context"    = "https://schema.org"
            "@type"       = $webPageType
            "@id"         = "$url#webpage"
            "name"        = $title
            "description" = $description
            "url"         = $url
            "about"       = @(
                @{ "@type" = "Place"; "name" = "Pamplona" },
                @{ "@type" = "Event"; "name" = "Fiestas de San Fermin" }
            )
        } | ConvertTo-Json -Depth 4 -Compress)
    }

    $schemas += $breadcrumbSchema

    if ($faqSchema) { $schemas += $faqSchema }

    if ($pageType -eq "article") {
        if ([string]::IsNullOrEmpty($author))    { $author    = "Paula Diaz Echalecu" }
        if ([string]::IsNullOrEmpty($published)) { $published = "2025-06-01" }
        if ([string]::IsNullOrEmpty($modified))  { $modified  = $published }

        $schemas += (@{
            "@context"         = "https://schema.org"
            "@type"            = "Article"
            "headline"         = $title
            "description"      = $description
            "image"            = "$baseUrl$image"
            "author"           = @{
                "@type" = "Person"
                "name"  = $author
            }
            "datePublished"    = $published
            "dateModified"     = $modified
            "mainEntityOfPage" = @{
                "@type" = "WebPage"
                "@id"   = "$url#webpage"
            }
            "publisher"        = @{
                "@type" = "Organization"
                "name"  = "Vive San Fermin a medida"
                "logo"  = @{
                    "@type" = "ImageObject"
                    "url"   = "$baseUrl/img/logos/sanfermin-logo-black.png"
                }
            }
        } | ConvertTo-Json -Depth 5 -Compress)
    }

    $bodySeo = ""
    foreach ($s in $schemas) {
        $bodySeo += "<script type=`"application/ld+json`">$s</script>`n"
    }

    $html = [regex]::Replace(
        $html,
        "<!-- AUTO-SEO HEAD INIT -->.*?<!-- AUTO-SEO HEAD END -->",
        "<!-- AUTO-SEO HEAD INIT -->`n$headSeo`n<!-- AUTO-SEO HEAD END -->",
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )

    # El placeholder del banner de cookies se inyecta al inicio del bloque BODY
    # para que include.js lo encuentre en el DOM cuando arranque.
    $html = [regex]::Replace(
        $html,
        "<!-- AUTO-SEO BODY INIT -->.*?<!-- AUTO-SEO BODY END -->",
        "<!-- AUTO-SEO BODY INIT -->`n<div id=`"cookie-banner-placeholder`"></div>`n$bodySeo`n<!-- AUTO-SEO BODY END -->",
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )

    [System.IO.File]::WriteAllText($file, $html, [System.Text.Encoding]::UTF8)

    Write-Host "OK: $file"
}