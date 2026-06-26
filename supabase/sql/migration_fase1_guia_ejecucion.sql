-- ═══════════════════════════════════════════════════════════════════════════════
-- GUÍA DE EJECUCIÓN — Migración Fase 1: services.id text → integer PK
-- Archivo: migration_fase1_guia_ejecucion.sql
-- IMPORTANTE: este archivo NO se ejecuta en un solo pegado.
-- Sigue los 3 bloques en orden, cada uno es un RUN separado en Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  RUN 1 — PRE-VUELO (ejecutar ANTES de la migración)                     ║
-- ║  Objetivo: verificar que los nombres de constraints son los esperados    ║
-- ║  y que el estado inicial es correcto. NO modifica nada.                 ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- 1a. Verificar nombres de FK constraints en availability y reservations
--     → Debe aparecer: availability_service_id_fkey y reservations_service_id_fkey
--     Si los nombres son distintos, avisa antes de ejecutar la migración.
SELECT
    tc.table_name,
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name  AS foreign_table,
    ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('availability', 'reservations')
  AND kcu.column_name = 'service_id'
ORDER BY tc.table_name;

-- Resultado esperado:
-- availability | availability_service_id_fkey | service_id | services | id
-- reservations | reservations_service_id_fkey | service_id | services | id
-- Si los nombres son DIFERENTES, edita el RUN 2 antes de ejecutarlo.

-- 1b. Estado actual de services.id (tipo y algunos valores)
--     → id debe ser de tipo 'text' todavía
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'services'
  AND column_name = 'id';

-- Resultado esperado: id | text

-- 1c. Muestra los servicios actuales (para confirmar datos)
SELECT id, day, name, event_type FROM public.services ORDER BY id;

-- 1d. Cuántas filas tienen availability y reservations (para verificar después)
SELECT 'availability' AS tabla, count(*) FROM public.availability
UNION ALL
SELECT 'reservations',          count(*) FROM public.reservations
UNION ALL
SELECT 'reservation_requests',  count(*) FROM public.reservation_requests;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  RUN 2 — MIGRACIÓN COMPLETA (una sola ejecución, no tocar nada dentro)  ║
-- ║  Pega TODO este bloque (desde BEGIN hasta COMMIT inclusive) de una vez.  ║
-- ║  Si algo falla → rollback automático, nada queda a medias.              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

BEGIN;

-- PASO 1: Eliminar vistas dependientes de services.id
DROP VIEW IF EXISTS public.service_availability;
DROP VIEW IF EXISTS public.availability_panel;
DROP VIEW IF EXISTS public.availability_with_sfcom;
DROP VIEW IF EXISTS public.catalogo_publico;

-- PASO 2: Añadir service_code a services (copia del id texto actual)
ALTER TABLE public.services ADD COLUMN service_code text;
UPDATE public.services SET service_code = id;
ALTER TABLE public.services ALTER COLUMN service_code SET NOT NULL;

-- PASO 3: Añadir columna id_new serial a services
ALTER TABLE public.services ADD COLUMN id_new serial;

-- PASO 4: Añadir columnas service_id_new (integer) a las tablas con FK
ALTER TABLE public.availability ADD COLUMN service_id_new integer;
ALTER TABLE public.reservations  ADD COLUMN service_id_new integer;

-- PASO 5: Poblar service_id_new con el id_new correspondiente
UPDATE public.availability a
SET service_id_new = s.id_new
FROM public.services s
WHERE s.id = a.service_id;

UPDATE public.reservations r
SET service_id_new = s.id_new
FROM public.services s
WHERE s.id = r.service_id;

-- PASO 6: Eliminar FK constraints antiguas
-- ⚠ Si el RUN 1 mostró nombres distintos, cámbialos aquí:
ALTER TABLE public.availability DROP CONSTRAINT availability_service_id_fkey;
ALTER TABLE public.reservations  DROP CONSTRAINT reservations_service_id_fkey;

-- PASO 7: Eliminar columnas service_id texto antiguas
ALTER TABLE public.availability DROP COLUMN service_id;
ALTER TABLE public.reservations  DROP COLUMN service_id;

-- PASO 8: Renombrar columnas nuevas a service_id
ALTER TABLE public.availability RENAME COLUMN service_id_new TO service_id;
ALTER TABLE public.reservations  RENAME COLUMN service_id_new TO service_id;

-- PASO 9: NOT NULL en nuevas columnas
ALTER TABLE public.availability ALTER COLUMN service_id SET NOT NULL;
ALTER TABLE public.reservations  ALTER COLUMN service_id SET NOT NULL;

