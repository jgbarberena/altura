import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

export const SUPABASE_URL = 'https://xpczeztrcupptsmqvmcu.supabase.co'
const SUPABASE_KEY = 'sb_publishable_jwz44-n-zQUn6RH0qLtbEg_uj0R9T3H'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)