-- Certificate audit/snapshot history used for export in Certificates Edit modal
CREATE TABLE IF NOT EXISTS certificate_history (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id   UUID        REFERENCES certificates(id) ON DELETE SET NULL,
  cert_number      TEXT,
  name             TEXT,
  cert_type        TEXT,
  asset_id         UUID,
  client_id        TEXT,
  issued_by        TEXT,
  issue_date       DATE,
  expiry_date      DATE,
  approval_status  TEXT,
  file_name        TEXT,
  file_url         TEXT,
  action_type      TEXT        NOT NULL,
  changed_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot_json    JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cert_history_certificate ON certificate_history (certificate_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cert_history_client      ON certificate_history (client_id);
CREATE INDEX IF NOT EXISTS idx_cert_history_changed_by  ON certificate_history (changed_by);
