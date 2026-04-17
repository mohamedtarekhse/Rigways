-- ============================================================
-- Rigways ACM — Complete Database Schema for MySQL 8.0
-- ============================================================

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id             CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  client_id      VARCHAR(50) NOT NULL UNIQUE,
  name           VARCHAR(255) NOT NULL,
  name_ar        VARCHAR(255),
  industry       VARCHAR(100),
  contact        VARCHAR(255),
  email          VARCHAR(255),
  phone          VARCHAR(50),
  country        VARCHAR(100),
  city           VARCHAR(100),
  status         VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  contract_start DATE,
  contract_end   DATE,
  notes          TEXT,
  color          VARCHAR(20) NOT NULL DEFAULT '#0070f2',
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_clients_status ON clients (status);
CREATE INDEX idx_clients_client_id ON clients (client_id);

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id             CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  username       VARCHAR(100) NOT NULL UNIQUE,
  name           VARCHAR(255) NOT NULL,
  name_ar        VARCHAR(255),
  role           VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user','technician','manager','admin')),
  customer_id    VARCHAR(50),
  password_hash  VARCHAR(255) NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMP NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES clients(client_id) ON DELETE SET NULL
);

CREATE INDEX idx_users_username ON users (username);
CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_users_customer ON users (customer_id);
CREATE INDEX idx_users_is_active ON users (is_active);

-- ============================================================
-- FUNCTIONAL LOCATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS functional_locations (
  id         CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  fl_id      VARCHAR(50) NOT NULL UNIQUE,
  name       VARCHAR(255) NOT NULL,
  type       VARCHAR(50) NOT NULL CHECK (type IN ('Rig','Workshop','Yard','Warehouse','Other')),
  status     VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  client_id  VARCHAR(50),
  notes      TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE SET NULL
);

CREATE INDEX idx_fl_status ON functional_locations (status);
CREATE INDEX idx_fl_client_id ON functional_locations (client_id);

