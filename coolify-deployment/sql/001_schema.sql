-- ============================================================
-- Rigways ACM — Complete Database Schema
-- Run this in Supabase SQL Editor (Project > SQL Editor > New query)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      TEXT        NOT NULL UNIQUE,   -- e.g. C001
  name           TEXT        NOT NULL,
  name_ar        TEXT,
  industry       TEXT,
  contact        TEXT,
  email          TEXT,
  phone          TEXT,
  country        TEXT,
  city           TEXT,
  status         TEXT        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','inactive','suspended')),
  contract_start DATE,
  contract_end   DATE,
  notes          TEXT,
  color          TEXT        NOT NULL DEFAULT '#0070f2',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_status    ON clients (status);
CREATE INDEX idx_clients_client_id ON clients (client_id);

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username       TEXT        NOT NULL UNIQUE,
  name           TEXT        NOT NULL,
  name_ar        TEXT,
  role           TEXT        NOT NULL DEFAULT 'user'
                             CHECK (role IN ('user','technician','manager','admin')),
  customer_id    TEXT        REFERENCES clients(client_id) ON DELETE SET NULL,
  password_hash  TEXT        NOT NULL,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_username   ON users (username);
CREATE INDEX idx_users_role       ON users (role);
CREATE INDEX idx_users_customer   ON users (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_users_is_active  ON users (is_active);

-- ============================================================
-- FUNCTIONAL LOCATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS functional_locations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  fl_id      TEXT        NOT NULL UNIQUE,   -- e.g. FL-001
  name       TEXT        NOT NULL,
  type       TEXT        NOT NULL
             CHECK (type IN ('Rig','Workshop','Yard','Warehouse','Other')),
  status     TEXT        NOT NULL DEFAULT 'active'
             CHECK (status IN ('active','inactive')),
  client_id  TEXT        REFERENCES clients(client_id) ON DELETE SET NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fl_status    ON functional_locations (status);
CREATE INDEX idx_fl_client_id ON functional_locations (client_id) WHERE client_id IS NOT NULL;

-- ============================================================
-- INSPECTORS
-- ============================================================
CREATE TABLE IF NOT EXISTS inspectors (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_number TEXT        UNIQUE,           -- e.g. INS-001
  name             TEXT        NOT NULL,
  title            TEXT,
  email            TEXT        UNIQUE,
  phone            TEXT,
  status           TEXT        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active','inactive')),
  experience_years INTEGER,
  experience_desc  TEXT,
  cv_file          TEXT,
  cv_url           TEXT,
  color            TEXT        NOT NULL DEFAULT '#0070f2',
  education        JSONB       NOT NULL DEFAULT '[]',
  trainings        JSONB       NOT NULL DEFAULT '[]',
  training_certs   JSONB       NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspectors_status ON inspectors (status);

-- Auto-generate inspector_number on insert
CREATE OR REPLACE FUNCTION set_inspector_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE next_num INT;
BEGIN
  IF NEW.inspector_number IS NULL OR NEW.inspector_number = '' THEN
    SELECT COALESCE(MAX(CAST(REPLACE(inspector_number,'INS-','') AS INTEGER)),0)+1
      INTO next_num FROM inspectors WHERE inspector_number ~ '^INS-\d+$';
    NEW.inspector_number := 'INS-' || LPAD(next_num::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_inspector_number
  BEFORE INSERT ON inspectors
  FOR EACH ROW EXECUTE FUNCTION set_inspector_number();

-- ============================================================
-- ASSETS
-- ============================================================
CREATE TABLE IF NOT EXISTS assets (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_number         TEXT        NOT NULL UNIQUE,   -- e.g. AST-001
  name                 TEXT        NOT NULL,
  asset_type           TEXT        NOT NULL
                                   CHECK (asset_type IN ('Hoisting Equipment','Drilling Equipment','Mud System Low Pressure','Mud System High Pressure','Wirelines','Structure','Well Control','Tubular')),
  status               TEXT        NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('operation','stacked')),
  client_id            TEXT        REFERENCES clients(client_id) ON DELETE SET NULL,
  functional_location  TEXT,
  serial_number        TEXT,
  manufacturer         TEXT,
  model                TEXT,
  description          TEXT,
  notes                TEXT,
  created_by           UUID        REFERENCES users(id) ON DELETE SET NULL,
  updated_by           UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assets_client     ON assets (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_assets_status     ON assets (status);
CREATE INDEX idx_assets_type       ON assets (asset_type);
CREATE INDEX idx_assets_created_at ON assets (created_at DESC);

-- ============================================================
-- CERTIFICATES
-- ============================================================
CREATE TABLE IF NOT EXISTS certificates (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cert_number      TEXT        UNIQUE,             -- auto-generated CERT-0001
  name             TEXT        NOT NULL,
  cert_type        TEXT        NOT NULL
                               CHECK (cert_type IN ('CAT III','CAT IV','ORIGINAL COC','LOAD TEST','LIFTING','NDT','TUBULAR')),
  asset_id         UUID        NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  client_id        TEXT        REFERENCES clients(client_id) ON DELETE SET NULL,
  inspector_id     UUID        REFERENCES inspectors(id) ON DELETE SET NULL,
  issued_by        TEXT        NOT NULL,
  issue_date       DATE        NOT NULL,
  expiry_date      DATE        NOT NULL,
  file_name        TEXT,
  file_url         TEXT,
  notes            TEXT,
  approval_status  TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (approval_status IN ('pending','approved','rejected')),
  rejection_reason TEXT,
  uploaded_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_certs_asset         ON certificates (asset_id);
CREATE INDEX idx_certs_client        ON certificates (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_certs_expiry        ON certificates (expiry_date);
CREATE INDEX idx_certs_approval      ON certificates (approval_status);
CREATE INDEX idx_certs_active_expiry ON certificates (expiry_date) WHERE approval_status = 'approved';

-- Auto-generate cert_number
CREATE OR REPLACE FUNCTION set_cert_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE next_num INT;
BEGIN
  IF NEW.cert_number IS NULL OR NEW.cert_number = '' THEN
    SELECT COALESCE(MAX(CAST(REPLACE(cert_number,'CERT-','') AS INTEGER)),0)+1
      INTO next_num FROM certificates WHERE cert_number ~ '^CERT-\d+$';
    NEW.cert_number := 'CERT-' || LPAD(next_num::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_cert_number
  BEFORE INSERT ON certificates
  FOR EACH ROW EXECUTE FUNCTION set_cert_number();

-- ============================================================
-- REQUESTS (maintenance/inspection workflow)
-- ============================================================
CREATE TABLE IF NOT EXISTS requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      UUID        NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  request_type  TEXT        NOT NULL
                            CHECK (request_type IN ('maintenance','inspection','certificate_renewal','decommission','other')),
  title         TEXT        NOT NULL,
  description   TEXT,
  priority      TEXT        NOT NULL DEFAULT 'medium'
                            CHECK (priority IN ('low','medium','high','critical')),
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','in_progress','approved','rejected','completed','cancelled')),
  notes         TEXT,
  created_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  updated_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  resolved_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_requests_asset      ON requests (asset_id);
CREATE INDEX idx_requests_status     ON requests (status);
CREATE INDEX idx_requests_created_by ON requests (created_by);
CREATE INDEX idx_requests_created_at ON requests (created_at DESC);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL,
  title      TEXT        NOT NULL,
  body       TEXT,
  ref_type   TEXT,    -- 'asset' | 'certificate' | 'request'
  ref_id     UUID,
  is_read    BOOLEAN     NOT NULL DEFAULT false,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notif_user    ON notifications (user_id);
CREATE INDEX idx_notif_unread  ON notifications (user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notif_created ON notifications (created_at DESC);

-- ============================================================
-- AUDIT LOGS (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  username   TEXT,
  role       TEXT,
  table_name TEXT        NOT NULL,
  record_id  TEXT        NOT NULL,
  action     TEXT        NOT NULL CHECK (action IN ('create','update','delete')),
  before     JSONB,
  after      JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_table      ON audit_logs (table_name, record_id);
CREATE INDEX idx_audit_created_at ON audit_logs (created_at DESC);

-- ============================================================
-- updated_at trigger (applies to all mutable tables)
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;$$;

CREATE TRIGGER trg_clients_updated_at        BEFORE UPDATE ON clients              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated_at          BEFORE UPDATE ON users                FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_fl_updated_at             BEFORE UPDATE ON functional_locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_inspectors_updated_at     BEFORE UPDATE ON inspectors           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_assets_updated_at         BEFORE UPDATE ON assets               FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_certs_updated_at          BEFORE UPDATE ON certificates         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_requests_updated_at       BEFORE UPDATE ON requests             FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Disable RLS — Worker uses service-role key, enforces auth in code
-- ============================================================
ALTER TABLE clients              DISABLE ROW LEVEL SECURITY;
ALTER TABLE users                DISABLE ROW LEVEL SECURITY;
ALTER TABLE functional_locations DISABLE ROW LEVEL SECURITY;
ALTER TABLE inspectors           DISABLE ROW LEVEL SECURITY;
ALTER TABLE assets               DISABLE ROW LEVEL SECURITY;
ALTER TABLE certificates         DISABLE ROW LEVEL SECURITY;
ALTER TABLE requests             DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- SEED DATA (clients + one admin user — password: admin123)
-- IMPORTANT: Replace the password_hash below after running the
-- app once — use POST /api/auth/hash to generate a real PBKDF2 hash.
-- The placeholder below is a bcrypt-style marker only.
-- ============================================================

INSERT INTO clients (client_id, name, name_ar, industry, contact, email, phone, country, city, status, color, notes) VALUES
  ('C001','Acme Corporation',  'شركة أكمي',        'Oil & Gas',     'James Wheeler',    'j.wheeler@acme.com',      '+971 50 112 3456', 'UAE', 'Dubai',     'active',   '#0070f2', 'Primary client'),
  ('C002','Gulf Holdings Ltd', 'مجموعة الخليج',    'Construction',  'Fatima Al-Rashid', 'f.rashid@gulf.ae',        '+971 55 234 5678', 'UAE', 'Abu Dhabi', 'active',   '#188918', 'Large construction group'),
  ('C003','Delta Industries',  'دلتا للصناعات',    'Manufacturing', 'Omar Khalil',      'o.khalil@delta.sa',       '+966 11 345 6789', 'KSA', 'Riyadh',   'active',   '#e76500', 'New client'),
  ('C004','Nile Ventures',     'مشاريع النيل',     'Real Estate',   'Sara Hassan',      's.hassan@nileventures.eg','+20 10 456 7890',  'EGY', 'Cairo',    'inactive', '#bb0000', 'Contract expired')
ON CONFLICT (client_id) DO NOTHING;

INSERT INTO functional_locations (fl_id, name, type, status, notes) VALUES
  ('FL-001','Rig 7',       'Rig',       'active', 'Offshore drilling rig'),
  ('FL-002','Rig 12',      'Rig',       'active', 'Land rig'),
  ('FL-003','Workshop A',  'Workshop',  'active', 'Main maintenance workshop'),
  ('FL-004','Workshop B',  'Workshop',  'active', 'Heavy equipment workshop'),
  ('FL-005','Yard 1',      'Yard',      'active', 'Equipment storage yard'),
  ('FL-006','Warehouse C', 'Warehouse', 'active', 'Spare parts warehouse')
ON CONFLICT (fl_id) DO NOTHING;

-- NOTE: Run the seed-users script from the README to create users with proper PBKDF2 hashes.
-- Do NOT manually insert password hashes here — they are salted and must be generated by the app.
