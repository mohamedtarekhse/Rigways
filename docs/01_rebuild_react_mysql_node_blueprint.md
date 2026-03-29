# Rigways ACM Rebuild Documentation (React + Node.js + MySQL)

## 1) Objective
This document explains how to recreate the current Rigways ACM platform using a modern stack:
- **Frontend:** React (Vite + TypeScript)
- **Backend:** Node.js (NestJS or Express + TypeScript)
- **Database:** MySQL 8
- **Storage:** S3-compatible object storage (or local in dev)
- **Notifications:** Email + Web Push

It is based on the current app’s domain and behavior (assets, certificates, jobs, inspectors, clients, functional locations, notifications, reports, auth).

---

## 2) Current System Snapshot (from this repo)
The existing codebase is static HTML + shared JS + API worker style architecture.

Key API domains currently present:
- Auth, users, assets, certificates, clients, inspectors, functional locations, notifications, reports, push, cron check-expiry.
- Central route dispatch in worker entrypoint.

Important DB entities visible in migrations:
- `clients`, `users`, `functional_locations`, `inspectors`, `assets`, `certificates`, `certificate_history`, `notifications`, `audit_logs`, `push_subscriptions`, `jobs`, `job_inspectors`, `job_events`.

---

## 3) Target Architecture (recommended)

## 3.1 High-level
- **React SPA** (admin panel + role-based dashboards)
- **Node API** (REST + optional WebSocket)
- **MySQL** (transactional relational model)
- **Redis** (optional for queue/cache/session)
- **Worker queue** (BullMQ / cron / scheduler) for expiry checks and notification fanout

## 3.2 Suggested folder structure
```txt
rigways/
  apps/
    web/                # React app (Vite)
    api/                # Node API (NestJS or Express)
  packages/
    ui/                 # shared components
    types/              # shared TS types + zod schemas
    eslint-config/
  infra/
    docker/
    nginx/
  docs/
```

## 3.3 Recommended libraries
Frontend:
- React + TypeScript
- TanStack Query (API state)
- React Router
- Zustand/Redux Toolkit (local/global UI state)
- React Hook Form + Zod
- Tailwind or MUI/Ant Design (consistent responsive UI)

Backend:
- NestJS (recommended) OR Express/Fastify
- Prisma ORM (or Drizzle)
- Zod/Joi validation
- JWT auth + refresh token rotation
- BullMQ for background jobs
- Web-push + nodemailer/resend

---

## 4) Data Model (MySQL Mapping)

## 4.1 Core tables
1. `users`
2. `clients`
3. `inspectors`
4. `functional_locations`
5. `assets`
6. `certificates`
7. `certificate_history`
8. `jobs`
9. `job_inspectors` (many-to-many)
10. `job_events`
11. `notifications`
12. `push_subscriptions`
13. `audit_logs`

## 4.2 Important domain notes
- `jobs.client_id` should reference client business key (`client_id`) or surrogate id—pick one and standardize globally.
- `certificates` must support optional `lifting_subtype`.
- maintain immutable `certificate_history` snapshots for approvals and edits.
- notifications should support both user-targeted and role-targeted fanout.
- keep status enums strict in app layer and DB constraints.

## 4.3 MySQL best practices
- Use `utf8mb4` charset + `utf8mb4_0900_ai_ci` collation.
- Use `BIGINT UNSIGNED` for numeric ids or UUID `CHAR(36)` if you need portability.
- Add covering indexes for frequent list filters (status + client + created_at).
- Use soft delete (`deleted_at`) only where business recovery is needed.

---

## 5) API Design (v1)

Base prefix: `/api/v1`

