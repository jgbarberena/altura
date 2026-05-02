# =========================
# CONFIG
# =========================
$jsonPath = "faq-data.json"
$templatePath = "index-template.html"
$outputPath = "index.html"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# =========================
# LOAD FILES
# =========================
$jsonRaw = [System.IO.File]::ReadAllText($jsonPath, $utf8NoBom)
$faqs = $jsonRaw | ConvertFrom-Json

$template = [System.IO.File]::ReadAllText($templatePath, $utf8NoBom)

# =========================
# GROUP BY CATEGORY (orden estable)
# =========================
$categories = @()
$groupedFaqs = @{}

foreach ($faq in $faqs) {
    if (-not $groupedFaqs.ContainsKey($faq.category)) {
        $groupedFaqs[$faq.category] = @()
        $categories += $faq.category
    }
    $groupedFaqs[$faq.category] += $faq
}

# =========================
# GENERATE SECTIONS
# =========================
$allSections = ""

foreach ($cat in $categories) {

    $catId = ($cat.ToLower() -replace " ", "-" -replace "[^a-z0-9\-]", "")

    $questionsHtml = ""

    foreach ($faq in $groupedFaqs[$cat]) {
        $questionsHtml += @"
<div class="faq-item" id="$($faq.id)">
    <button class="faq-question">$($faq.question)</button>
    <div class="faq-answer">
        <p>$($faq.answer)</p>
    </div>
</div>
"@
    }

    $allSections += @"
<section class="section section--inner--sticky faq-section" id="$catId" data-sticky-section="$cat">
    <h2 class="text-sub">$cat</h2>
    $questionsHtml
</section>
"@
}

# =========================
# INJECT INTO TEMPLATE
# =========================
$output = $template.Replace("{{SECTIONS}}", $allSections)

# =========================
# SAVE FILE
# =========================
[System.IO.File]::WriteAllText($outputPath, $output, $utf8NoBom)

Write-Host "FAQ generada correctamente desde template"