-- ============================================================
-- Certificate History Trigger for MySQL
-- ============================================================

DELIMITER $$

CREATE TRIGGER IF NOT EXISTS trg_certificates_after_insert
AFTER INSERT ON certificates
FOR EACH ROW
BEGIN
  INSERT INTO certificate_history (certificate_id, action, changed_by, old_data, new_data)
  VALUES (NEW.id, 'insert', NEW.uploaded_by, NULL, JSON_OBJECT(
    'id', NEW.id,
    'cert_number', NEW.cert_number,
    'name', NEW.name,
    'cert_type', NEW.cert_type,
    'asset_id', NEW.asset_id,
    'client_id', NEW.client_id,
    'inspector_id', NEW.inspector_id,
    'issued_by', NEW.issued_by,
    'issue_date', NEW.issue_date,
    'expiry_date', NEW.expiry_date,
    'approval_status', NEW.approval_status
  ));
END$$

CREATE TRIGGER IF NOT EXISTS trg_certificates_after_update
AFTER UPDATE ON certificates
FOR EACH ROW
BEGIN
  INSERT INTO certificate_history (certificate_id, action, changed_by, old_data, new_data)
  VALUES (NEW.id, 'update', NEW.uploaded_by, JSON_OBJECT(
    'id', OLD.id,
    'cert_number', OLD.cert_number,
    'name', OLD.name,
    'cert_type', OLD.cert_type,
    'asset_id', OLD.asset_id,
    'client_id', OLD.client_id,
    'inspector_id', OLD.inspector_id,
    'issued_by', OLD.issued_by,
    'issue_date', OLD.issue_date,
    'expiry_date', OLD.expiry_date,
    'approval_status', OLD.approval_status
  ), JSON_OBJECT(
    'id', NEW.id,
    'cert_number', NEW.cert_number,
    'name', NEW.name,
    'cert_type', NEW.cert_type,
    'asset_id', NEW.asset_id,
    'client_id', NEW.client_id,
    'inspector_id', NEW.inspector_id,
    'issued_by', NEW.issued_by,
    'issue_date', NEW.issue_date,
    'expiry_date', NEW.expiry_date,
    'approval_status', NEW.approval_status
  ));
END$$

CREATE TRIGGER IF NOT EXISTS trg_certificates_after_delete
AFTER DELETE ON certificates
FOR EACH ROW
BEGIN
  INSERT INTO certificate_history (certificate_id, action, changed_by, old_data, new_data)
  VALUES (OLD.id, 'delete', NULL, JSON_OBJECT(
    'id', OLD.id,
    'cert_number', OLD.cert_number,
    'name', OLD.name,
    'cert_type', OLD.cert_type,
    'asset_id', OLD.asset_id,
    'client_id', OLD.client_id,
    'inspector_id', OLD.inspector_id,
    'issued_by', OLD.issued_by,
    'issue_date', OLD.issue_date,
    'expiry_date', OLD.expiry_date,
    'approval_status', OLD.approval_status
  ), NULL);
END$$

DELIMITER ;
