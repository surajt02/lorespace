# 0007 — The default campaign is seeded by a client-triggered action

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** data model
- **Constraints:** `P2.3`, `P2.5`

## Context

`ensureDefaultCampaign` creates the shared `default-campaign` row so every
player lands in a ready-to-play room. It is a privileged multi-collection write
(campaign + scene + enemy + DC), so it belongs in a server action: actions are
bearer-authenticated and run with per-record RBAC off, which is exactly what a
first-write seed needs.

The question is the trigger. Candidates: a client call from `/home`, the
worker on first record read, or a cron/job.

Facts that constrain it: `campaigns` is readable by `viewer` (anonymous), so
signed-out traffic can read but must not create. `ctx.tools.create` with a known
id is an upsert, so concurrent callers converge instead of racing.

## Decision

**The app tier calls `POST /api/actions/ensureDefaultCampaign` from `/home`
when three conditions hold:** the user is signed in (`useAuth().isSignedIn`), the
`campaigns` query returned empty, and a `useRef` guard has not already fired
this mount. The action itself remains idempotent via the upsert, so a second
caller is harmless.

## Consequences

- **Positive:** no write ever happens during a read; anonymous traffic cannot
  seed; the seed runs under a real user identity, so it is attributable and
  rate-limitable; concurrency converges on the same row.
- **Negative:** the first signed-in paint pays one action round-trip, so the
  workspace must render a skeleton — not a "no campaign" empty state — until it
  resolves. A failed call leaves the app with no campaign until the next mount;
  it needs an error toast and a retry on the next focus/mount rather than a
  silent failure.
- **Follow-up:** `P2.5` owns the wiring; the signed-out preview never has a
  campaign row and uses sample data by design.

## Alternatives considered

- **Worker-side on first record read.** Rejected: an implicit write during a
  read is surprising, has no user context, and would fire for anonymous traffic.
- **Cron/job on a schedule.** Rejected: adds latency to first paint and hides
  failures where nobody sees them.
- **Shipping the row as a schema default.** Not supported — schemas define
  columns, not rows.
