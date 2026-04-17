-- ============================================================
-- Backfill functional_locations.client_id from assets
-- ============================================================

UPDATE functional_locations fl
LEFT JOIN (
  SELECT DISTINCT functional_location, client_id 
  FROM assets 
  WHERE functional_location IS NOT NULL AND client_id IS NOT NULL
) a ON fl.fl_id = a.functional_location
SET fl.client_id = a.client_id
WHERE fl.client_id IS NULL AND a.client_id IS NOT NULL;
