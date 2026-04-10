-- Add functional location to jobs
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS functional_location TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_functional_location ON jobs (functional_location);
