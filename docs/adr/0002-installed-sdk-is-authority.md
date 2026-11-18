# 0002 — Installed SDK is the authority, not the plan's version

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** platform
- **Constraints:** every phase; `docs/tasks.md` § Verified SDK facts

## Context

The plan targets `deepspace@0.43.0`. The scaffold installs `^0.44.2` and that
is what ships. Several plan statements do not hold on 0.44.2:

- `RolePermissions.create` is boolean-only — `create: 'own'` will not compile.
- `ctx.tools` has `remove`, not `delete`, and **no transaction primitive**, so
  "atomically" in `applyGmMutation` is unachievable.
- `ctx.tools.create` with an existing id is an upsert, not an error.
- `orderBy: 'createdAt'` resolves to the system `_created_at` column, bypassing
  a schema column of that name.
- There is no `billing: 'owner'` flag — owner billing is the absence of
  `authToken`.
- `src/components/ChatPanel.tsx` does not exist until `ai-chat` is installed.

## Decision

The installed package's `.d.ts` and implementation are the authority for every
API claim. The plan is a statement of intent. Where they disagree, follow the
installed code and record the deviation in the relevant ADR or in
`docs/tasks.md` § Verified SDK facts — do not silently follow the plan.

## Consequences

- **Positive:** no time spent against an API that does not exist; the
  deviations are written down once instead of rediscovered per session.
- **Negative:** every session must re-read types before trusting a plan claim,
  which is slower than reading the plan alone.
- **Follow-up:** re-verify on an SDK bump. If the project ever pins to 0.43,
  most of the recorded facts need a fresh pass and the ADRs get superseded.

## Alternatives considered

- **Downgrade to `0.43.0`.** Rejected: the scaffold, lockfile and adopted
  migrations are already 0.44-era; a downgrade risks the migrations manifest and
  Durable Object state for no product benefit.
- **Edit the plan in place.** Rejected: the plan is the shared intent document
  and the points above are version facts, not design choices.
