-- ============================================================================
-- FASE 11 — Backfill: charges con factura → issued_invoices
-- Script one-shot. Ejecutar en SQL editor de Supabase.
--
-- Contexto: charges.amount ES la base imponible (no el total líquido).
-- La factura muestra base=amount, IVA=amount×21%, IRPF=amount×15%,
-- total_a_pagar=amount×1.06. Confirmado 16/07/2026.
-- ============================================================================

BEGIN;

WITH ins AS (
    INSERT INTO issued_invoices (
        invoice_number,
        issue_date,
        accrual_date,
        client_id,
        client_name,
        client_nif,
        client_address,
        total,
        file_path,
        charge_id,
        season,
        irpf_rate,
        irpf_amount,
        invoice_type,
        operation_type
    )
    SELECT
        c.invoice_number,
        c.invoiced_at                            AS issue_date,
        COALESCE(c.collected_date, c.invoiced_at) AS accrual_date,
        c.client_id,
        COALESCE(cl.company, cl.name, cl.id)     AS client_name,
        cl.nif                                   AS client_nif,
        cl.address                               AS client_address,
        ROUND(c.amount * 1.06, 2)               AS total,
        c.invoice_path                           AS file_path,
        c.id                                     AS charge_id,
        c.season,
        15                                       AS irpf_rate,
        ROUND(c.amount * 0.15, 2)               AS irpf_amount,
        NULL::text                               AS invoice_type,
        'interior'                               AS operation_type
    FROM   charges c
    JOIN   clients cl ON cl.id = c.client_id
    WHERE  c.invoice_number IS NOT NULL
    ORDER  BY c.invoice_number
    RETURNING id, charge_id
)
INSERT INTO issued_invoice_vat_lines (invoice_id, base_amount, vat_rate, vat_amount)
SELECT
    ins.id                           AS invoice_id,
    c.amount                         AS base_amount,
    21                               AS vat_rate,
    ROUND(c.amount * 0.21, 2)       AS vat_amount
FROM   ins
JOIN   charges c ON c.id = ins.charge_id;

COMMIT;