-- ============================================================
-- INSPECTORS
-- ============================================================
CREATE TABLE IF NOT EXISTS inspectors (
  id               CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  inspector_number VARCHAR(50) UNIQUE,
  name             VARCHAR(255) NOT NULL,
  title            VARCHAR(255),
  email            VARCHAR(255) UNIQUE,
  phone            VARCHAR(50),
  status           VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  experience_years INT,
  experience_desc  TEXT,
  cv_file          VARCHAR(255),
  cv_url           VARCHAR(500),
  color            VARCHAR(20) NOT NULL DEFAULT '#0070f2',
  education        JSON NOT NULL DEFAULT (JSON_ARRAY()),
  trainings        JSON NOT NULL DEFAULT (JSON_ARRAY()),
  training_certs   JSON NOT NULL DEFAULT (JSON_ARRAY()),
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_inspectors_status ON inspectors (status);

-- ============================================================
-- ASSETS
-- ============================================================
CREATE TABLE IF NOT EXISTS assets (
  id                   CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  asset_number         VARCHAR(50) NOT NULL UNIQUE,
  name                 VARCHAR(255) NOT NULL,
  asset_type           VARCHAR(100) NOT NULL CHECK (asset_type IN ('Hoisting Equipment','Drilling Equipment','Mud System Low Pressure','Mud System High Pressure','Wirelines','Structure','Well Control','Tubular')),
  status               VARCHAR(20) NOT NULL DEFAULT 'operation' CHECK (status IN ('operation','stacked')),
  client_id            VARCHAR(50),
  functional_location  VARCHAR(255),
  serial_number        VARCHAR(100),
  manufacturer         VARCHAR(255),
  model                VARCHAR(100),
  description          TEXT,
  notes                TEXT,
  created_by           CHAR(36),
  updated_by           CHAR(36),
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_assets_client ON assets (client_id);
CREATE INDEX idx_assets_status ON assets (status);
CREATE INDEX idx_assets_type ON assets (asset_type);
CREATE INDEX idx_assets_created_at ON assets (created_at DESC);

-- ============================================================
-- CERTIFICATES
-- ============================================================
CREATE TABLE IF NOT EXISTS certificates (
  id               CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  cert_number      VARCHAR(50) UNIQUE,
  name             VARCHAR(255) NOT NULL,
  cert_type        VARCHAR(50) NOT NULL CHECK (cert_type IN ('CAT III','CAT IV','ORIGINAL COC','LOAD TEST','LIFTING','NDT','TUBULAR')),
  asset_id         CHAR(36)    NOT NULL,
  client_id        VARCHAR(50),
  inspector_id     CHAR(36),
  issued_by        VARCHAR(255) NOT NULL,
  issue_date       DATE NOT NULL,
  expiry_date      DATE NOT NULL,
  file_name        VARCHAR(255),
  file_url         VARCHAR(500),
  notes            TEXT,
  approval_status  VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  rejection_reason TEXT,
  uploaded_by      CHAR(36),
  reviewed_by      CHAR(36),
  reviewed_at      TIMESTAMP NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE SET NULL,
  FOREIGN KEY (inspector_id) REFERENCES inspectors(id) ON DELETE SET NULL,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_certs_asset ON certificates (asset_id);
CREATE INDEX idx_certs_client ON certificates (client_id);
CREATE INDEX idx_certs_expiry ON certificates (expiry_date);
CREATE INDEX idx_certs_approval ON certificates (approval_status);
CREATE INDEX idx_certs_active_expiry ON certificates (expiry_date, approval_status);

-- ============================================================
-- REQUESTS (maintenance/inspection workflow)
-- ============================================================
CREATE TABLE IF NOT EXISTS requests (
  id            CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  asset_id      CHAR(36)    NOT NULL,
  request_type  VARCHAR(50) NOT NULL CHECK (request_type IN ('maintenance','inspection','certificate_renewal','decommission','other')),
  title         VARCHAR(255) NOT NULL,
  description   TEXT,
  priority      VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status        VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','approved','rejected','completed','cancelled')),
  notes         TEXT,
  created_by    CHAR(36),
  updated_by    CHAR(36),
  resolved_by   CHAR(36),
  resolved_at   TIMESTAMP NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_requests_asset ON requests (asset_id);
CREATE INDEX idx_requests_status ON requests (status);
CREATE INDEX idx_requests_created_by ON requests (created_by);
CREATE INDEX idx_requests_created_at ON requests (created_at DESC);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id         CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  user_id    CHAR(36)    NOT NULL,
  type       VARCHAR(50) NOT NULL,
  title      VARCHAR(255) NOT NULL,
  body       TEXT,
  ref_type   VARCHAR(50),
  ref_id     CHAR(36),
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  read_at    TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_notif_user ON notifications (user_id);
CREATE INDEX idx_notif_unread ON notifications (user_id, is_read);
CREATE INDEX idx_notif_created ON notifications (created_at DESC);

-- ============================================================
-- AUDIT LOGS (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id         CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  user_id    CHAR(36),
  username   VARCHAR(100),
  role       VARCHAR(20),
  table_name VARCHAR(100) NOT NULL,
  record_id  VARCHAR(100) NOT NULL,
  action     VARCHAR(20) NOT NULL CHECK (action IN ('create','update','delete')),
  before     JSON,
  after      JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_table ON audit_logs (table_name, record_id);
CREATE INDEX idx_audit_created_at ON audit_logs (created_at DESC);

-- ============================================================
-- CERTIFICATE HISTORY (for tracking changes)
-- ============================================================
CREATE TABLE IF NOT EXISTS certificate_history (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  certificate_id CHAR(36) NOT NULL,
  action       VARCHAR(20) NOT NULL,
  changed_by   CHAR(36),
  changed_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  old_data     JSON,
  new_data     JSON,
  FOREIGN KEY (certificate_id) REFERENCES certificates(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_cert_hist_cert ON certificate_history (certificate_id);
CREATE INDEX idx_cert_hist_changed_at ON certificate_history (changed_at DESC);

-- ============================================================
-- SEED DATA (clients)
-- ============================================================

INSERT INTO clients (client_id, name, name_ar, industry, contact, email, phone, country, city, status, color, notes) VALUES
  ('C001','Acme Corporation', 'شركة أكمي', 'Oil & Gas', 'James Wheeler', 'j.wheeler@acme.com', '+971 50 112 3456', 'UAE', 'Dubai', 'active', '#0070f2', 'Primary client'),
  ('C002','Gulf Holdings Ltd', 'مجموعة الخليج', 'Construction', 'Fatima Al-Rashid', 'f.rashid@gulf.ae', '+971 55 234 5678', 'UAE', 'Abu Dhabi', 'active', '#188918', 'Large construction group'),
  ('C003','Delta Industries', 'دلتا للصناعات', 'Manufacturing', 'Omar Khalil', 'o.khalil@delta.sa', '+966 11 345 6789', 'KSA', 'Riyadh', 'active', '#e76500', 'New client'),
  ('C004','Nile Ventures', 'مشاريع النيل', 'Real Estate', 'Sara Hassan', 's.hassan@nileventures.eg','+20 10 456 7890', 'EGY', 'Cairo', 'inactive', '#bb0000', 'Contract expired')
ON DUPLICATE KEY UPDATE name=VALUES(name);

INSERT INTO functional_locations (fl_id, name, type, status, notes) VALUES
  ('FL-001','Rig 7', 'Rig', 'active', 'Offshore drilling rig'),
  ('FL-002','Rig 12', 'Rig', 'active', 'Land rig'),
  ('FL-003','Workshop A', 'Workshop', 'active', 'Main maintenance workshop'),
  ('FL-004','Workshop B', 'Workshop', 'active', 'Heavy equipment workshop'),
  ('FL-005','Yard 1', 'Yard', 'active', 'Equipment storage yard'),
  ('FL-006','Warehouse C', 'Warehouse', 'active', 'Spare parts warehouse')
ON DUPLICATE KEY UPDATE name=VALUES(name);
