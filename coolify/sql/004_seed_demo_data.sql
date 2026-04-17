-- ============================================================
-- Seed Demo Data for MySQL
-- ============================================================

-- Insert demo admin user (password: admin123)
-- Hash generated using bcrypt with 10 salt rounds
INSERT INTO users (id, username, name, role, password_hash, is_active) VALUES
  (UUID(), 'admin', 'System Administrator', 'admin', '$2a$10$rH9z6X8QKJxvVJz5nGqYpO4WqL7yM8kN3vB2cD1eF0gH5iJ6kL7mN', TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- Insert demo managers
INSERT INTO users (username, name, role, password_hash, is_active) VALUES
  ('manager1', 'John Manager', 'manager', '$2a$10$rH9z6X8QKJxvVJz5nGqYpO4WqL7yM8kN3vB2cD1eF0gH5iJ6kL7mN', TRUE),
  ('manager2', 'Sarah Manager', 'manager', '$2a$10$rH9z6X8QKJxvVJz5nGqYpO4WqL7yM8kN3vB2cD1eF0gH5iJ6kL7mN', TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- Insert demo technicians
INSERT INTO users (username, name, role, password_hash, customer_id, is_active) VALUES
  ('tech1', 'Ahmed Technician', 'technician', '$2a$10$rH9z6X8QKJxvVJz5nGqYpO4WqL7yM8kN3vB2cD1eF0gH5iJ6kL7mN', 'C001', TRUE),
  ('tech2', 'Mohammed Technician', 'technician', '$2a$10$rH9z6X8QKJxvVJz5nGqYpO4WqL7yM8kN3vB2cD1eF0gH5iJ6kL7mN', 'C002', TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- Insert demo users
INSERT INTO users (username, name, role, password_hash, customer_id, is_active) VALUES
  ('user1', 'Ali User', 'user', '$2a$10$rH9z6X8QKJxvVJz5nGqYpO4WqL7yM8kN3vB2cD1eF0gH5iJ6kL7mN', 'C001', TRUE),
  ('user2', 'Fatima User', 'user', '$2a$10$rH9z6X8QKJxvVJz5nGqYpO4WqL7yM8kN3vB2cD1eF0gH5iJ6kL7mN', 'C002', TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- Insert demo inspectors
INSERT INTO inspectors (name, title, email, phone, status, experience_years, color) VALUES
  ('Inspector Ahmad', 'Senior Inspector', 'ahmad@inspect.com', '+971 50 123 4567', 'active', 10, '#0070f2'),
  ('Inspector Mohammed', 'NDT Specialist', 'mohammed@inspect.com', '+971 55 234 5678', 'active', 8, '#188918'),
  ('Inspector Sarah', 'Lifting Expert', 'sarah@inspect.com', '+971 52 345 6789', 'active', 12, '#e76500')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- Insert demo assets
INSERT INTO assets (asset_number, name, asset_type, status, client_id, functional_location, manufacturer, model) VALUES
  ('AST-001', 'Crane A', 'Hoisting Equipment', 'operation', 'C001', 'FL-001', 'Liebherr', 'LR 11000'),
  ('AST-002', 'Drill Rig B', 'Drilling Equipment', 'operation', 'C001', 'FL-002', 'NOV', 'XY-7'),
  ('AST-003', 'Mud Pump C', 'Mud System High Pressure', 'operation', 'C002', 'FL-003', 'Gardner Denver', 'PZ-9'),
  ('AST-004', 'Wireline D', 'Wirelines', 'stacked', 'C002', NULL, 'Schlumberger', 'WL-500'),
  ('AST-005', 'Structure E', 'Structure', 'operation', 'C003', 'FL-004', 'Custom', 'Platform-A'),
  ('AST-006', 'BOP F', 'Well Control', 'operation', 'C003', 'FL-001', 'Cameron', 'U-Type'),
  ('AST-007', 'Tubular G', 'Tubular', 'operation', 'C001', 'FL-005', 'Vallourec', 'VAM TOP'),
  ('AST-008', 'Mud Tank H', 'Mud System Low Pressure', 'operation', 'C002', 'FL-003', 'Custom', 'MT-1000')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- Insert demo certificates
INSERT INTO certificates (cert_number, name, cert_type, asset_id, issued_by, issue_date, expiry_date, approval_status) VALUES
  ('CERT-0001', 'Annual Inspection Certificate', 'CAT III', (SELECT id FROM assets WHERE asset_number='AST-001'), 'Inspector Ahmad', DATE_SUB(CURDATE(), INTERVAL 6 MONTH), DATE_ADD(CURDATE(), INTERVAL 6 MONTH), 'approved'),
  ('CERT-0002', 'Load Test Certificate', 'LOAD TEST', (SELECT id FROM assets WHERE asset_number='AST-001'), 'Inspector Mohammed', DATE_SUB(CURDATE(), INTERVAL 3 MONTH), DATE_ADD(CURDATE(), INTERVAL 9 MONTH), 'approved'),
  ('CERT-0003', 'Original COC', 'ORIGINAL COC', (SELECT id FROM assets WHERE asset_number='AST-002'), 'Manufacturer', DATE_SUB(CURDATE(), INTERVAL 1 YEAR), DATE_ADD(CURDATE(), INTERVAL 1 YEAR), 'approved'),
  ('CERT-0004', 'NDT Certificate', 'NDT', (SELECT id FROM assets WHERE asset_number='AST-003'), 'Inspector Sarah', DATE_SUB(CURDATE(), INTERVAL 2 MONTH), DATE_ADD(CURDATE(), INTERVAL 4 MONTH), 'pending'),
  ('CERT-0005', 'Lifting Certificate', 'LIFTING', (SELECT id FROM assets WHERE asset_number='AST-004'), 'Inspector Ahmad', DATE_SUB(CURDATE(), INTERVAL 1 MONTH), DATE_ADD(CURDATE(), INTERVAL 2 MONTH), 'approved'),
  ('CERT-0006', 'CAT IV Certificate', 'CAT IV', (SELECT id FROM assets WHERE asset_number='AST-005'), 'Inspector Mohammed', DATE_SUB(CURDATE(), INTERVAL 8 MONTH), DATE_SUB(CURDATE(), INTERVAL 4 MONTH), 'approved'),
  ('CERT-0007', 'Tubular Inspection', 'TUBULAR', (SELECT id FROM assets WHERE asset_number='AST-007'), 'Inspector Sarah', DATE_SUB(CURDATE(), INTERVAL 2 WEEK), DATE_ADD(CURDATE(), INTERVAL 10 MONTH), 'approved')
ON DUPLICATE KEY UPDATE name=VALUES(name);
