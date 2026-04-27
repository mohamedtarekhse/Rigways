-- Add optional functional location assignment on users for admin user management.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS functional_location TEXT REFERENCES functional_locations(fl_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_functional_location
  ON users (functional_location)
  WHERE functional_location IS NOT NULL;
