-- Relational seed pack: links clients, functional locations, inspectors, assets, jobs, job_inspectors and certificates
-- Idempotent and safe to re-run in dev/staging environments.

-- 1) Inspectors (global)
INSERT INTO inspectors (name, title, email, phone, status, experience_years, experience_desc)
VALUES
  ('Ahmed Al-Rashidi','Senior Lifting Inspector','ahmed.alrashidi@rigways.local','+966500000101','active',12,'Lifting & CAT inspections'),
  ('Sara Al-Khalil','NDT Specialist','sara.alkhalil@rigways.local','+966500000102','active',9,'NDT and integrity checks'),
  ('Mohamed Hassan','Operations Inspector','mohamed.hassan@rigways.local','+966500000103','active',10,'Field operations and compliance')
ON CONFLICT (email) DO UPDATE SET
  name = EXCLUDED.name,
  title = EXCLUDED.title,
  phone = EXCLUDED.phone,
  status = EXCLUDED.status,
  experience_years = EXCLUDED.experience_years,
  experience_desc = EXCLUDED.experience_desc,
  updated_at = now();

-- 2) Functional locations (client-scoped)
INSERT INTO functional_locations (fl_id, name, type, status, client_id, notes)
VALUES
  ('FL-C001-010','Rig 7','Rig','active','C001','Connected seed location for C001'),
  ('FL-C001-011','Workshop A','Workshop','active','C001','Connected seed workshop for C001'),
  ('FL-C002-010','Rig 12','Rig','active','C002','Connected seed location for C002')
ON CONFLICT (fl_id) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  status = EXCLUDED.status,
  client_id = EXCLUDED.client_id,
  notes = EXCLUDED.notes,
  updated_at = now();

-- 3) Assets tied to clients + functional locations
INSERT INTO assets (
  asset_number, name, asset_type, status, client_id,
  functional_location, serial_number, manufacturer, model, description, notes
)
VALUES
  ('AST-4101','DU Elevator 3-1/2"','Hoisting Equipment','operation','C001','FL-C001-010','SN-C001-4101','NOV','ELV-350','Seeded connected hoisting asset','Relational seed'),
  ('AST-4102','Mud Pump Assembly','Mud System High Pressure','operation','C001','FL-C001-011','SN-C001-4102','Weatherford','MP-88','Seeded mud asset','Relational seed'),
  ('AST-5201','Wireline Unit','Wirelines','stacked','C002','FL-C002-010','SN-C002-5201','SLB','WL-42','Seeded wireline asset','Relational seed')
ON CONFLICT (asset_number) DO UPDATE SET
  name = EXCLUDED.name,
  asset_type = EXCLUDED.asset_type,
  status = EXCLUDED.status,
  client_id = EXCLUDED.client_id,
  functional_location = EXCLUDED.functional_location,
  serial_number = EXCLUDED.serial_number,
  manufacturer = EXCLUDED.manufacturer,
  model = EXCLUDED.model,
  description = EXCLUDED.description,
  notes = EXCLUDED.notes,
  updated_at = now();

-- 4) Jobs tied to clients
INSERT INTO jobs (job_number, client_id, title, status, notes)
VALUES
  ('JOB-2026-4101','C001','Rig 7 annual certification','active','Connected seed job for C001/AST-4101'),
  ('JOB-2026-4102','C001','Workshop maintenance certificates','reopened','Connected seed job for C001/AST-4102'),
  ('JOB-2026-5201','C002','Wireline readiness checks','active','Connected seed job for C002/AST-5201')
ON CONFLICT (job_number) DO UPDATE SET
  client_id = EXCLUDED.client_id,
  title = EXCLUDED.title,
  status = EXCLUDED.status,
  notes = EXCLUDED.notes,
  updated_at = now();

-- 5) Job assignments (jobs <-> inspectors)
INSERT INTO job_inspectors (job_id, inspector_id)
SELECT j.id, i.id
FROM jobs j
JOIN inspectors i ON i.email IN ('ahmed.alrashidi@rigways.local','sara.alkhalil@rigways.local')
WHERE j.job_number IN ('JOB-2026-4101','JOB-2026-4102')
ON CONFLICT (job_id, inspector_id) DO NOTHING;

INSERT INTO job_inspectors (job_id, inspector_id)
SELECT j.id, i.id
FROM jobs j
JOIN inspectors i ON i.email = 'mohamed.hassan@rigways.local'
WHERE j.job_number = 'JOB-2026-5201'
ON CONFLICT (job_id, inspector_id) DO NOTHING;

-- 6) Certificates tied to assets + clients + inspector + job notes
INSERT INTO certificates (
  name, cert_type, asset_id, client_id, inspector_id, issued_by,
  issue_date, expiry_date, approval_status, notes
)
SELECT
  s.name,
  s.cert_type,
  a.id,
  s.client_id,
  i.id,
  i.name,
  s.issue_date,
  s.expiry_date,
  s.approval_status,
  s.job_number
FROM (
  VALUES
    ('DU Elevator CAT III 2026','CAT III','AST-4101','C001','ahmed.alrashidi@rigways.local','2026-01-10'::date,'2027-01-10'::date,'approved','JOB-2026-4101'),
    ('Mud Pump COC 2026','ORIGINAL COC','AST-4102','C001','sara.alkhalil@rigways.local','2026-02-12'::date,'2027-02-12'::date,'pending','JOB-2026-4102'),
    ('Wireline NDT 2026','NDT','AST-5201','C002','mohamed.hassan@rigways.local','2026-03-08'::date,'2026-12-08'::date,'approved','JOB-2026-5201')
) AS s(name, cert_type, asset_number, client_id, inspector_email, issue_date, expiry_date, approval_status, job_number)
JOIN assets a ON a.asset_number = s.asset_number
JOIN inspectors i ON i.email = s.inspector_email
WHERE NOT EXISTS (
  SELECT 1 FROM certificates c
  WHERE c.asset_id = a.id AND c.name = s.name AND c.issue_date = s.issue_date
);

-- 7) Optional certificate_files metadata seed if table exists
DO $$
BEGIN
  IF to_regclass('public.certificate_files') IS NOT NULL THEN
    INSERT INTO certificate_files (
      certificate_id, job_number, cert_type, file_name, file_size, mime_type,
      r2_key, version_no, is_current, status, scan_status, uploaded_by, uploaded_at
    )
    SELECT
      c.id,
      COALESCE(c.notes, 'JOB-UNKNOWN'),
      c.cert_type,
      regexp_replace(lower(c.name), '[^a-z0-9]+', '-', 'g') || '.pdf',
      102400,
      'application/pdf',
      'seed/' || COALESCE(c.notes, 'JOB-UNKNOWN') || '/certificates/' || c.id || '/v1_seed.pdf',
      1,
      true,
      'active',
      'clean',
      NULL,
      now()
    FROM certificates c
    WHERE c.notes IN ('JOB-2026-4101','JOB-2026-4102','JOB-2026-5201')
      AND NOT EXISTS (
        SELECT 1 FROM certificate_files cf
        WHERE cf.certificate_id = c.id AND cf.version_no = 1
      );
  END IF;
END $$;
