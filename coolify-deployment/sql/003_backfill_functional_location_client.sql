-- Backfill functional_locations.client_id from related assets where mapping is unambiguous
WITH by_fl AS (
  SELECT
    a.functional_location AS fl_id,
    MIN(a.client_id) AS client_id,
    COUNT(DISTINCT a.client_id) AS client_count
  FROM assets a
  WHERE a.functional_location IS NOT NULL
    AND a.functional_location <> ''
    AND a.client_id IS NOT NULL
    AND a.client_id <> ''
  GROUP BY a.functional_location
)
UPDATE functional_locations fl
SET client_id = b.client_id,
    updated_at = now()
FROM by_fl b
WHERE fl.fl_id = b.fl_id
  AND (fl.client_id IS NULL OR fl.client_id = '')
  AND b.client_count = 1;
