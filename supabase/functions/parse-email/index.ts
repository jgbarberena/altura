// Edge Function: parse-email
// Recibe el texto de un email pegado manualmente en el panel admin,
// lo parsea con Claude Haiku y devuelve el JSON estructurado.
// El INSERT en reservation_requests lo hace el JS del admin directamente.
//
// Autenticación: JWT de sesión Supabase (mismo patrón que claude-proxy).
// Secrets necesarios: ANTHROPIC_API_KEY (ya en Supabase Vault).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MODEL = 'claude-haiku-4-5-20251001'

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

const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders, status: 204 })
    }

    if (req.method !== 'POST') {
        return json({ ok: false, error: 'Method not allowed' }, 405)
    }

    // Verificar JWT de sesión Supabase
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')      ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
        return json({ ok: false, error: 'Unauthorized' }, 401)
    }

    let body: { text?: string }
    try {
        body = await req.json()
    } catch {
        return json({ ok: false, error: 'Invalid JSON' }, 400)
    }

    const emailText = (body.text ?? '').trim()
    if (!emailText) {
        return json({ ok: false, error: 'Empty text' }, 400)
    }

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
                messages:   [{ role: 'user', content: emailText }]
            })
        })

        if (!claudeRes.ok) {
            throw new Error(`Claude API ${claudeRes.status}: ${await claudeRes.text()}`)
        }

        const claudeData = await claudeRes.json()
        const rawText    = String(claudeData?.content?.[0]?.text ?? '').trim()
        const jsonMatch  = rawText.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('No JSON found in Claude response')

        const parsed = JSON.parse(jsonMatch[0])
        return new Response(JSON.stringify({ ok: true, parsed }), {
            status:  200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return json({ ok: false, error: message }, 500)
    }
})

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
}
