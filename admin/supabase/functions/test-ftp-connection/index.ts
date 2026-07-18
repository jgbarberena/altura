// Edge Function temporal de diagnóstico
// Verifica si las Edge Functions pueden conectar por TCP al servidor FTP de producción.
// Eliminar tras confirmar que funciona (o que no funciona).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info'
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

    // Verificar que hay sesión activa (igual que claude-proxy)
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })

    const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '')
    const { data: { user }, error } = await sb.auth.getUser(token)
    if (error || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })

    // Test de conectividad FTP
    const host = '185.50.45.33'
    const port = 21
    const steps: string[] = []

    try {
        steps.push(`Conectando a ${host}:${port}...`)
        const conn = await Deno.connect({ hostname: host, port, transport: 'tcp' })
        steps.push('TCP: conectado.')

        const buf = new Uint8Array(512)
        const n   = await conn.read(buf)
        const banner = new TextDecoder().decode(buf.subarray(0, n ?? 0)).trim()
        steps.push(`Banner FTP: ${banner}`)
        conn.close()

        return new Response(JSON.stringify({ ok: true, steps }), {
            headers: { ...CORS, 'Content-Type': 'application/json' }
        })
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        steps.push(`Error: ${msg}`)
        return new Response(JSON.stringify({ ok: false, steps }), {
            status: 500,
            headers: { ...CORS, 'Content-Type': 'application/json' }
        })
    }
})