Auth:
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/refresh`
- `GET /auth/me`

Assets:
- CRUD + list filters + import/export endpoints

Certificates:
- CRUD + approval/reject flow
- expiry filtering
- history timeline
- upload metadata + file link

Jobs:
- create/list/get/update status
- assign/unassign inspectors
- log job events

Notifications:
- list, mark-read, mark-all-read, dismiss/delete
- push/email test endpoints (admin)

Reports:
- summary KPIs + downloadable reports

---

## 6) Auth, Roles, and Security

Roles:
- `admin`, `manager`, `technician`, `user`

Required controls:
- RBAC middleware on every endpoint
- row-level checks (e.g., customer-limited users only see their client records)
- rate limiting on auth and notification test endpoints
- secure password hashing (`argon2id` recommended)
- refresh token invalidation table
- CSRF protection if cookie-based auth

---

## 7) Frontend Rebuild Plan (React)

## 7.1 App shell
- Global layout with top shell + secondary nav
- Role-aware nav rendering
- Mobile-first responsive behavior (avoid icon-only ambiguity)

## 7.2 Feature modules
- `features/assets`
- `features/certificates`
- `features/jobs`
- `features/inspectors`
- `features/clients`
- `features/functional-locations`
- `features/notifications`
- `features/reports`

## 7.3 Reusable components
- `DataTable` with:
  - desktop table mode
  - mobile card mode
  - server pagination/sort/filter
- `FilterBar` (chips + selects + search)
- `StatusBadge`
- `ActionMenu`
- `ConfirmDialog`

## 7.4 UX improvements to include immediately
1. Mobile-first filter bars (2-column max, avoid overflow)
2. Consistent row/action spacing and sticky CTA behavior
3. Better notification panel compact mode
4. Unified table/card renderer to prevent page-specific CSS hacks

---

## 8) Background Jobs and Expiry Engine
- Schedule daily expiry scanner (`certificates` nearing/at expiry)
- Create notification records + optional email digests
- Queue push sends with retries and dead-letter handling
- Add idempotency keys per run to avoid duplicate spam

---

## 9) Deployment Options (Hostinger)

## 9.1 Option A: Hostinger Shared Hosting
Use only if Node support is limited and no background workers are needed.
- Host React static build on shared hosting.
- Host API on separate service (Railway/Render/Fly/Hostinger VPS).
- Use managed MySQL.
- Use external cron service for expiry checks.

**Not ideal** for this project due to push queues + schedulers.

## 9.2 Option B: Hostinger VPS (Recommended)
- Ubuntu + Nginx reverse proxy
- PM2/systemd for Node API
- MySQL 8 local or managed
- Redis optional (recommended)
- Certbot SSL
- CI/CD via GitHub Actions + SSH deploy

---

## 10) Step-by-Step Migration Plan

Phase 1 — Foundation (1–2 weeks)
1. Monorepo setup
2. Shared types and role model
3. Auth + users + clients modules
4. CI lint/test/build pipeline

Phase 2 — Core domain (2–4 weeks)
1. Assets + inspectors + functional locations
2. Certificates + history + file handling
3. Jobs + assignment + events

Phase 3 — Notifications/reporting (1–2 weeks)
1. Notification center
2. Email/push service + queue
3. Expiry scheduler + reporting endpoints

Phase 4 — Hardening (1–2 weeks)
1. E2E tests (Playwright)
2. load/perf and SQL index tuning
3. security checks + backups + observability

---

## 11) Quality Gates (must-have)
- Unit coverage for domain services
- Contract tests for API DTOs
- E2E smoke tests for critical paths:
  - login
  - create asset
  - upload/approve certificate
  - create/close/reopen job
  - receive notification
- MySQL migrations reversible and versioned

---

## 12) Improvements Beyond Current Version
1. Multi-tenant boundary hardening (tenant_id everywhere)
2. Full audit trail viewer in UI
3. Feature flags for gradual release
4. Centralized error taxonomy + user-safe messages
5. Real-time updates via WebSocket/SSE for notifications/jobs
6. Offline upload queue for poor field connectivity
7. Signed URL upload flow (client direct-to-storage)
8. OpenAPI/Swagger-first API contract with generated clients

---

## 13) Open Questions I Need From You (please answer)
1. Do you want **NestJS** or **Express/Fastify** for backend?
2. MySQL IDs: **UUID** or **auto-increment BIGINT**?
3. File storage preference: Hostinger local disk, S3, or Cloudflare R2?
4. Do you need Arabic+English i18n in React from day one?
5. Should technician role be read-only except uploads, exactly like current behavior?
6. Do you require real-time notifications (WebSocket) or polling is enough?
7. Expected scale (users/assets/certs) in year 1 for sizing VPS?
8. Do you want a single app for all clients (multi-tenant) or separate deployments per client?

