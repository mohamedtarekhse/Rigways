-- Add functional location snapshot to certificates.
-- Stored as FL business key text (e.g. FL-001), sourced from the linked asset.
ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS functional_location TEXT;

-- Backfill from linked asset when available.
UPDATE certificates c
SET functional_location = a.functional_location
FROM assets a
WHERE c.asset_id = a.id
  AND c.functional_location IS NULL
  AND a.functional_location IS NOT NULL
  AND a.functional_location <> '';

CREATE INDEX IF NOT EXISTS idx_certs_functional_location
  ON certificates (functional_location)
  WHERE functional_location IS NOT NULL;
