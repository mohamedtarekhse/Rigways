-- Add foreign key constraints to link functional_location text fields 
-- in assets, certificates, and jobs tables to functional_locations(fl_id)

-- First, clean up any orphaned functional_location values that don't exist in functional_locations table
UPDATE assets 
SET functional_location = NULL 
WHERE functional_location IS NOT NULL 
  AND functional_location <> ''
  AND NOT EXISTS (
    SELECT 1 FROM functional_locations fl WHERE fl.fl_id = assets.functional_location
  );

UPDATE certificates 
SET functional_location = NULL 
WHERE functional_location IS NOT NULL 
  AND functional_location <> ''
  AND NOT EXISTS (
    SELECT 1 FROM functional_locations fl WHERE fl.fl_id = certificates.functional_location
  );

UPDATE jobs 
SET functional_location = NULL 
WHERE functional_location IS NOT NULL 
  AND functional_location <> ''
  AND NOT EXISTS (
    SELECT 1 FROM functional_locations fl WHERE fl.fl_id = jobs.functional_location
  );

-- Add foreign key constraint to assets.functional_location
ALTER TABLE assets
  ADD CONSTRAINT fk_assets_functional_location
  FOREIGN KEY (functional_location)
  REFERENCES functional_locations(fl_id)
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Add foreign key constraint to certificates.functional_location
ALTER TABLE certificates
  ADD CONSTRAINT fk_certificates_functional_location
  FOREIGN KEY (functional_location)
  REFERENCES functional_locations(fl_id)
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Add foreign key constraint to jobs.functional_location
ALTER TABLE jobs
  ADD CONSTRAINT fk_jobs_functional_location
  FOREIGN KEY (functional_location)
  REFERENCES functional_locations(fl_id)
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Create indexes for better join performance
CREATE INDEX IF NOT EXISTS idx_assets_fk_functional_location 
  ON assets (functional_location) 
  WHERE functional_location IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_certificates_fk_functional_location 
  ON certificates (functional_location) 
  WHERE functional_location IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_fk_functional_location 
  ON jobs (functional_location) 
  WHERE functional_location IS NOT NULL;
