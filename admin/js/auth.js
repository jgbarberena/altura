import { supabase } from './supabase.js'

export async function requireAuth() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) window.location.href = './admin/index.html'
    return session
}

export async function logout() {
    await supabase.auth.signOut()
    window.location.href = './admin/index.html'
}