# Rigways ACM Execution Plan, Team Plan, and Budget (Hostinger VPS vs Hybrid)

## Goal
Provide an actionable delivery plan to rebuild Rigways ACM on React + Node.js + MySQL with deployment options:
1) Hostinger VPS (recommended)
2) Hybrid (Shared hosting for frontend + external API)

---

## 1) Delivery Timeline (12 Weeks)

## Week 1 — Discovery & Architecture Lock
- Confirm scope, roles, tenancy model, and SLA.
- Finalize stack choices: NestJS vs Express, Prisma conventions, auth/session strategy.
- Produce architecture decision records (ADRs).

**Deliverables**
- Signed technical scope
- ERD v1
- API contract skeleton

## Week 2 — Repo Foundation & CI/CD Skeleton
- Set up monorepo and base tooling.
- Establish linting, testing, formatting, commit standards.
- Initial CI pipeline (lint + typecheck + unit tests).

**Deliverables**
- Running local dev stack
- CI green baseline

## Week 3 — Auth, RBAC, Users, Clients
- Implement auth (login, refresh, logout, me).
- Role guard middleware and permission matrix.
- Users + clients core CRUD.

**Deliverables**
- Auth module complete
- RBAC integration tests

## Week 4 — Functional Locations + Inspectors + Assets Core
- CRUD modules and validations.
- Server-side filter/sort/pagination patterns.
- Shared list endpoint contract patterns.

**Deliverables**
- Domain modules live in dev
- API docs for 3 modules

## Week 5 — Certificates Core + History + File Metadata
- Certificates create/update/list flows.
- Approval status transitions.
- History snapshots and `lifting_subtype` support.

**Deliverables**
- Certificate lifecycle complete
- History/audit trail endpoints

## Week 6 — Jobs Workflow
- Jobs create/list/patch.
- Assign/unassign inspectors.
- Job event timeline.

**Deliverables**
- Jobs + job events complete
- Role transition tests

## Week 7 — Notifications (In-app) + Reporting APIs
- Notification center APIs.
- mark-read / mark-all-read / dismiss.
- KPI/report aggregation endpoints.

**Deliverables**
- Notifications API complete
- reports endpoint baseline

## Week 8 — Email + Web Push + Scheduler
- Push subscriptions and push send service.
- Daily expiry scanner with idempotency.
- Queue retries and dead-letter strategy.

**Deliverables**
- End-to-end notification pipeline
- Cron/scheduler runbook

## Week 9 — React UI Foundation + Shared Components
- App shell, routing, role-aware nav.
- Reusable DataGrid (desktop table + mobile card).
- Reusable FilterBar and action patterns.

**Deliverables**
- Reusable design system and shell

## Week 10 — React Feature Screens
- Assets, certificates, jobs, inspectors, clients, functional locations.
- Notifications and reports views.

**Deliverables**
- All major modules connected to API

## Week 11 — Hardening, QA, Perf
- E2E coverage for critical flows.
- SQL tuning + index verification.
- Security checks and audit reviews.

**Deliverables**
- QA signoff checklist
- Performance report

## Week 12 — Deployment, Handover, Training
- Production deployment and smoke tests.
- Backup/restore verification.
- Team handover + operational SOPs.

**Deliverables**
- Production go-live
- Runbooks + admin guide

---

## 2) Team Plan (Lean)

## Option A: Small Team (Recommended)
- 1 Full-stack lead (architecture + backend)
- 1 Frontend engineer (React UX)
- 1 QA engineer (manual + automation)
- 0.5 DevOps (shared/part-time)

## Option B: Fast-track Team
- 1 Tech lead
- 2 Backend engineers
- 2 Frontend engineers
- 1 QA automation
- 1 DevOps

---

## 3) Budget Estimate (USD)

## 3.1 Build Cost (12 weeks)
Small team range:
- **$22,000 – $48,000** (region-dependent)

Fast-track range:
- **$45,000 – $95,000**

## 3.2 Monthly Infra Cost (VPS path)
- Hostinger VPS (4–8 vCPU): **$25 – $120/month**
- Managed email provider: **$10 – $50/month**
- Monitoring/logging: **$0 – $80/month**
- Backup storage: **$5 – $30/month**

Estimated monthly total: **$40 – $280/month**

## 3.3 Monthly Infra Cost (Hybrid shared + external API)
- Shared hosting frontend: **$3 – $15/month**
- API host (Railway/Render/Fly/VPS): **$15 – $120/month**
- Managed MySQL: **$20 – $150/month**
- Other services (email/monitoring): **$10 – $80/month**

Estimated monthly total: **$48 – $365/month**

---

## 4) Hostinger Deployment Decision Matrix

| Criteria | Shared Hosting | Hostinger VPS |
|---|---:|---:|
| React static hosting | Excellent | Excellent |
| Long-running Node API | Limited / variable | Strong |
| Background workers/queues | Poor fit | Good fit |
| Cron + scheduler reliability | Limited | Strong |
| Horizontal scaling | Limited | Moderate |
| Operational control | Low | High |

**Recommendation:** choose **Hostinger VPS** for this project due to jobs, notifications, push, and periodic expiry processing.

---

## 5) Technical Improvements to Include in v1.1
1. Idempotency keys for critical writes.
2. Tenant isolation hardening (`tenant_id` + scoped middleware).
3. Structured audit event catalog.
4. OpenTelemetry traces.
5. Blue/green deployment process.
6. Signed uploads + malware scanning.
7. Feature flags for safe rollout.

---

## 6) Risks & Mitigations
- **Risk:** Shared hosting cannot run queue/worker reliably.
  - **Mitigation:** move API+worker to VPS or external runtime.
- **Risk:** Notification flood or duplicate sends.
  - **Mitigation:** idempotent scheduler + queue dedupe.
- **Risk:** Mobile UX regressions.
  - **Mitigation:** reusable DataGrid + visual regression tests.
- **Risk:** Scope creep from custom reports.
  - **Mitigation:** phased reporting backlog with strict acceptance criteria.

---

## 7) Immediate Next Steps (what I need from you)
1. Confirm deployment route: **VPS** or **Hybrid**.
2. Confirm backend framework: **NestJS** or **Express**.
3. Confirm target go-live date.
4. Confirm budget band (lean vs fast-track team).
5. Confirm if Arabic localization is mandatory for v1 launch.

Once you confirm these 5 points, I can generate:
- exact backlog (epics/stories/tasks),
- sprint-by-sprint plan,
- and a production-ready runbook tailored to your chosen Hostinger setup.

