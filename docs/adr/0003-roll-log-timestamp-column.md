# 0003 — `rolledAt`, not `createdAt`, on roll logs

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** data model
- **Constraints:** `P2a.4`, `P4.4`, `P5.3`

## Context

The plan defines `roll-logs.createdAt` as `storage: 'number'`,
`interpretation: 'datetime'`, `timestampTrigger: { field: 'summary' }`.

Two facts about 0.44.2 make that name a liability:

1. Every record already carries a system `_created_at`, written on insert.
2. `orderColumn('createdAt')` short-circuits to that system column, so an
   `orderBy: 'createdAt'` never sorts by the schema column of the same name —
   while `where: { createdAt }` *does* resolve to the schema column. Two
   different fields answer to one name.

## Decision

The column is named `rolledAt` and keeps
`timestampTrigger: { field: 'summary' }`. Ordering uses the system
`_created_at`; `rolledAt` is the display/narration timestamp.

## Consequences

- **Positive:** one unambiguous meaning per name; sort and display agree
  because both derive from insert time anyway.
- **Negative:** deviates from the plan's column list, so any reader comparing
  schema to plan needs this ADR. A roll row without `summary` gets no
  `rolledAt` — `summary` is `required`, which covers writes but not
  hand-seeded rows.
- **Follow-up:** AI GM tools and the dice feed read `rolledAt` for display and
  order on `_created_at`.

## Alternatives considered

- **Keep `createdAt` as the plan says.** Rejected: guaranteed to confuse
  ordering, and `_created_at` makes it redundant.
- **Drop the custom column entirely and use `_created_at`.** Viable and
  simpler, but the schema then has no declared roll time, so anything reading
  rolls outside the record layer (tests, fixtures, AI snapshot) loses an
  explicit field.
