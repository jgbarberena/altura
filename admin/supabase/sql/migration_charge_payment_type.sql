-- ============================================================================
-- MIGRACIÓN: is_final → charge_type / payment_type
--
-- Reemplaza la columna booleana is_final en charges y payments
-- por un tipo enumerado de tres valores:
--   'prepago' — adelanto/prepago normal (equivale a is_final=false)
--   'final'   — hito final calculado automáticamente (equivale a is_final=true)
--   'ajuste'  — nuevo: cargo/descuento incluido en la factura final
--
-- SEGURO ejecutar con datos en vivo. Transacción atómica.
-- Verificado: el trigger uppercase_ids() solo toca client_id/provider_id,
-- NO afecta a charge_type ni payment_type.
-- ============================================================================

BEGIN;

-- ── charges ──────────────────────────────────────────────────────────────────

-- 1. Añadir columna sin NOT NULL (permite rellenarla antes de aplicar la restricción)
ALTER TABLE charges ADD COLUMN charge_type text;

-- 2. Migrar datos desde is_final (NULL tratado como false → 'prepago')
UPDATE charges
SET charge_type = CASE WHEN is_final IS TRUE THEN 'final' ELSE 'prepago' END;

-- 3. Restricciones: obligatorio, valor por defecto, enumeración cerrada
ALTER TABLE charges
    ALTER COLUMN charge_type SET NOT NULL,
    ALTER COLUMN charge_type SET DEFAULT 'prepago',
    ADD CONSTRAINT charges_charge_type_check
        CHECK (charge_type IN ('prepago', 'final', 'ajuste'));

-- 4. Eliminar columna antigua (si había índices sobre is_final se eliminan solos)
ALTER TABLE charges DROP COLUMN is_final;

-- ── payments ─────────────────────────────────────────────────────────────────

-- 1. Añadir columna sin NOT NULL
ALTER TABLE payments ADD COLUMN payment_type text;

-- 2. Migrar datos desde is_final
UPDATE payments
SET payment_type = CASE WHEN is_final IS TRUE THEN 'final' ELSE 'prepago' END;

-- 3. Restricciones
ALTER TABLE payments
    ALTER COLUMN payment_type SET NOT NULL,
    ALTER COLUMN payment_type SET DEFAULT 'prepago',
    ADD CONSTRAINT payments_payment_type_check
        CHECK (payment_type IN ('prepago', 'final', 'ajuste'));

-- 4. Eliminar columna antigua
ALTER TABLE payments DROP COLUMN is_final;

COMMIT;
