-- ============================================================================
-- FASE 11 — Módulo de cierre fiscal
-- Ejecutar entero en el SQL editor de Supabase (un solo clic en "Run").
-- ============================================================================

BEGIN;

-- ── NIF de proveedor (prerelleno de comodidad, no requisito fiscal) ───────────
ALTER TABLE providers ADD COLUMN IF NOT EXISTS nif text;

-- ── Bandeja de documentos recibidos (archivador OPERATIVO, no fiscal) ─────────
-- Una fila por PDF/foto subido. No tiene consecuencias fiscales por sí sola.
-- provider_id NULLABLE: hosting, gestor, dominio no tienen proveedor en BD.
CREATE TABLE supplier_documents (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider_id text        REFERENCES providers(id) ON DELETE RESTRICT,
    file_path   text        NOT NULL,
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    season      integer     NOT NULL,
    notes       text
);

-- ── Libro de facturas RECIBIDAS (archivador FISCAL) ───────────────────────────
-- Solo existen filas COMPLETAS. Sin estado borrador. Un documento sin fila aquí
-- es un documento "pendiente de contabilizar".
CREATE TABLE supplier_invoices (
    id              bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id     bigint  NOT NULL UNIQUE REFERENCES supplier_documents(id) ON DELETE RESTRICT,
    provider_id     text    REFERENCES providers(id) ON DELETE RESTRICT,
    issuer_name     text    NOT NULL,
    issuer_nif      text    NOT NULL,
    invoice_number  text    NOT NULL,
    issue_date      date    NOT NULL,
    booked_date     date    NOT NULL,   -- fecha de registro; determina el trimestre fiscal
    operation_type  text    NOT NULL DEFAULT 'interior'
                    CHECK (operation_type IN (
                        'interior','intracomunitaria','extracomunitaria','inversion_sujeto_pasivo'
                    )),
    category        text    NOT NULL DEFAULT 'proveedores',
    deductible_pct  numeric NOT NULL DEFAULT 100 CHECK (deductible_pct BETWEEN 0 AND 100),
    is_capital_good boolean NOT NULL DEFAULT false,
    irpf_rate       numeric,
    irpf_amount     numeric,
    total           numeric NOT NULL,
    season          integer NOT NULL,
    notes           text,
    UNIQUE (issuer_nif, invoice_number)
);

CREATE TABLE supplier_invoice_vat_lines (
    id          bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id  bigint  NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
    base_amount numeric NOT NULL,
    vat_rate    numeric NOT NULL,
    vat_amount  numeric NOT NULL
);

-- ── Libro de facturas EMITIDAS (archivador FISCAL) ────────────────────────────
-- Los campos del cliente se congela en el momento de emisión; no hacer JOIN a
-- clients para recuperarlos — el documento fiscal es lo que se imprimió.
CREATE TABLE issued_invoices (
    id             bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_number text    NOT NULL UNIQUE,
    issue_date     date    NOT NULL,
    accrual_date   date    NOT NULL,   -- fecha de devengo; determina el trimestre fiscal
    client_id      text    REFERENCES clients(id) ON DELETE RESTRICT,
    client_name    text    NOT NULL,
    client_nif     text,
    client_address text,
    operation_type text    NOT NULL DEFAULT 'interior'
                   CHECK (operation_type IN (
                       'interior','intracomunitaria','extracomunitaria','inversion_sujeto_pasivo'
                   )),
    invoice_type   text    CHECK (invoice_type IS NULL OR invoice_type IN (
                       'adelanto','liquidacion','unico'
                   )),
    irpf_rate      numeric,
    irpf_amount    numeric,
    total          numeric NOT NULL,
    file_path      text,
    charge_id      integer UNIQUE REFERENCES charges(id) ON DELETE SET NULL,
    season         integer NOT NULL,
    notes          text
);

CREATE TABLE issued_invoice_vat_lines (
    id          bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id  bigint  NOT NULL REFERENCES issued_invoices(id) ON DELETE CASCADE,
    base_amount numeric NOT NULL,
    vat_rate    numeric NOT NULL,
    vat_amount  numeric NOT NULL
);

-- ── Candado de trimestres presentados ────────────────────────────────────────
CREATE TABLE fiscal_closings (
    id                     bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    model                  text    NOT NULL DEFAULT 'F69',
    year                   integer NOT NULL,
    quarter                integer NOT NULL CHECK (quarter BETWEEN 1 AND 4),
    presented_at           date,
    result_amount          numeric,
    vat_to_compensate_next numeric,
    notes                  text,
    UNIQUE (model, year, quarter)
);

-- ── Índices ───────────────────────────────────────────────────────────────────
CREATE INDEX idx_supplier_invoices_booked ON supplier_invoices (booked_date);
CREATE INDEX idx_supplier_invoices_prov   ON supplier_invoices (provider_id, season);
CREATE INDEX idx_supplier_documents_prov  ON supplier_documents (provider_id, season);
CREATE INDEX idx_issued_invoices_accrual  ON issued_invoices (accrual_date);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE supplier_documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoice_vat_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE issued_invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE issued_invoice_vat_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_closings            ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all" ON supplier_documents
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON supplier_invoices
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON supplier_invoice_vat_lines
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON issued_invoices
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON issued_invoice_vat_lines
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON fiscal_closings
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Función auxiliar: ¿está cerrado el trimestre de una fecha dada? ───────────
CREATE OR REPLACE FUNCTION fiscal_period_is_closed(d date)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM fiscal_closings
        WHERE presented_at IS NOT NULL
          AND year    = EXTRACT(YEAR    FROM d)::integer
          AND quarter = EXTRACT(QUARTER FROM d)::integer
    )
