// Edge Function temporal de diagnóstico
// Verifica si las Edge Functions pueden conectar por TCP al servidor FTP de producción.
// Eliminar tras confirmar que funciona (o que no funciona).
// No requiere autenticación — solo para prueba puntual.

Deno.serve(async (_req: Request) => {
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
        steps.push(`Banner FTP recibido: ${banner}`)
        conn.close()

        return new Response(JSON.stringify({ ok: true, steps }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        })
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        steps.push(`Error: ${msg}`)
        return new Response(JSON.stringify({ ok: false, steps }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        })
    }
})
