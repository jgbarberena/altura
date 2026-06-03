// Configuración del asistente de respuestas a clientes.
// Para actualizar el system prompt: editar solo este archivo y subir por FTP.

// Prompt del asistente interactivo de Paula para redactar respuestas a clientes.
// Este texto se envía a Claude en cada conversación del asistente.
// Para actualizar: pegar aquí el texto completo y subir este archivo por FTP.
//
// Nota sobre el prompt de parseo de emails: ese prompt vive en la Edge Function
// inbound-email (supabase/functions/inbound-email/index.ts), no aquí, porque las
// Edge Functions corren en servidores de Supabase y no pueden importar este archivo.
// Cuando tengas el texto definitivo del prompt de parseo, édítalo directamente en
// el dashboard de Supabase: Edge Functions → inbound-email → (editar) → constante
// SYSTEM_PROMPT_PARSING al inicio del archivo.

export const SYSTEM_PROMPT_ASISTENTE = ``
