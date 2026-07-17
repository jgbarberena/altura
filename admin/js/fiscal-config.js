// Perfil fiscal del emisor (Paula Díaz Echalecu, actividad profesional).
// Este es el único sitio del proyecto donde se definen tipos y límites fiscales.
export const PERFIL_FISCAL = {
    actividad:         'profesional',  // 'profesional' activa la retención IRPF
    irpf_rate_default: 15,             // porcentaje (0-100)
    iva_rate:          21,             // porcentaje (0-100)
}

// Total con IVA ≤ este límite + cliente particular → factura simplificada (art. 4 RD 1619/2012)
export const LIMITE_SIMPLIFICADA = 400

// Tipo de retención IRPF aplicable (0 o irpf_rate_default) para un cliente dado.
// Las tres condiciones deben cumplirse; cualquier fallo → sin retención.
export function irpfRateParaCliente(cliente) {
    if (PERFIL_FISCAL.actividad !== 'profesional') return 0
    if (!cliente?.is_business)                     return 0
    if ((cliente?.country ?? 'ES') !== 'ES')       return 0
    return PERFIL_FISCAL.irpf_rate_default
}

// La factura puede ser simplificada si el cliente es particular Y el total no supera el límite.
// El total que se pasa es el importe con IVA (sin retención, ya que particulares → irpfRate=0).
export function esFacturaSimplificada(cliente, totalConIva) {
    if (cliente?.is_business) return false
    return totalConIva <= LIMITE_SIMPLIFICADA
}
