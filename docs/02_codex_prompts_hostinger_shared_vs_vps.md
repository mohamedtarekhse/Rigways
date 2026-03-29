# Codex Prompt Pack for Rebuilding Rigways ACM (React + Node + MySQL)

Use these prompts directly in Codex to build the new system in controlled phases.

---

## Prompt 1 — Bootstrap Monorepo
```text
You are my senior full-stack engineer. Build a production-ready monorepo for Rigways ACM using:
- Frontend: React + Vite + TypeScript
- Backend: Node.js + TypeScript (NestJS preferred unless specified)
- Database: MySQL 8 + Prisma
- Package manager: pnpm
- Linting/format: ESLint + Prettier
- Testing: Vitest (unit), Playwright (E2E)

Requirements:
1) Create monorepo structure: apps/web, apps/api, packages/types.
2) Add shared role enum: admin, manager, technician, user.
3) Add env templates for local/dev/prod.
4) Add Docker Compose for api + mysql + redis (optional).
5) Add scripts for dev/build/test/lint.
6) Generate README with setup steps.

Output:
- All created files.
- Commands to run.
- Brief architecture notes.
```

---

## Prompt 2 — DB Schema + Migrations
```text
Create Prisma schema and SQL migrations for Rigways ACM with entities:
users, clients, inspectors, functional_locations, assets, certificates, certificate_history,
jobs, job_inspectors, job_events, notifications, push_subscriptions, audit_logs.

Constraints:
- certificates includes optional lifting_subtype.
- jobs has statuses: active, technician_done, closed, reopened.
- unique job_number.
- job_inspectors unique (job_id, inspector_id).
- certificate_history immutable snapshots.

Deliver:
1) Prisma models with indexes.
2) Migration files.
3) Seed script with one admin user and sample client/assets/certs.
4) ERD description in markdown.
```

---

## Prompt 3 — Auth + RBAC API
```text
Implement auth and RBAC for the API:
- login/logout/refresh/me endpoints
- JWT access token + refresh token rotation
- argon2 password hashing
- role middleware: admin, manager, technician, user
- tenant guard by client when applicable

Also add:
- rate limiting for login
- audit logs for login and critical actions
- OpenAPI documentation for auth endpoints

Return:
- source code
- example curl requests
- security notes
```

---

## Prompt 4 — Assets + Certificates + Jobs APIs
```text
Implement modules and REST endpoints for:
1) Assets CRUD + filter/sort/pagination
2) Certificates CRUD + approval flow + expiry filters + history timeline
3) Jobs CRUD + assign/unassign inspectors + status transitions + job events

Rules:
- Validate inputs with zod.
- Use transaction boundaries where multi-table writes occur.
- Add service-level unit tests for all status transitions.
- Return consistent response envelope: { success, data, error, meta }.

Provide:
- route list
- DTO schemas
- test files
```

---

## Prompt 5 — Notifications + Push + Scheduler
```text
Implement notifications subsystem:
- notifications table CRUD/list/mark-read
- role fanout helper (notifyRoles)
- web push subscription endpoints
- push send service with statusCounts and reasons
- daily certificate expiry scheduler with idempotency key

Technical:
- queue-based delivery (BullMQ preferred)
- retry/backoff policy
- dead-letter queue
- structured logs for each dispatch

Deliver:
- worker/queue code
- scheduler cron setup
- integration tests with mocked push provider
```

---

## Prompt 6 — React UI with Mobile-First Design
```text
Build React UI pages for:
- Dashboard
- Assets
- Certificates
- Jobs
- Clients
- Inspectors
- Functional Locations
- Notifications
- Reports

Constraints:
- mobile-first responsive layout
- no horizontal overflow in toolbars
- desktop table + mobile card switch in one reusable DataGrid component
- role-based navigation visibility
- optimistic UI updates for status actions
- i18n-ready (en/ar keys)

Deliver:
- component tree
- page screenshots (if environment supports)
- accessibility checklist (keyboard + labels + contrast)
```

---

## Prompt 7 — Hostinger Shared Hosting Deployment Plan
```text
Given I use Hostinger Shared Hosting, produce deployment architecture for React + Node + MySQL.
If Node long-running process is constrained, propose hybrid deployment:
- React static on shared host
- API + scheduler hosted externally
- MySQL managed

Output:
- exact deployment steps
- domain/subdomain routing
- SSL setup
- environment variable placement
- backup/restore plan
- limitations and risk list
```

---

## Prompt 8 — Hostinger VPS Deployment Plan (Recommended)
```text
Create a production deployment runbook for Hostinger VPS:
- Ubuntu, Nginx, Node LTS, PM2, MySQL 8, Redis
- reverse proxy setup
- SSL with certbot
- firewall hardening
- CI/CD from GitHub Actions via SSH
- daily DB backups and retention policy
- uptime monitoring and alerts

Return:
1) shell commands
2) nginx config templates
3) PM2 ecosystem config
4) rollback playbook
```

---

## Prompt 9 — Final Hardening Review
```text
Act as principal architect and review the full implementation.
Produce:
- security checklist (OWASP API Top 10)
- performance checklist (DB indexes, N+1, caching)
- reliability checklist (timeouts, retries, idempotency)
- maintainability checklist (module boundaries, naming, tests)
- prioritized remediation backlog (P0/P1/P2)
```

---

## Prompt 10 — “Single Master Prompt” (if you want one-shot generation)
```text
I need you to generate a production-grade multi-tenant Asset & Certificate Management platform named Rigways ACM.
Stack:
- React + TypeScript (frontend)
- Node.js + TypeScript (NestJS preferred)
- MySQL 8 + Prisma
- Redis + BullMQ for background jobs

Functional modules:
- Auth/RBAC (admin/manager/technician/user)
- Clients
- Functional Locations
- Inspectors
- Assets
- Certificates (including lifting_subtype)
- Jobs + inspector assignment + job events
- Notifications (in-app + email + web push)
- Reports

Non-functional requirements:
- Mobile-first UX
- Reusable table/card data grid
- OpenAPI docs
- Unit + integration + e2e tests
- Structured logs + audit logs
- CI/CD + deployment scripts for Hostinger VPS

Generate the project in phases and after each phase provide:
1) files changed
2) migration notes
3) run commands
4) tests and expected outputs
5) risk notes

Do not skip validation, tests, or security middleware.
```

---

## Improvements You Should Ask Codex To Add (important)
1. API idempotency keys for create/update critical actions.
2. Soft-delete recovery workflow for high-value records.
3. RBAC matrix tests auto-generated from policy table.
4. OpenTelemetry tracing for API + queue workers.
5. Upload antivirus scanning (ClamAV or provider scanning).
6. SSO-ready auth abstraction for future enterprise clients.
7. Blue/green deploy support for zero downtime.

---

## Questions you should answer before generation
1. NestJS or Express?
2. UUID or BIGINT ids?
3. Shared hosting only, or VPS available from day one?
4. Need WhatsApp/SMS notifications too?
5. Required SLA/uptime target?
6. Expected monthly active users and data growth?
7. Any compliance requirement (ISO, SOC2, local regulations)?

