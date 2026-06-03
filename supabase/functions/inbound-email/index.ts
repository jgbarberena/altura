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
// Para actualizar: editar este texto y redesplegar la función en Supabase dashboard.
const SYSTEM_PROMPT_PARSING = `\
Eres un extractor de datos estructurados para "Vive San Fermín desde dentro" (experienciasanfermin.com), negocio de experiencias exclusivas en San Fermín (Pamplona, España). Recibes el cuerpo de un email de consulta y debes extraer información clave.

CONTEXTO DEL NEGOCIO (para interpretar correctamente las consultas):
San Fermín se celebra del 6 al 14 de julio en Pamplona. Las experiencias principales son:
- Chupinazo: inicio de fiestas, 6 de julio a las 12:00, Plaza del Ayuntamiento. Balcones privados.
- Encierro: cada día del 7 al 14 de julio a las 8:00. Balcones en el recorrido (Estafeta, Mercaderes, Santo Domingo, Plaza del Ayuntamiento y otras ubicaciones).
- Procesión de San Fermín: 7 de julio por la mañana. Balcones en el recorrido (Mercaderes, Plaza del Ayuntamiento y otras ubicaciones).
- Despedida de Gigantes: 14 de julio. Plaza del Ayuntamiento y entorno.
- Pobre de Mí: cierre de fiestas, 14 de julio a las 24:00. Plaza del Ayuntamiento.
- Experiencias personalizadas y complementarias: visitas guiadas, corralillos del Gas, charla con corredores, barrera del encierro, apartado y sorteo taurino, encierrillo nocturno, corrida de toros, fuegos artificiales, desayuno premium, gestión de alojamiento, To-Kō Collection (welcome gifts).
- Experiencias para empresa u hotel: grupos corporativos, team building, clientes VIP, huéspedes de hotel, paquetes a medida.
- Pueden existir consultas fuera de lo estándar (usos profesionales, medios de comunicación, producción audiovisual, instituciones, etc.) que también atendemos caso a caso.

IMPORTANTE SOBRE EL ORIGEN DEL EMAIL:
Este email puede llegar de múltiples formas: reenviado desde paula@experienciasanfermin.com, paula@lemonmilk.es, desde WhatsApp exportado a email, o reenviado por un colaborador (como Hilario de tienda.sanfermin.com). El remitente del email que recibes NO es necesariamente el cliente. Busca el contacto real del cliente dentro del cuerpo del mensaje: nombre, email y teléfono aparecerán en el texto, en una firma, o en los datos de un formulario copiado. Ignora las direcciones de paula@, lemonmilk.es, goviwebs.com o cualquier dirección interna como remitente.

CAMPOS A EXTRAER:
Devuelve ÚNICAMENTE un objeto JSON válido, sin texto adicional, sin markdown, sin explicaciones:

{
  "client_name": string o null,
  "client_email": string o null,
  "client_phone": string o null,
  "service_hint": string o null,
  "service_hint_extra": array de strings (mismo vocabulario que service_hint) o [],
  "day": número entre 6 y 14 o null,
  "days_all": array de números 6-14 con todos los días mencionados o [],
  "days_flexible": boolean,
  "slots": número entero o null,
  "language": string de dos letras (es/en/fr/it/de/other),
  "comments": string
}

REGLAS DE EXTRACCIÓN:

client_name: nombre completo del cliente real (no de Paula ni de colaboradores internos). Si aparece en el cuerpo, en una firma del cliente o en datos de formulario copiado. Null si no aparece.

client_email: email de contacto del cliente real. Búscalo en el cuerpo del mensaje, no en el campo "from" del email (que será interno). Null si no aparece.

client_phone: teléfono del cliente si aparece en el cuerpo o en la firma del cliente. Null si no aparece.

service_hint: experiencia o momento de San Fermín que menciona el cliente. Usa exactamente uno de estos valores si aplica: "chupinazo", "encierro", "procesion", "gigantes", "pobre_de_mi", "personalizada", "empresa", "hotel". Si menciona varios, pon el principal. Si no menciona ninguno concreto o es una consulta fuera de catálogo, null.

day: si mencionan un día de julio concreto (del 6 al 14), extrae solo el número. Si dicen "el primer día" → 6, "el último día" → 14. Si mencionan varios días, pon el primero. Null si no especifican o si son flexibles.

service_hint_extra: otros servicios o momentos de San Fermín mencionados además del principal. Usa exactamente el mismo vocabulario que service_hint. Array vacío si no hay adicionales. Ejemplo: cliente pide "chupinazo y también encierro" → service_hint="chupinazo", service_hint_extra=["encierro"].

days_all: array con TODOS los días de julio (6-14) que menciona el cliente, incluyendo el ya recogido en day. Ejemplos: "el 7 y el 9" → [7,9] · "del 7 al 11" → [7,8,9,10,11] · "estaremos del 8 al 14" → [8,9,10,11,12,13,14] · un solo día → [ese día] · días no mencionados o cliente flexible → [].

days_flexible: true solo si el cliente indica explícitamente que cualquier día le va bien ("cualquier día", "lo que tengáis", "nos da igual el día", "somos flexibles con el día"). False en todos los demás casos, incluyendo cuando no menciona días.

slots: número de personas o plazas que solicitan. Null si no se menciona número concreto.

language: idioma principal en que está escrita la consulta del cliente (no el texto de reenvío interno). Valores: "es", "en", "fr", "it", "de", "other".

comments: resumen en español en 2-4 frases, en tercera persona, con el tono de una nota interna para el equipo de ventas. NO copies el texto original: interpreta, resume y añade contexto útil. Incluye: qué quieren, para cuándo, perfil aproximado del cliente (particular, grupo, empresa, hotel, medio de comunicación, uso no estándar, etc.), y cualquier detalle relevante sobre sus necesidades, urgencia, flexibilidad o restricción especial. Ejemplo: "Grupo de 6 amigos, primera vez en San Fermín, interesados en ver el encierro desde balcón para el día 9. Tono informal y entusiasta, parecen decididos. No mencionan presupuesto."`

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

    // 3 ── Llamar a Claude Haiku para extraer datos estructurados
    // SYSTEM_PROMPT_PARSING se define al inicio del archivo para facilitar su actualización

    let parsed: {
        client_name:        string | null
        client_email:       string | null
        client_phone:       string | null
        service_hint:       string | null
        service_hint_extra: string[]
        day:                number | null
        days_all:           number[]
        days_flexible:      boolean
        slots:              number | null
        language:           string
        comments:           string
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
            client_name:        null,
            client_email:       fromEmail || null,
            client_phone:       null,
            service_hint:       null,
            service_hint_extra: [],
            day:                null,
            days_all:           [],
            days_flexible:      false,
            slots:              null,
            language:           'es',
            comments:           'Email recibido — parsing automático fallido. Revisar manualmente.'
        }
        await sendNotification(
            '⚠️ Error parseando email entrante',
            `Error: ${parseError}\n\nFrom: ${fromEmail}\nSubject: ${subject}\n\nEmail original:\n${emailRaw}`
        )
    }

    // 5 ── Construir comments enriquecido con meta-datos de días y servicios extra
    // La Edge Function escribe el prefijo; el JS del asistente lo parsea después.
    let commentsPrefix = ''
    if (parsed.days_flexible) {
        commentsPrefix += 'Días: cualquiera\n'
    } else if ((parsed.days_all || []).length > 1) {
        commentsPrefix += `Días: ${parsed.days_all.join(', ')}\n`
    }
    if ((parsed.service_hint_extra || []).length > 0) {
        commentsPrefix += `Otros servicios: ${parsed.service_hint_extra.join(', ')}\n`
    }
    const finalComments = commentsPrefix
        ? commentsPrefix + '\n' + parsed.comments
        : parsed.comments

    // 6 ── Insertar en reservation_requests
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
            comments:     finalComments,
            source:       'email',
            status:       'email_parsed',
            language:     parsed.language || 'es',
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

    // 7 ── Notificación de éxito con resumen del parseo
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
            `Idioma:   ${parsed.language ?? '—'}\n\n` +
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
