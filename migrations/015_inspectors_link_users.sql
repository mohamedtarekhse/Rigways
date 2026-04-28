-- Link inspectors to app users and backfill technician accounts.

ALTER TABLE inspectors
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inspectors_user_id_unique
  ON inspectors (user_id)
  WHERE user_id IS NOT NULL;

WITH base AS (
  SELECT
    i.id AS inspector_id,
    i.name,
    i.email,
    i.status,
    i.inspector_number,
    CASE
      WHEN COALESCE(trim(i.email), '') <> '' THEN lower(trim(i.email))
      WHEN COALESCE(trim(split_part(i.name, ' ', 1)), '') <> ''
        THEN regexp_replace(lower(trim(split_part(i.name, ' ', 1))), '[^a-z0-9._-]', '', 'g')
      ELSE regexp_replace(lower(COALESCE(i.inspector_number, 'inspector')), '[^a-z0-9._-]', '', 'g')
    END AS username_base
  FROM inspectors i
  WHERE i.user_id IS NULL
), matched AS (
  SELECT
    b.inspector_id,
    COALESCE(
      u_email.id,
      u_name.id
    ) AS user_id
  FROM base b
  LEFT JOIN users u_email ON b.email IS NOT NULL AND lower(u_email.username) = lower(trim(b.email))
  LEFT JOIN users u_name ON (b.email IS NULL OR trim(b.email) = '')
    AND lower(u_name.username) = lower(regexp_replace(trim(split_part(b.name, ' ', 1)), '[^a-zA-Z0-9._-]', '', 'g'))
), to_create AS (
  SELECT
    b.inspector_id,
    b.name,
    b.status,
    CASE
      WHEN COALESCE(b.username_base, '') = '' THEN 'inspector_' || substr(replace(b.inspector_id::text, '-', ''), 1, 6)
      WHEN EXISTS (SELECT 1 FROM users u WHERE lower(u.username) = lower(b.username_base))
        THEN b.username_base || '_' || substr(replace(b.inspector_id::text, '-', ''), 1, 6)
      ELSE b.username_base
    END AS username
  FROM base b
  LEFT JOIN matched m ON m.inspector_id = b.inspector_id
  WHERE m.user_id IS NULL
), created AS (
  INSERT INTO users (username, name, role, password_hash, is_active)
  SELECT
    tc.username,
    tc.name,
    'technician',
    'pbkdf2:100000:QHbhaeWkVHfW3gEZNg4-cg:pTDc-QZmetUUX-qI5N89MfM_R7o3KQUEndUw8DChcik',
    tc.status = 'active'
  FROM to_create tc
  ON CONFLICT (username) DO NOTHING
  RETURNING id, username
), final_map AS (
  SELECT m.inspector_id, m.user_id
  FROM matched m
  WHERE m.user_id IS NOT NULL
  UNION ALL
  SELECT tc.inspector_id, u.id AS user_id
  FROM to_create tc
  JOIN users u ON lower(u.username) = lower(tc.username)
)
UPDATE inspectors i
SET user_id = fm.user_id,
    updated_at = now()
FROM final_map fm
WHERE i.id = fm.inspector_id
  AND i.user_id IS NULL;
