import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  try {
    const { endpoint, method = 'GET', payload = null } = await req.json().catch(() => ({}))

    if (!endpoint) {
      return new Response(JSON.stringify({ error: 'endpoint requerido' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    const PAULA_KEY = Deno.env.get('SFCOM_API_KEY') ?? ''
    const BASE_URL  = 'https://tienda.sanfermin.com/sf-api-paula.php'
    const url       = `${BASE_URL}?endpoint=${encodeURIComponent(endpoint)}`

    const init: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Paula-Key': PAULA_KEY,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
      },
      signal: AbortSignal.timeout(12000),
    }
    if (payload !== null && payload !== undefined) init.body = JSON.stringify(payload)

    const response = await fetch(url, init)
    const contentType = response.headers.get('content-type')
    const data = (contentType && contentType.includes('application/json'))
      ? await response.json()
      : { text: await response.text() }

    return new Response(JSON.stringify(data), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      status: response.status,
    })
  } catch (err: any) {
    const isTimeout = err?.name === 'TimeoutError' || String(err?.message).includes('timeout')
    return new Response(JSON.stringify({ error: err.message, timeout: isTimeout }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      status: isTimeout ? 504 : 400,
    })
  }
})
