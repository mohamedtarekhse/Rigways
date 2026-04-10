-- Add related standard field for tubular certificates
ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS related_standard TEXT;

ALTER TABLE certificate_history
  ADD COLUMN IF NOT EXISTS related_standard TEXT;
