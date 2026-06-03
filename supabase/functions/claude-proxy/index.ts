// Edge Function: claude-proxy
// Recibe peticiones POST autenticadas desde el panel de admin y las reenvía
// a la Claude API (Anthropic). La API key nunca sale al navegador.
//
// Secrets necesarios en Supabase Vault:
//   ANTHROPIC_API_KEY — clave de Anthropic
//
// SUPABASE_URL y SUPABASE_ANON_KEY están disponibles automáticamente.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DEFAULT_MODEL = 'claude-sonnet-4-6'
const ALLOWED_MODELS = new Set([
    'claude-sonnet-4-6',
    'claude-opus-4-7',
    'claude-haiku-4-5-20251001'
])

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info'
}

Deno.serve(async (req: Request) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: CORS })
    }

    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405)
    }

    // 1 ── Verificar autenticación
    // supabase.functions.invoke() envía el JWT de sesión en Authorization
    const authHeader = req.headers.get('Authorization') ?? ''
    const token      = authHeader.replace(/^Bearer\s+/i, '').trim()

    if (!token) {
        return json({ error: 'Unauthorized' }, 401)
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')      ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
        return json({ error: 'Unauthorized' }, 401)
    }

    // 2 ── Parsear el body
    let body: { messages: unknown; system?: string; max_tokens?: number; model?: string }
    try {
        body = await req.json()
    } catch {
        return json({ error: 'Invalid JSON' }, 400)
    }

    const { messages, system, max_tokens = 1000, model: reqModel } = body
    const model = (reqModel && ALLOWED_MODELS.has(reqModel)) ? reqModel : DEFAULT_MODEL

    if (!Array.isArray(messages) || messages.length === 0) {
        return json({ error: 'messages must be a non-empty array' }, 400)
    }

    // 3 ── Reenviar a Claude API con prompt caching en el system prompt
    const anthropicBody: Record<string, unknown> = {
        model,
        max_tokens,
        messages
    }
    // Envolver el system prompt en formato de array con cache_control para que
    // Anthropic cachee el bloque y no lo procese de nuevo en cada turno.
    if (system) {
        anthropicBody.system = [
            { type: 'text', text: system, cache_control: { type: 'ephemeral' } }
        ]
    }

    try {
        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type':        'application/json',
                'x-api-key':           Deno.env.get('ANTHROPIC_API_KEY') ?? '',
                'anthropic-version':   '2023-06-01',
                'anthropic-beta':      'prompt-caching-2024-07-31'
            },
            body: JSON.stringify(anthropicBody)
        })

        const data = await claudeRes.json()

        return new Response(JSON.stringify(data), {
            status:  claudeRes.status,
            headers: { ...CORS, 'Content-Type': 'application/json' }
        })
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[claude-proxy] Error:', msg)
        return json({ error: msg }, 500)
    }
})

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json' }
    })
}
