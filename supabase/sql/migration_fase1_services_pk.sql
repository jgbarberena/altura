-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN FASE 1: services.id (text PK) → integer PK + service_code (text)
-- Fecha: 2026-06-26
-- Ejecutar COMPLETO en Supabase SQL Editor.
-- PREREQUISITO: copiar las definiciones exactas de las 4 vistas desde
--   supabase/sql/views_pre_migration.sql (ya guardadas).
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- RESUMEN DE CAMBIOS EN SCHEMA:
--   services:              id text PK  →  id integer PK (serial)
--                          (nuevo)        service_code text UNIQUE NOT NULL
--   availability:          service_id text FK  →  service_id integer FK
--   reservations:          service_id text FK  →  service_id integer FK
--   reservation_requests.proposal_draft[].service_id: text code → integer
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 1: Eliminar vistas dependientes de services.id
-- (Sus definiciones están en supabase/sql/views_pre_migration.sql)
-- ────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.service_availability;
DROP VIEW IF EXISTS public.availability_panel;
DROP VIEW IF EXISTS public.availability_with_sfcom;
DROP VIEW IF EXISTS public.catalogo_publico;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 2: Añadir service_code a services (copia del id texto actual)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.services ADD COLUMN service_code text;
UPDATE public.services SET service_code = id;
ALTER TABLE public.services ALTER COLUMN service_code SET NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 3: Añadir columna id_new serial a services
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.services ADD COLUMN id_new serial;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 4: Añadir columnas service_id_new (integer) a las tablas con FK
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.availability ADD COLUMN service_id_new integer;
ALTER TABLE public.reservations  ADD COLUMN service_id_new integer;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 5: Poblar service_id_new con el id_new correspondiente
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.availability a
SET service_id_new = s.id_new
FROM public.services s
WHERE s.id = a.service_id;

UPDATE public.reservations r
SET service_id_new = s.id_new
FROM public.services s
WHERE s.id = r.service_id;

-- Verificar que no quedaron NULLs (debería devolver 0 filas):
-- SELECT id, service_id FROM availability WHERE service_id_new IS NULL;
-- SELECT id, service_id FROM reservations  WHERE service_id_new IS NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 6: Eliminar FK constraints antiguas
-- ATENCIÓN: los nombres exactos pueden variar. Verificar en Dashboard →
--   Table Editor → availability → Foreign Keys, y lo mismo para reservations.
--   Nombres habituales generados por Supabase:
--     availability_service_id_fkey
--     reservations_service_id_fkey
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.availability DROP CONSTRAINT availability_service_id_fkey;
ALTER TABLE public.reservations  DROP CONSTRAINT reservations_service_id_fkey;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 7: Eliminar columnas service_id texto antiguas
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.availability DROP COLUMN service_id;
ALTER TABLE public.reservations  DROP COLUMN service_id;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 8: Renombrar columnas nuevas a service_id
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.availability RENAME COLUMN service_id_new TO service_id;
ALTER TABLE public.reservations  RENAME COLUMN service_id_new TO service_id;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 9: NOT NULL en nuevas columnas
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.availability ALTER COLUMN service_id SET NOT NULL;
ALTER TABLE public.reservations  ALTER COLUMN service_id SET NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 10: Swap del PK en services (id text → id integer)
-- ────────────────────────────────────────────────────────────────────────────
-- 10a. Eliminar PK texto
ALTER TABLE public.services DROP CONSTRAINT services_pkey;

-- 10b. Eliminar la columna id texto
ALTER TABLE public.services DROP COLUMN id;

-- 10c. Renombrar id_new → id
ALTER TABLE public.services RENAME COLUMN id_new TO id;

-- 10d. Hacer id la nueva PK
ALTER TABLE public.services ADD PRIMARY KEY (id);

-- 10e. UNIQUE en service_code
ALTER TABLE public.services
    ADD CONSTRAINT uq_services_code UNIQUE (service_code);

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 11: Restaurar FK constraints apuntando al nuevo PK integer
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.availability
    ADD CONSTRAINT availability_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES public.services(id);

ALTER TABLE public.reservations
    ADD CONSTRAINT reservations_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES public.services(id);

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 12: Migrar proposal_draft[].service_id de text codes a integers
-- Cada elemento del array JSONB que tenga service_id = 'ENCIERRO_7' (texto)
-- lo reemplaza por el integer id correspondiente.
-- Elementos con service_id null o código inexistente conservan el valor.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.reservation_requests rr
SET proposal_draft = (
    SELECT jsonb_agg(
        CASE
            WHEN (elem->>'service_id') IS NOT NULL
             AND s.id IS NOT NULL
            THEN jsonb_set(elem, '{service_id}', to_jsonb(s.id))
            ELSE elem
        END
        ORDER BY ordinality
    )
    FROM jsonb_array_elements(rr.proposal_draft) WITH ORDINALITY AS t(elem, ordinality)
    LEFT JOIN public.services s ON s.service_code = (elem->>'service_id')
)
WHERE rr.proposal_draft IS NOT NULL
  AND jsonb_array_length(rr.proposal_draft) > 0;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 13: Actualizar función uppercase_ids() para el caso 'services'
