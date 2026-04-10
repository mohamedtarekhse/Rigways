# ERP Security & Architecture Audit (2026-03-30)

## Scope reviewed
- Cloudflare Worker API gateway and auth/session patterns.
- Front-end pages for ERP modules (assets, certificates, files, clients, locations, inspectors, jobs, dashboard).
- High-level controls for RBAC, file management, and browser-side hardening.

## Executive summary
This codebase has a good baseline (JWT auth, RBAC checks, CSP/security headers, signed file URLs, and structured API routes), but still carries **material risk** in a few areas common to ERP systems:

1. **DOM XSS exposure risk** from broad use of `innerHTML` rendering in multiple modules.
2. **Token exfiltration risk** due to bearer token storage in web storage and broad script execution surface.
3. **CORS policy risk** because default `Access-Control-Allow-Origin` can be `*` unless environment is pinned.
4. **Operational gaps** for enterprise security governance (SIEM-grade audit trail, immutable logs, key rotation policy, incident workflow, data classification and retention controls).

Overall maturity: **medium** (strong start, but not yet enterprise-hard).

## Architecture-level assessment (ERP perspective)

### 1) Identity, session, and access control
**Observed strengths**
- JWT signature verification and role checks are in place at API boundary.
- Role-driven navigation exists in UI.

**Key risks**
- Access tokens are consumed from browser storage patterns in front-end code. That improves developer convenience but increases blast radius if XSS lands.
- No evidence of refresh-token rotation, token revocation list, device/session binding, or abnormal-session detection.

**Recommendations**
- Move to **HttpOnly + Secure + SameSite=Strict** cookies for session where possible (or split access/refresh and keep refresh HttpOnly).
- Add refresh token rotation with reuse detection.
- Add server-side revocation strategy (logout-all, user disable, password reset invalidation).
- Add optional MFA for privileged ERP roles (admin, approver).

### 2) Application-layer input/output security
**Observed strengths**
- Some pages attempt safer construction patterns in specific places.

**Key risks**
- Many dynamic sections render via `innerHTML`; without strict centralized escaping/sanitization, this is the highest-likelihood path to stored/reflected XSS.

**Recommendations**
- Standardize on safe DOM APIs (`textContent`, `createElement`) for untrusted data.
- If HTML rendering is unavoidable, enforce sanitizer (e.g., DOMPurify with locked config) + allowlist.
- Add lint/static rule: block unsafe `innerHTML` assignments except in approved utility wrappers.

### 3) API and edge hardening
**Observed strengths**
- Security headers helper exists and is applied to API/static responses.
- Signed URL flow exists for file access.

**Key risks**
- CORS origin may default to wildcard if env var not pinned.
- Signed URL and destructive endpoints need explicit anti-replay/rate-limit/abuse controls per tenant/user.

**Recommendations**
- Force strict allowlist for origins by environment (prod/stage/dev).
- Add rate limiting + anomaly scoring for auth, file, and delete endpoints.
- Add request-id correlation and structured security event logs.
- Add WAF managed rules and bot mitigation profile in Cloudflare zone.

### 4) File and malware pipeline (R2 explorer / certificates)
**Observed strengths**
- Antivirus hook integration point exists.
- Versioning and soft/hard delete patterns are present.

**Key risks**
- If download is allowed before scan result is `clean`, malware can propagate internally.
- Metadata/object consistency can drift under concurrent operations if not transactionally coordinated.

**Recommendations**
- Enforce policy: `scan_status=clean` before file download for normal users.
- Quarantine workflow (`pending_scan`, `infected`, `rejected`, `clean`) + admin override with audit reason.
- Add object-lock / legal-hold strategy for regulated records.
- Add idempotency keys for upload/delete/move operations.

### 5) Data governance & ERP compliance posture
**Required enterprise controls (missing or unclear in code)**
- Data classification matrix (PII, critical operational, financial).
- Retention schedules and secure deletion proofs.
- Immutable audit trail for critical actions (who/what/when/from-where/before-after hash).
- Key management policy (rotation cadence, dual control, break-glass process).
- Backup/restore and disaster recovery RTO/RPO testing evidence.

## Prioritized remediation roadmap

### P0 (0-2 weeks)
1. Lock CORS to explicit prod origins only.
2. Add centralized escaping/sanitization and start removing unsafe `innerHTML` on user-driven data paths.
3. Enforce malware scan gate before download (except tightly controlled admin override).
4. Add high-signal audit logs for login, role change, delete/hard-delete, file download, approval actions.

### P1 (2-6 weeks)
1. Session hardening (HttpOnly cookie strategy and token lifecycle controls).
2. Rate limiting and brute-force protections on auth and sensitive endpoints.
3. Security regression tests (DAST + unit tests for authz and data ownership boundaries).

### P2 (6-12 weeks)
1. SIEM integration (Cloudflare logs + app security events).
2. Formal threat model (STRIDE) and abuse-case test suite.
3. Compliance evidence pack (SOC2/ISO27001-friendly control mapping).

## Threat model highlights (high probability / high impact)
- **XSS -> token theft -> admin action abuse**.
- **Overbroad CORS + token leakage -> cross-origin abuse**.
- **File malware bypass if scan enforcement is asynchronous and not blocking**.
- **Insider misuse of hard-delete without immutable logs/approvals**.

## Questions needed from business/security owner (to finalize design)
1. What compliance targets do you need (SOC 2, ISO 27001, PCI, HIPAA, local regulations)?
2. Do you require MFA for all admin users now?
3. What is your maximum acceptable downtime/data loss (RTO/RPO)?
4. Should hard delete require dual approval for production ERP data?
5. Do you want downloads blocked until AV scan is clean (strict mode) starting immediately?
6. Which SIEM is preferred (Splunk, Sentinel, QRadar, etc.)?
7. Is there a data residency requirement (country/region lock) for R2 and logs?

## Suggested security KPI dashboard
- Failed login rate, lockouts, and geo anomalies.
- Privileged actions per admin (delete/hard-delete/export/download).
- File scan outcomes (pending/clean/infected) and time-to-clean.
- CSP violations and blocked script attempts.
- Mean time to detect/respond for security incidents.

