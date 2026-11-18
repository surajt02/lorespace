# 0001 — Schemas before UI

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** sequencing
- **Constraints:** `P2a.*`, `P1.10`, Phases 1-4

## Context

`high-level-plan.md` orders Phase 1 (full 3-column workspace on hardcoded
sample data), then Phase 2 (schemas), then Phase 3/4 (rewire the same
components to `useQuery`/`usePresenceRoom`). Read literally, `home.tsx` gets
written twice: once against sample data, once against collections.

Nothing LoreSpace-specific exists yet — `src/schemas.ts` has only `users` and
`settings`, so a data-driven workspace has nothing to read until the four
collections land.

## Decision

The data model lands before the UI that reads it. The schema files, their
registration, `lintSchema` coverage and the shared `default-campaign` constant
are executed as a prelude (`P2a` in `docs/tasks.md`) at or before the start of
Phase 1. The workspace is built **data-driven once**; deterministic sample data
exists only as the signed-out preview fallback.

## Consequences

- **Positive:** one implementation of the VTT shell instead of two; RBAC and
  column names are settled before markup encodes assumptions about them; the
  signed-out preview becomes a fixture of the real data shape rather than a
  parallel universe.
- **Negative:** the Phase 1 session is larger and touches the worker-side
  registry, so its first verification run exercises the DO/realtime paths
  earlier than the plan implies. A schema mistake is now visible to the UI
  immediately rather than at Phase 3.
- **Follow-up:** `P1.10` keeps components prop-driven so Phase 3/4 swap the
  data source without touching markup. `P3.*` shrinks to wiring.

## Alternatives considered

- **Follow the plan's order.** Rejected: guarantees a second rewrite of
  `home.tsx` and encodes sample-data field names that then have to be renamed.
- **Hybrid: schema files now, registration later.** Rejected: a schema that is
  not in `src/schemas.ts` is not reachable through `useQuery`, so it delivers
  no reduction in rework.
