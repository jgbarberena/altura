// Edge Function: inbound-email
// Recibe el webhook POST de Resend con el email entrante, lo parsea con Claude
// Haiku y lo inserta en reservation_requests con status 'email_parsed'.
//
// Secrets necesarios en Supabase Vault (Settings → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY  — clave de Anthropic
//   RESEND_API_KEY     — ya existe (usado por notificar-solicitud)
//
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y SUPABASE_ANON_KEY están disponibles
// automáticamente en todas las Edge Functions de Supabase.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Modelo ────────────────────────────────────────────────────────────────────
// Para cambiar: editar esta constante y redesplegar la función en Supabase dashboard.
const MODEL = 'claude-haiku-4-5-20251001'

// ── Prompt de parseo ──────────────────────────────────────────────────────────
// Para actualizar: editar este texto y redesplegar la función.
// El texto definitivo se completará cuando esté listo el prompt de extracción.
const SYSTEM_PROMPT_PARSING = ``

// ── Configuración de notificaciones ──────────────────────────────────────────
// FROM debe ser una dirección del dominio verificado en Resend
const NOTIFY_FROM = 'sistema@experienciasanfermin.com'
const NOTIFY_TO   = 'jgbarberena@gmail.com'

// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
    if (req.method !== 'POST') {
        return json({ ok: false, error: 'Method not allowed' }, 405)
    }

    // 1 ── Parsear el body de Resend
    let payload: Record<string, unknown>
    try {
        payload = await req.json()
    } catch {
        return json({ ok: false, error: 'Invalid JSON' }, 400)
    }

    const fromEmail = String(payload.from  ?? '')
    const subject   = String(payload.subject ?? '')

    // 2 ── Extraer texto del email
    let emailBody = ''
    if (typeof payload.text === 'string' && payload.text.trim()) {
        emailBody = payload.text.trim()
    } else if (typeof payload.html === 'string') {
        emailBody = payload.html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    }

    if (!emailBody) {
        // Email vacío — no hay nada que parsear ni guardar
        return json({ ok: true, note: 'empty body, ignored' }, 200)
    }

    const emailRaw = emailBody.slice(0, 2000)

    // 3 ── Detectar idioma (heurística simple)
    const lower   = emailBody.toLowerCase()
    let language  = 'es'
    if (/\b(the|is|are|this|that|with|have|from|they|what|when|how|would|please)\b/.test(lower)) language = 'en'
    else if (/\b(bonjour|je|nous|vous|est|les|une|pour|dans|merci|voudrais)\b/.test(lower)) language = 'fr'
    else if (/\b(ciao|vorrei|siamo|sono|della|grazie|buongiorno|salve)\b/.test(lower)) language = 'it'
    else if (/\b(ich|wir|bitte|haben|sind|der|die|das|und|möchte|sehr)\b/.test(lower)) language = 'de'

    // 4 ── Llamar a Claude Haiku para extraer datos estructurados
    // SYSTEM_PROMPT_PARSING se define al inicio del archivo para facilitar su actualización

    let parsed: {
        client_name:  string | null
        client_email: string | null
        client_phone: string | null
        service_hint: string | null
        day:          number | null
        slots:        number | null
        comments:     string
    } | null = null

    let parseError: string | null = null

    try {
        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type':      'application/json',
                'x-api-key':         Deno.env.get('ANTHROPIC_API_KEY') ?? '',
                'anthropic-version': '2023-06-01',
                'anthropic-beta':    'prompt-caching-2024-07-31'
            },
            body: JSON.stringify({
                model:      MODEL,
                max_tokens: 500,
                system:     [{ type: 'text', text: SYSTEM_PROMPT_PARSING, cache_control: { type: 'ephemeral' } }],
                messages:   [{
                    role:    'user',
                    content: `From: ${fromEmail}\nSubject: ${subject}\n\n${emailBody}`
                }]
            })
        })

        if (!claudeRes.ok) {
            throw new Error(`Claude API ${claudeRes.status}: ${await claudeRes.text()}`)
        }

        const claudeData = await claudeRes.json()
        const rawText    = String(claudeData?.content?.[0]?.text ?? '').trim()

        // Claude puede devolver el JSON envuelto en backticks a pesar de las instrucciones
        const jsonMatch = rawText.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('No JSON found in Claude response')

        parsed = JSON.parse(jsonMatch[0])
    } catch (err: unknown) {
        parseError = err instanceof Error ? err.message : String(err)
        console.error('[inbound-email] Parsing error:', parseError)
    }

    // Si el parseo falló, construir fila con fallback y notificar
    if (!parsed) {
        parsed = {
            client_name:  null,
            client_email: fromEmail || null,
            client_phone: null,
            service_hint: null,
            day:          null,
            slots:        null,
            comments:     'Email recibido — parsing automático fallido. Revisar manualmente.'
        }
        await sendNotification(
            '⚠️ Error parseando email entrante',
            `Error: ${parseError}\n\nFrom: ${fromEmail}\nSubject: ${subject}\n\nEmail original:\n${emailRaw}`
        )
    }

    // 5 ── Insertar en reservation_requests
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')              ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { error: insertError } = await supabase
        .from('reservation_requests')
        .insert({
            client_name:  parsed.client_name  || 'Sin nombre',
            client_email: parsed.client_email || fromEmail || null,
            client_phone: parsed.client_phone || null,
            service_id:   null,
            slots:        parsed.slots        || null,
            day:          parsed.day          || null,
            level:        parsed.service_hint || null,
            comments:     parsed.comments,
            source:       'email',
            status:       'email_parsed',
            language,
            email_raw:    emailRaw
        })

    if (insertError) {
        console.error('[inbound-email] Insert error:', insertError)
        // Retornar 500 para que Resend reintente
        await sendNotification(
            '⚠️ Error guardando email en BD',
            `Error: ${insertError.message}\n\nFrom: ${fromEmail}\nSubject: ${subject}\n\nEmail original:\n${emailRaw}`
        )
        return json({ ok: false, error: insertError.message }, 500)
    }

    // 6 ── Notificación de éxito con resumen del parseo
    if (!parseError) {
        await sendNotification(
            `📧 Email parseado — ${parsed.client_name || fromEmail}`,
            `From: ${fromEmail}\nSubject: ${subject}\n\n` +
            `Nombre:   ${parsed.client_name  ?? '—'}\n` +
            `Email:    ${parsed.client_email ?? '—'}\n` +
            `Teléfono: ${parsed.client_phone ?? '—'}\n` +
            `Evento:   ${parsed.service_hint ?? '—'}\n` +
            `Día:      ${parsed.day    ?? '—'}\n` +
            `Personas: ${parsed.slots  ?? '—'}\n` +
            `Idioma:   ${language}\n\n` +
            `Resumen:\n${parsed.comments}`
        )
    }

    return json({ ok: true }, 200)
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
    })
}

async function sendNotification(subject: string, text: string): Promise<void> {
    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (!apiKey) {
        console.warn('[inbound-email] RESEND_API_KEY no configurado — notificación omitida')
        return
    }
    try {
        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type':  'application/json'
            },
            body: JSON.stringify({
                from:    NOTIFY_FROM,
                to:      [NOTIFY_TO],
                subject,
                text
            })
        })
    } catch (err) {
        console.error('[inbound-email] Error enviando notificación:', err)
    }
}
