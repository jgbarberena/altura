// Edge Function: upload-venue-photo
// Sube una imagen al servidor de producción vía FTP y devuelve la URL pública.
// La imagen queda en /httpdocs/img/venues/ → https://experienciasanfermin.com/img/venues/
//
// Secrets necesarios en Supabase Vault:
//   FTP_HOST — IP o hostname del servidor FTP
//   FTP_USER — usuario FTP
//   FTP_PASS — contraseña FTP
//
// SUPABASE_URL y SUPABASE_ANON_KEY están disponibles automáticamente.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info'
}

const FTP_PORT    = 21
const REMOTE_DIR  = '/httpdocs/img/venues'
const PUBLIC_BASE = 'https://experienciasanfermin.com/img/venues'

// ── Cliente FTP mínimo (solo upload) ──────────────────────────────────────

class FTPClient {
    private ctrl!: Deno.TcpConn
    private ctrlHost = ''
    private enc = new TextEncoder()
    private dec = new TextDecoder()

    async connect(host: string, port: number): Promise<string> {
        this.ctrlHost = host
        this.ctrl = await Deno.connect({ hostname: host, port, transport: 'tcp' })
        return await this._read()
    }

    async cmd(c: string): Promise<string> {
        await this.ctrl.write(this.enc.encode(c + '\r\n'))
        return await this._read()
    }

    // Lee la respuesta completa del servidor (puede ser multi-línea).
    // Las respuestas FTP terminan cuando la última línea no vacía empieza por "NNN " (espacio).
    private async _read(): Promise<string> {
        let text = ''
        const buf = new Uint8Array(8192)
        while (true) {
            const n = await this.ctrl.read(buf)
            if (n === null) break
            text += this.dec.decode(buf.subarray(0, n))
            const last = text.split('\n').map(l => l.trimEnd()).reverse().find(l => l.length >= 4)
            if (last && /^\d{3} /.test(last)) break
        }
        return text.trim()
    }

    async upload(remoteDir: string, filename: string, data: Uint8Array): Promise<void> {
        await this.cmd('TYPE I')       // modo binario
        await this.cmd(`MKD ${remoteDir}`)  // crear directorio (ignorar 550 si ya existe)

        const cwdResp = await this.cmd(`CWD ${remoteDir}`)
        if (!cwdResp.startsWith('250')) throw new Error(`CWD falló: ${cwdResp}`)

        // Modo pasivo: el servidor abre el puerto de datos
        const pasvResp = await this.cmd('PASV')
        const m = pasvResp.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/)
        if (!m) throw new Error(`No se pudo parsear PASV: ${pasvResp}`)

        const rawDataHost = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`
        const dataPort    = parseInt(m[5]) * 256 + parseInt(m[6])
        // Servidores detrás de NAT pueden devolver IP privada en PASV; usar host del canal de control
        const isPrivate   = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(rawDataHost)
        const dataHost    = isPrivate ? this.ctrlHost : rawDataHost

        const dataConn = await Deno.connect({ hostname: dataHost, port: dataPort, transport: 'tcp' })

        await this.ctrl.write(this.enc.encode(`STOR ${filename}\r\n`))
        await this._read()  // 150 Abriendo conexión de datos...

        // Enviar datos en chunks de 64 KB
        let offset = 0
        while (offset < data.length) {
            const chunk = data.subarray(offset, Math.min(offset + 65536, data.length))
            await dataConn.write(chunk)
            offset += chunk.length
        }
        dataConn.close()

        await this._read()  // 226 Transferencia completada
    }

    close(): void {
        try { this.ctrl.close() } catch { /* ignorar */ }
    }
}

// ── Handler principal ──────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (req.method !== 'POST')   return json({ error: 'Method not allowed' }, 405)

    // 1 ── Autenticación
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ error: 'Unauthorized' }, 401)

    const sb = createClient(
        Deno.env.get('SUPABASE_URL')      ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )
    const { data: { user }, error: authErr } = await sb.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    // 2 ── Parsear archivo
    let form: FormData
    try { form = await req.formData() }
    catch { return json({ error: 'Se esperaba multipart/form-data' }, 400) }

    const file = form.get('file') as File | null
    if (!file) return json({ error: 'Campo "file" requerido' }, 400)

    // Sanitizar nombre: conservar extensión y caracteres seguros
    const ext      = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
    const base     = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
    const filename = `${base}.${ext}`

    // 3 ── Credenciales FTP desde Vault
    const host = Deno.env.get('FTP_HOST') ?? ''
    const user = Deno.env.get('FTP_USER') ?? ''
    const pass = Deno.env.get('FTP_PASS') ?? ''
    if (!host || !user || !pass) return json({ error: 'FTP no configurado (faltan secrets)' }, 500)

    const fileData = new Uint8Array(await file.arrayBuffer())

    // 4 ── Subir por FTP
    const ftp = new FTPClient()
    try {
        await ftp.connect(host, FTP_PORT)
        await ftp.cmd(`USER ${user}`)
        await ftp.cmd(`PASS ${pass}`)
        await ftp.upload(REMOTE_DIR, filename, fileData)
    } catch (e) {
        ftp.close()
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[upload-venue-photo]', msg)
        return json({ error: msg }, 500)
    }
    ftp.close()

    return json({ ok: true, url: `${PUBLIC_BASE}/${filename}`, filename })
})

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json' }
    })
}
