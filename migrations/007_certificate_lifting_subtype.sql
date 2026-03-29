-- Add dedicated lifting_subtype to avoid overloading cert_type enum values
ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS lifting_subtype TEXT;

ALTER TABLE certificate_history
  ADD COLUMN IF NOT EXISTS lifting_subtype TEXT;