$$;

-- ── Trigger: supplier_invoices (protege booked_date) ─────────────────────────
CREATE OR REPLACE FUNCTION trg_supplier_invoices_immutable_fn()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_check date;
BEGIN
    -- UPDATE: la fecha antigua también debe estar en trimestre abierto
    IF TG_OP = 'UPDATE' AND fiscal_period_is_closed(OLD.booked_date) THEN
        RAISE EXCEPTION 'Trimestre % T% ya presentado — no se puede modificar',
            EXTRACT(YEAR FROM OLD.booked_date)::integer,
            EXTRACT(QUARTER FROM OLD.booked_date)::integer;
    END IF;

    v_check := CASE WHEN TG_OP = 'DELETE' THEN OLD.booked_date ELSE NEW.booked_date END;

    IF fiscal_period_is_closed(v_check) THEN
        RAISE EXCEPTION 'Trimestre % T% ya presentado — no se puede modificar',
            EXTRACT(YEAR FROM v_check)::integer,
            EXTRACT(QUARTER FROM v_check)::integer;
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER trg_supplier_invoices_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON supplier_invoices
    FOR EACH ROW EXECUTE FUNCTION trg_supplier_invoices_immutable_fn();

-- ── Trigger: issued_invoices (protege accrual_date) ──────────────────────────
CREATE OR REPLACE FUNCTION trg_issued_invoices_immutable_fn()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_check date;
BEGIN
    IF TG_OP = 'UPDATE' AND fiscal_period_is_closed(OLD.accrual_date) THEN
        RAISE EXCEPTION 'Trimestre % T% ya presentado — no se puede modificar',
            EXTRACT(YEAR FROM OLD.accrual_date)::integer,
            EXTRACT(QUARTER FROM OLD.accrual_date)::integer;
    END IF;

    v_check := CASE WHEN TG_OP = 'DELETE' THEN OLD.accrual_date ELSE NEW.accrual_date END;

    IF fiscal_period_is_closed(v_check) THEN
        RAISE EXCEPTION 'Trimestre % T% ya presentado — no se puede modificar',
            EXTRACT(YEAR FROM v_check)::integer,
            EXTRACT(QUARTER FROM v_check)::integer;
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER trg_issued_invoices_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON issued_invoices
    FOR EACH ROW EXECUTE FUNCTION trg_issued_invoices_immutable_fn();

-- ── Trigger: supplier_invoice_vat_lines (hereda protección del padre) ─────────
-- El CASCADE de borrado del padre ya está bloqueado; aquí protegemos ediciones
-- directas a las líneas de una factura de trimestre cerrado.
CREATE OR REPLACE FUNCTION trg_supplier_vat_lines_immutable_fn()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_date date;
BEGIN
    -- Para UPDATE, comprobar también la factura origen si cambia invoice_id
    IF TG_OP IN ('DELETE', 'UPDATE') THEN
        SELECT booked_date INTO v_date FROM supplier_invoices WHERE id = OLD.invoice_id;
        IF fiscal_period_is_closed(v_date) THEN
            RAISE EXCEPTION 'Trimestre % T% ya presentado — no se puede modificar',
                EXTRACT(YEAR FROM v_date)::integer,
                EXTRACT(QUARTER FROM v_date)::integer;
        END IF;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT booked_date INTO v_date FROM supplier_invoices WHERE id = NEW.invoice_id;
        IF fiscal_period_is_closed(v_date) THEN
            RAISE EXCEPTION 'Trimestre % T% ya presentado — no se puede modificar',
                EXTRACT(YEAR FROM v_date)::integer,
                EXTRACT(QUARTER FROM v_date)::integer;
        END IF;
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER trg_supplier_vat_lines_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON supplier_invoice_vat_lines
    FOR EACH ROW EXECUTE FUNCTION trg_supplier_vat_lines_immutable_fn();

-- ── Trigger: issued_invoice_vat_lines (hereda protección del padre) ───────────
CREATE OR REPLACE FUNCTION trg_issued_vat_lines_immutable_fn()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_date date;
BEGIN
    IF TG_OP IN ('DELETE', 'UPDATE') THEN
        SELECT accrual_date INTO v_date FROM issued_invoices WHERE id = OLD.invoice_id;
        IF fiscal_period_is_closed(v_date) THEN
            RAISE EXCEPTION 'Trimestre % T% ya presentado — no se puede modificar',
                EXTRACT(YEAR FROM v_date)::integer,
                EXTRACT(QUARTER FROM v_date)::integer;
        END IF;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT accrual_date INTO v_date FROM issued_invoices WHERE id = NEW.invoice_id;
        IF fiscal_period_is_closed(v_date) THEN
            RAISE EXCEPTION 'Trimestre % T% ya presentado — no se puede modificar',
                EXTRACT(YEAR FROM v_date)::integer,
                EXTRACT(QUARTER FROM v_date)::integer;
        END IF;
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER trg_issued_vat_lines_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON issued_invoice_vat_lines
    FOR EACH ROW EXECUTE FUNCTION trg_issued_vat_lines_immutable_fn();

COMMIT;
