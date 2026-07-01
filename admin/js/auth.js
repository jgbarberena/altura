import { supabase } from './supabase.js'

function _mostrarToastSesionExpirada() {
    const toast = document.createElement('div')
    toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#b91c1c;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.2);cursor:pointer;white-space:nowrap'
    toast.textContent = '⚠️ Tu sesión ha caducado — haz clic aquí para recargar'
    toast.onclick = () => window.location.reload()
    document.body.appendChild(toast)
}

export async function requireAuth() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
        window.location.href = './index.html'
        return null
    }
    supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') _mostrarToastSesionExpirada()
    })
    return session
}

export async function logout() {
    await supabase.auth.signOut()
    window.location.href = './index.html'
}