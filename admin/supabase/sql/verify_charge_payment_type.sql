-- ============================================================================
-- VERIFICACIÓN: migración charge_type / payment_type
-- Ejecutar en SQL Editor de Supabase. No modifica nada.
-- ============================================================================

-- ── 1. Columnas presentes y tipos correctos ───────────────────────────────────
SELECT
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('charges', 'payments')
  AND column_name IN ('charge_type', 'payment_type', 'is_final')
ORDER BY table_name, column_name;
-- Esperado: 2 filas (charge_type en charges, payment_type en payments).
-- is_final NO debe aparecer.

-- ── 2. CHECK constraints presentes ───────────────────────────────────────────
SELECT
    tc.table_name,
    tc.constraint_name,
    cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc
    ON tc.constraint_name = cc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('charges', 'payments')
  AND tc.constraint_type = 'CHECK'
  AND tc.constraint_name IN ('charges_charge_type_check', 'payments_payment_type_check')
ORDER BY tc.table_name;
-- Esperado: 2 filas con los CHECK constraints de la migración.

-- ── 3. Distribución de valores: ningún NULL, solo valores válidos ─────────────
SELECT 'charges' AS tabla, charge_type AS tipo, COUNT(*) AS filas
FROM charges
GROUP BY charge_type
UNION ALL
SELECT 'payments', payment_type, COUNT(*)
FROM payments
GROUP BY payment_type
ORDER BY tabla, tipo;
-- Esperado: solo valores 'prepago' y 'final' (ningún 'ajuste' todavía, ningún NULL).

-- ── 4. Garantía de unicidad: máximo un 'final' por cliente/proveedor/temporada ─
SELECT 'charges' AS tabla, client_id AS entidad, season, COUNT(*) AS n_finales
FROM charges
WHERE charge_type = 'final'
GROUP BY client_id, season
HAVING COUNT(*) > 1
UNION ALL
SELECT 'payments', provider_id, season, COUNT(*)
FROM payments
WHERE payment_type = 'final'
GROUP BY provider_id, season
HAVING COUNT(*) > 1;
-- Esperado: 0 filas. Si aparece alguna, hay una inconsistencia preexistente.