-- PASO 10: Swap del PK en services (id text → id integer)
ALTER TABLE public.services DROP CONSTRAINT services_pkey;
ALTER TABLE public.services DROP COLUMN id;
ALTER TABLE public.services RENAME COLUMN id_new TO id;
ALTER TABLE public.services ADD PRIMARY KEY (id);
ALTER TABLE public.services
    ADD CONSTRAINT uq_services_code UNIQUE (service_code);

-- PASO 11: Restaurar FK constraints apuntando al nuevo PK integer
ALTER TABLE public.availability
    ADD CONSTRAINT availability_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES public.services(id);

ALTER TABLE public.reservations
    ADD CONSTRAINT reservations_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES public.services(id);

-- PASO 12: Migrar proposal_draft[].service_id de text codes a integers
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

-- PASO 13: uppercase_ids() → hacerlo A MANO después del COMMIT
-- Dashboard → Database → Functions → uppercase_ids
-- Cambiar: WHEN 'services' THEN NEW.id := UPPER(NEW.id);
-- Por:     WHEN 'services' THEN NEW.service_code := UPPER(NEW.service_code);

-- PASO 14: Recrear las 4 vistas con el nuevo esquema

-- 15a. service_availability
-- Expone service_code AS service_id (texto) → frontend público sin cambios
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
-- Añade service_code. service_id sigue siendo integer FK.
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
-- Añade service_code. service_id sigue siendo integer FK.
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
-- service_code expuesto como service_id (texto) → frontend público sin cambios
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


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  RUN 3 — VERIFICACIONES POST-MIGRACIÓN (ejecutar tras el COMMIT)        ║
-- ║  Puedes ejecutar cada query por separado o todas juntas.                ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- 3a. services: id debe ser integer, service_code debe tener los valores de antes
SELECT id, service_code, day, name, event_type
FROM public.services
ORDER BY service_code;
-- Esperado: id=1,2,3... (enteros), service_code='ENCIERRO_7','CHUPINAZO_6'...

-- 3b. availability: service_id debe ser integer, JOIN con services funciona
SELECT a.id, a.venue_id, a.service_id, s.service_code, s.name
FROM public.availability a
JOIN public.services s ON s.id = a.service_id
LIMIT 10;
-- Esperado: service_id es número, service_code es texto legible

-- 3c. reservations: service_id debe ser integer
SELECT r.id, r.service_id, s.service_code, r.status
FROM public.reservations r
JOIN public.services s ON s.id = r.service_id
LIMIT 10;

-- 3d. proposal_draft migrado: service_id debe ser número, no texto
SELECT
    id,
    proposal_draft->0->>'service_id'   AS sid_0,
    proposal_draft->0->>'service_name' AS sname_0
FROM public.reservation_requests
WHERE proposal_draft IS NOT NULL
  AND jsonb_array_length(proposal_draft) > 0
LIMIT 10;
-- Esperado: sid_0 = '1', '3', '7'... (número en string JSON), NO 'ENCIERRO_7'

-- 3e. Recuentos: deben coincidir con los del RUN 1
SELECT 'availability' AS tabla, count(*) FROM public.availability
UNION ALL
SELECT 'reservations',          count(*) FROM public.reservations
UNION ALL
SELECT 'reservation_requests',  count(*) FROM public.reservation_requests;

-- 3f. Las 4 vistas devuelven filas
SELECT 'availability_panel'      AS vista, count(*) FROM public.availability_panel
UNION ALL
SELECT 'availability_with_sfcom',          count(*) FROM public.availability_with_sfcom
UNION ALL
SELECT 'service_availability',             count(*) FROM public.service_availability
UNION ALL
SELECT 'catalogo_publico',                 count(*) FROM public.catalogo_publico;
-- Esperado: mismas filas que antes en cada vista

-- 3g. service_availability: service_id debe ser TEXTO (el código), no número
--     → esto es lo que usa el frontend público
SELECT service_id, free_slots
FROM public.service_availability
ORDER BY service_id;
-- Esperado: service_id = 'ENCIERRO_7', 'CHUPINAZO_6'... (texto, no número)

-- 3h. Confirmar FK constraints recreadas correctamente
SELECT
    tc.table_name,
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name  AS foreign_table,
    ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('availability', 'reservations')
  AND kcu.column_name = 'service_id'
ORDER BY tc.table_name;
-- Esperado: las mismas FKs que en el RUN 1, ahora apuntando a services.id (integer)
