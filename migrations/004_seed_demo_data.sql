-- Demo seed data for local/dev environments
-- Safe to run multiple times (uses ON CONFLICT / NOT EXISTS guards)

-- Ensure functional locations are client-scoped
INSERT INTO functional_locations (fl_id, name, type, status, client_id, notes)
VALUES
  ('FL-C001-001','Rig 7',      'Rig',      'active','C001','Primary rig for client C001'),
  ('FL-C001-002','Workshop A', 'Workshop', 'active','C001','Main maintenance workshop for C001'),
  ('FL-C002-001','Rig 12',     'Rig',      'active','C002','Primary rig for client C002'),
  ('FL-C003-001','Yard 1',     'Yard',     'active','C003','Storage yard for client C003')
ON CONFLICT (fl_id)
DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  status = EXCLUDED.status,
  client_id = EXCLUDED.client_id,
  notes = EXCLUDED.notes,
  updated_at = now();

-- Demo assets (asset_number is globally unique)
INSERT INTO assets (
  asset_number, name, asset_type, status, client_id,
  functional_location, serial_number, manufacturer, model, description, notes
)
VALUES
  ('AST-1001','BOP Stack CAT III','Well Control','operation','C001','FL-C001-001','SN-C001-1001','NOV','BOP-X3','Client C001 BOP stack','Seeded demo asset'),
  ('AST-1002','Mud Gas Separator','Mud System Low Pressure','operation','C001','FL-C001-002','SN-C001-1002','MI-SWACO','MGS-2','Client C001 mud gas separator','Seeded demo asset'),
  ('AST-2001','Drill Collar NDT Unit','Drilling Equipment','stacked','C002','FL-C002-001','SN-C002-2001','Halliburton','DC-NDT','Client C002 drill collar unit','Seeded demo asset'),
  ('AST-3001','Wireline Unit CAT IV','Wirelines','operation','C003','FL-C003-001','SN-C003-3001','Schlumberger','WL-IV','Client C003 wireline unit','Seeded demo asset')
ON CONFLICT (asset_number) DO NOTHING;

-- Demo certificates linked to demo assets
INSERT INTO certificates (
  name, cert_type, asset_id, client_id, issued_by,
  issue_date, expiry_date, approval_status, notes
)
SELECT
  s.name,
  s.cert_type,
  a.id,
  s.client_id,
  s.issued_by,
  s.issue_date,
  s.expiry_date,
  s.approval_status,
  s.notes
FROM (
  VALUES
    ('BOP Pressure Test 2026','CAT III','AST-1001','C001','Mohamed Hassan','2026-01-15'::date,'2027-01-15'::date,'approved','JOB-2026-001'),
    ('Mud Gas Separator Inspection','ORIGINAL COC','AST-1002','C001','Sara Al-Khalil','2026-02-10'::date,'2027-02-10'::date,'approved','JOB-2026-002'),
    ('Drill Collar NDT Report','NDT','AST-2001','C002','Ahmed Al-Rashidi','2026-01-20'::date,'2026-12-20'::date,'pending','JOB-2026-003'),
    ('Wireline Safety Certificate','CAT IV','AST-3001','C003','Layla Bin Rashid','2026-03-01'::date,'2027-03-01'::date,'approved','JOB-2026-004')
) AS s(name, cert_type, asset_number, client_id, issued_by, issue_date, expiry_date, approval_status, notes)
JOIN assets a ON a.asset_number = s.asset_number
WHERE NOT EXISTS (
  SELECT 1 FROM certificates c
  WHERE c.asset_id = a.id
    AND c.name = s.name
    AND c.issue_date = s.issue_date
);
