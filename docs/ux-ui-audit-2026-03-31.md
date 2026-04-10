# UX/UI Audit Report (ERP Web App)
Date: 2026-03-31
Reviewer perspective: Senior UX/UI (15+ years)

## Audit scope
- Core shell/navigation patterns and responsive behavior.
- High-traffic ERP modules: Dashboard, Assets, Certificates, Jobs, Files, Clients, Locations, Inspectors, Notifications.
- Mobile usability and cross-page consistency.
- Accessibility basics (labels, tap targets, semantic behavior).

## Executive scorecard (heuristic)
- Information architecture: **7/10**
- Visual consistency: **6.5/10**
- Mobile usability: **7/10**
- Accessibility (baseline): **5.5/10**
- Interaction quality/feedback: **7/10**
- Overall: **6.6/10** (usable, but needs polish for enterprise-grade UX confidence)

---

## What is working well
1. **Design tokens and component baseline are centralized** in shared styles (`sap-card`, toolbar/table system), which is good for maintainability.
2. **Mobile-specific handling exists** (mobile menu button behavior, safe-area insets, responsive media queries).
3. **Role-aware navigation and view modes** are implemented, which is critical in ERP UX.
4. **Dense table modes** are available (compact/ultra), which is practical for operational users.

---

## Key UX/UI findings (prioritized)

## P0 — Must-fix (high impact)
### 1) Inconsistent interaction patterns across modules
Different pages still render controls and rows with ad-hoc inline templates and custom behavior, causing “same task, different interaction” friction.

**Why it matters**
- ERP users build muscle memory; inconsistency increases error rate and support cost.

**Recommendation**
- Standardize list pages with a single page blueprint:
  - Header + summary KPIs (optional)
  - One toolbar row (search/filter/actions/count)
  - One table pattern (selection/actions/status)
  - One modal/drawer style

### 2) Accessibility risk from HTML-template-heavy rendering
Large use of dynamic `innerHTML` for rows/buttons/toasts can hurt accessibility semantics and predictable focus order unless rigorously managed.

**Recommendation**
- Introduce an accessibility-safe rendering utility for repetitive row/action rendering.
- Enforce keyboard focus return after modal close and after destructive action undo/cancel.
- Add `aria-live="polite"` to toast container and explicit `aria-label`s for icon-only actions.

### 3) Visual hierarchy is still crowded in data-heavy pages
Cards, toolbars, and tables sometimes compete visually due to similar borders, density, and limited spacing rhythm.

**Recommendation**
- Adopt a strict spacing scale per viewport (e.g., 4/8/12/16) and apply by component type.
- Reduce non-critical borders on desktop; use subtle background separation instead.

---

## P1 — Important (next sprint)
### 4) Mobile table strategy is mixed (horizontal scroll + cardified mode)
There are two mobile approaches (`scrollable table` and `mobile-plan-b` cardified rows). This can feel inconsistent.

**Recommendation**
- Choose one default mobile table strategy globally:
  - For ERP: prefer cardified rows for critical workflows on <=640px, with sticky primary actions.

### 5) Toolbar ergonomics could be improved for thumb usage
Current responsive toolbar stacks well, but filters/actions can still require too much vertical travel.

**Recommendation**
- Create “Quick Filters” chips for most-used statuses and date presets.
- Keep primary action persistent (sticky bottom CTA on mobile where appropriate).

### 6) Feedback quality varies by action type
Undo toast is excellent, but progress/success/failure language and affordance are not fully consistent across modules.

**Recommendation**
- Define a feedback copy system (success, warning, error, confirm) with consistent tone and iconography.

---

## P2 — Polish / scale-up
### 7) Notifications page visual style diverges from the rest
It has unique visual treatment and denser custom CSS, making it feel like a separate app.

**Recommendation**
- Refactor Notifications to shared shell + card + toolbar primitives while keeping its advanced features.

### 8) Mixed language artifacts in config labels
Arabic label fields still exist in role/nav config even after English-only direction.

**Recommendation**
- Remove dead bilingual label fields to reduce cognitive/maintenance noise.

---

## Suggested UX modernization roadmap

### Phase 1 (1–2 weeks)
- Publish a **UX pattern contract** for all CRUD modules.
- Build shared helpers/components for:
  - table row actions,
  - empty/loading/error states,
  - toolbar presets,
  - modal/drawer actions.

### Phase 2 (2–4 weeks)
- Normalize all major modules to the contract (Assets, Certificates, Files, Jobs first).
- Add keyboard and screen-reader acceptance checklist.

### Phase 3 (4–6 weeks)
- Instrument UX analytics:
  - filter usage,
  - undo usage,
  - action completion time,
  - error-rate per module.
- Run a focused usability test with 5–8 operational users.

---

## Quick wins I recommend implementing immediately
1. Add a shared **`PageToolbar` pattern** and apply it in every module.
2. Add **`aria-live`** to toast region and guarantee focus management after modals.
3. Adopt one **mobile table behavior** across all pages.
4. Create a one-page **interaction style guide** (buttons, statuses, delete confirmations, undo text).

---

## Questions for you (so I can tailor UX precisely)
1. Who is the primary daily user: admin, manager, or technician?
2. Which 3 workflows are most frequent (e.g., create asset, upload certificate, close job)?
3. Do you prefer a **dense enterprise UI** or **clean spacious UI** by default?
4. Should mobile prioritize **speed** (fewer details) or **full detail parity** with desktop?
5. Do you want me to produce a concrete redesign spec for one page first (recommended: **Assets**), then scale to all pages?
