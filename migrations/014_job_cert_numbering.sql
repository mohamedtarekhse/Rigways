-- Migration 014: Job number auto-generation and certificate numbering linked to jobs
-- Format: job_number = YYYY-NNN (e.g., 2026-001, 2026-002)
--         cert_number = YYYY-NNN/NNN (e.g., 2026-001/001, 2026-001/002)

-- ============================================================
-- JOB NUMBER AUTO-GENERATION
-- ============================================================

-- Add trigger function to auto-generate job_number in format YYYY-NNN
CREATE OR REPLACE FUNCTION set_job_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE 
  next_num INT;
  current_year TEXT;
BEGIN
  IF NEW.job_number IS NULL OR NEW.job_number = '' THEN
    current_year := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
    
    -- Get the next sequence number for this year
    SELECT COALESCE(MAX(CAST(SPLIT_PART(job_number, '-', 2) AS INTEGER)), 0) + 1
      INTO next_num 
      FROM jobs 
      WHERE job_number ~ ('^' || current_year || '-\\d+$');
    
    -- If no jobs exist for this year, start from 1
    IF next_num IS NULL OR next_num <= 0 THEN
      next_num := 1;
    END IF;
    
    NEW.job_number := current_year || '-' || LPAD(next_num::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;$$;

-- Create trigger for job_number auto-generation
DROP TRIGGER IF EXISTS trg_job_number ON jobs;
CREATE TRIGGER trg_job_number
  BEFORE INSERT ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_job_number();

-- ============================================================
-- CERTIFICATE NUMBER LINKED TO JOB
-- ============================================================

-- Add job_id column to certificates if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'certificates' AND column_name = 'job_id'
  ) THEN
    ALTER TABLE certificates ADD COLUMN job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_certs_job ON certificates (job_id) WHERE job_id IS NOT NULL;
  END IF;
END $$;

-- Replace the cert_number generation function to use job-based format
-- Format: YYYY-NNN/NNN where YYYY-NNN is the job_number and NNN is the cert sequence within that job
CREATE OR REPLACE FUNCTION set_cert_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE 
  next_num INT;
  job_num TEXT;
  job_year TEXT;
  job_seq TEXT;
BEGIN
  IF NEW.cert_number IS NULL OR NEW.cert_number = '' THEN
    -- If job_id is provided, get the job_number
    IF NEW.job_id IS NOT NULL THEN
      SELECT job_number INTO job_num FROM jobs WHERE id = NEW.job_id;
      
      IF job_num IS NOT NULL THEN
        -- Parse job_number to get year and sequence (e.g., 2026-001)
        job_year := SPLIT_PART(job_num, '-', 1);
        job_seq := SPLIT_PART(job_num, '-', 2);
        
        -- Get the next certificate sequence for this job
        SELECT COALESCE(
          MAX(CAST(SPLIT_PART(cert_number, '/', 2) AS INTEGER)), 0
        ) + 1
          INTO next_num
          FROM certificates
          WHERE job_id = NEW.job_id
            AND cert_number ~ ('^' || job_num || '/\\d+$');
        
        IF next_num IS NULL OR next_num <= 0 THEN
          next_num := 1;
        END IF;
        
        -- Generate cert_number as YYYY-NNN/NNN
        NEW.cert_number := job_num || '/' || LPAD(next_num::TEXT, 3, '0');
      END IF;
    END IF;
    
    -- Fallback: if no job_id or job_number not found, generate standalone cert number
    -- This maintains backward compatibility for certs not linked to jobs
    IF NEW.cert_number IS NULL OR NEW.cert_number = '' THEN
      SELECT COALESCE(MAX(CAST(REPLACE(cert_number, 'CERT-', '') AS INTEGER)), 0) + 1
        INTO next_num 
        FROM certificates 
        WHERE cert_number ~ '^CERT-\\d+$';
      NEW.cert_number := 'CERT-' || LPAD(next_num::TEXT, 4, '0');
    END IF;
  END IF;
  RETURN NEW;
END;$$;

-- Note: The trigger trg_cert_number already exists in 001_schema.sql
-- This replaces only the function, the trigger will use the new logic automatically

COMMENT ON COLUMN certificates.job_id IS 'Reference to job for certificate numbering (format: YYYY-NNN/NNN)';
