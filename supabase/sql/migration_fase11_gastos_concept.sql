-- Añade campo concept a supplier_documents (nombre corto del gasto / documento)
ALTER TABLE supplier_documents ADD COLUMN IF NOT EXISTS concept text;
