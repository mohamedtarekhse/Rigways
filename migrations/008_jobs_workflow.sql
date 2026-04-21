-- Jobs workflow core tables

CREATE TABLE IF NOT EXISTS jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number   TEXT NOT NULL UNIQUE,
  client_id    TEXT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  functional_location TEXT,
  title        TEXT,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'technician_done', 'closed', 'reopened')),
  notes        TEXT,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  finished_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  finished_at  TIMESTAMPTZ,
  closed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_at    TIMESTAMPTZ,
  reopened_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  reopened_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_client  ON jobs (client_id);
CREATE INDEX IF NOT EXISTS idx_jobs_functional_location ON jobs (functional_location);
CREATE INDEX IF NOT EXISTS idx_jobs_status  ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at DESC);

CREATE TABLE IF NOT EXISTS job_inspectors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  inspector_id UUID NOT NULL REFERENCES inspectors(id) ON DELETE CASCADE,
  assigned_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_id, inspector_id)
);

CREATE INDEX IF NOT EXISTS idx_job_inspectors_job ON job_inspectors (job_id);
CREATE INDEX IF NOT EXISTS idx_job_inspectors_inspector ON job_inspectors (inspector_id);

CREATE TABLE IF NOT EXISTS job_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events (job_id, created_at DESC);
