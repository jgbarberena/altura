// ======================================================
// SUPABASE-GLOBAL.JS
// Inicializa el cliente Supabase para el frontend público
// y lo expone como window.supabasePublic.
// Script clásico (no módulo): debe cargarse después del
// CDN de supabase-js y antes de main.js.
// Solo se incluye en páginas que necesitan acceso a Supabase.
// ======================================================
 
(function () {
    if (!window.supabase) {
        console.error('supabase-global.js: CDN de Supabase no cargado.')
        return
    }

    const SUPABASE_URL = 'https://xpczeztrcupptsmqvmcu.supabase.co'
    const SUPABASE_KEY = 'sb_publishable_jwz44-n-zQUn6RH0qLtbEg_uj0R9T3H'

    window.supabasePublic = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        },
        global: {
            headers: { Authorization: 'Bearer ' + SUPABASE_KEY }
        }
    })
})()