--
-- EJECUTAR APARTE en el editor de funciones de Supabase (no va en la
-- transacción porque editar una función que está en uso puede requerir
-- confirmación del editor).
--
-- Buscar en Dashboard → Database → Functions → uppercase_ids
-- Cambiar el CASE para 'services' de:
--     WHEN 'services' THEN NEW.id := UPPER(NEW.id);
-- a:
--     WHEN 'services' THEN NEW.service_code := UPPER(NEW.service_code);
-- ────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 14: Recrear las 4 vistas con el nuevo esquema
-- ────────────────────────────────────────────────────────────────────────────

-- 15a. service_availability
-- CLAVE: expone service_code como service_id (texto) para que disponibilidad.js
-- y main.js del frontend público sigan funcionando SIN cambios.
CREATE VIEW public.service_availability
WITH (security_invoker = false) AS
SELECT
    s.service_code AS service_id,
    sum(a.total_slots)::numeric
        - COALESCE(sum(r.slots_reservados), 0::numeric) AS free_slots
FROM public.availability a
JOIN public.services s ON s.id = a.service_id
LEFT JOIN (
    SELECT
        res.service_id,
        res.venue_id,
        sum(res.slots) AS slots_reservados
    FROM public.reservations res
    WHERE res.status = ANY (ARRAY['Confirmada'::text, 'Pendiente'::text])
    GROUP BY res.service_id, res.venue_id
) r ON r.service_id = a.service_id AND r.venue_id = a.venue_id
GROUP BY s.id, s.service_code;

-- 15b. availability_panel
-- Añade service_code al schema original. service_id sigue siendo integer (FK).
CREATE VIEW public.availability_panel AS
SELECT
    a.id,
    a.venue_id,
    a.service_id,
    a.total_slots,
    a.price_per_slot,
    a.billing_model,
    a.description,
    a.access_instructions,
    a.photos,
    v.display_name  AS venue_display_name,
    v.address       AS venue_address,
    v.slug          AS venue_slug,
    s.event_type,
    s.day,
    s.start_time,
    s.service_code
FROM public.availability a
JOIN public.venues   v ON v.id = a.venue_id
JOIN public.services s ON s.id = a.service_id;

-- 15c. availability_with_sfcom
-- Añade service_code. service_id sigue siendo integer (FK).
CREATE VIEW public.availability_with_sfcom AS
SELECT
    a.id,
    a.venue_id,
    a.service_id,
    a.total_slots,
    a.price_per_slot,
    a.billing_model,
    v.display_name  AS venue_display_name,
    sl.sfcom_service_name,
    sl.sfcom_slots_listed,
    sl.sfcom_product_id,
    sl.sfcom_variation_id,
    sl.sfcom_status,
    sl.sfcom_public_price,
    sl.id           AS sfcom_listing_id,
    s.service_code
FROM public.availability a
JOIN public.venues       v  ON v.id  = a.venue_id
JOIN public.services     s  ON s.id  = a.service_id
LEFT JOIN public.sfcom_listings sl ON sl.availability_id = a.id;

-- 15d. catalogo_publico
-- service_id reemplazado por service_code (texto) para consistencia pública.
-- catalogo.js no usa service_id directamente, solo event_type/day/etc.
CREATE VIEW public.catalogo_publico
WITH (security_invoker = false) AS
SELECT
    v.slug,
    v.display_name,
    v.address,
    v.venue_type,
    s.service_code  AS service_id,
    a.description,
    a.access_instructions,
    a.photos,
    s.name          AS service_name,
    s.event_type,
    s.day,
    s.start_time,
    s.image_url     AS service_image_fallback
FROM public.venues   v
JOIN public.availability a ON a.venue_id = v.id
JOIN public.services     s ON s.id = a.service_id
WHERE v.slug IS NOT NULL;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar DESPUÉS del COMMIT)
-- ────────────────────────────────────────────────────────────────────────────

-- Estructura de services:
SELECT id, service_code, day, name, event_type FROM services ORDER BY service_code;

-- FK de availability:
SELECT a.id, a.service_id, s.service_code, s.name
FROM availability a JOIN services s ON s.id = a.service_id LIMIT 10;

-- FK de reservations:
SELECT r.id, r.service_id, s.service_code
FROM reservations r JOIN services s ON s.id = r.service_id LIMIT 10;

-- Vistas:
SELECT * FROM availability_panel        LIMIT 5;
SELECT * FROM service_availability      LIMIT 5;
SELECT * FROM catalogo_publico          LIMIT 5;
SELECT * FROM availability_with_sfcom   LIMIT 5;

-- proposal_draft migrado (ver que service_id es número, no texto):
SELECT id, proposal_draft->0->>'service_id' AS sid_0
FROM reservation_requests
WHERE jsonb_array_length(proposal_draft) > 0
LIMIT 10;
