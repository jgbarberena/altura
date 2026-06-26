-- Definiciones de vistas ANTES de la migración Fase 1 (services.id text → integer)
-- Extraídas del Dashboard de Supabase el 2026-06-26.
-- CONSERVAR: son la referencia para recrearlas después de la migración.

-- ─────────────────────────────────────────────────────────────────────────────
-- availability_panel
-- Solo authenticated. Usada por formulario.js, solicitudes.js, asistente.js,
-- proveedores.js. No incluye campos sfcom.
-- ─────────────────────────────────────────────────────────────────────────────
create view public.availability_panel as
select
  a.id,
  a.venue_id,
  a.service_id,
  a.total_slots,
  a.price_per_slot,
  a.billing_model,
  a.description,
  a.access_instructions,
  a.photos,
  v.display_name as venue_display_name,
  v.address as venue_address,
  v.slug as venue_slug,
  s.event_type,
  s.day,
  s.start_time
from
  availability a
  join venues v on v.id = a.venue_id
  join services s on s.id = a.service_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- availability_with_sfcom
-- Solo authenticated. JOIN de availability + sfcom_listings.
-- Usada exclusivamente por sfcom.js y sfcom-panel.js.
-- ─────────────────────────────────────────────────────────────────────────────
create view public.availability_with_sfcom as
select
  a.id,
  a.venue_id,
  a.service_id,
  a.total_slots,
  a.price_per_slot,
  a.billing_model,
  v.display_name as venue_display_name,
  sl.sfcom_service_name,
  sl.sfcom_slots_listed,
  sl.sfcom_product_id,
  sl.sfcom_variation_id,
  sl.sfcom_status,
  sl.sfcom_public_price,
  sl.id as sfcom_listing_id
from
  availability a
  join venues v on v.id = a.venue_id
  left join sfcom_listings sl on sl.availability_id = a.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- catalogo_publico
-- Acceso anon. security_invoker=false (accesible por anon aunque availability
-- tenga SELECT bloqueado para anon). Usada por catalogo/catalogo.js.
-- ─────────────────────────────────────────────────────────────────────────────
create view public.catalogo_publico as
select
  v.slug,
  v.display_name,
  v.address,
  v.venue_type,
  a.service_id,
  a.description,
  a.access_instructions,
  a.photos,
  s.name as service_name,
  s.event_type,
  s.day,
  s.start_time,
  s.image_url as service_image_fallback
from
  venues v
  join availability a on a.venue_id = v.id
  join services s on s.id = a.service_id
where
  v.slug is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- service_availability
-- Acceso anon. security_invoker=false. Usada por disponibilidad.js (frontend
-- público) para los badges de disponibilidad. Campos: service_id, free_slots.
-- ─────────────────────────────────────────────────────────────────────────────
create view public.service_availability as
select
  a.service_id,
  sum(a.total_slots)::numeric - COALESCE(sum(r.slots_reservados), 0::numeric) as free_slots
from
  availability a
  left join (
    select
      reservations.service_id,
      reservations.venue_id,
      sum(reservations.slots) as slots_reservados
    from
      reservations
    where
      reservations.status = any (array['Confirmada'::text, 'Pendiente'::text])
    group by
      reservations.service_id,
      reservations.venue_id
  ) r on r.service_id = a.service_id
  and r.venue_id = a.venue_id
group by
  a.service_id;
