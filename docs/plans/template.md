# Phase N — <Name>

- **Status:** Draft | Active | Done | Partially shipped
- **Session:** <date, model/session note>
- **Governing tasks:** `P<n>.*` in [`../tasks.md`](../tasks.md)
- **ADRs in force:** e.g. [0001](../adr/0001-schemas-before-ui.md),
  [0003](../adr/0003-roll-log-timestamp-column.md)
- **Depends on:** what must already exist (Phase N-1 outcome)
- **Unblocks:** what the next phase may assume once this ships

## Goal

One paragraph. The user-visible change this phase produces.

## Definition of done

Verifiable statements, not vibes. Each one must be checkable by a command, a
test, or an exact manual step:

- [ ] `npm run validate` and `npm run lint` pass
- [ ] <grep gate / test / route / visible behaviour>
- [ ] <deployed or local check>

## Scope

**In scope:** <bullet list with file paths>

**Out of scope (explicit non-goals):** <things a reader might reasonably expect
here that this phase deliberately does not do, and where they live instead>

## Entry state (verified)

What exists right now, checked rather than assumed. Keep to what this phase
touches:

| Thing | State | Where |
| --- | --- | --- |

## Contracts

The interfaces this phase fixes. Anything another phase will depend on belongs
here, because a later session will read this file instead of the code.

- **Data:** collection names, exact column names + storage + interpretation,
  permission matrix per role, `ownerField`/`uniqueOn`/`userBound`.
- **Routes / actions:** path or action name, auth requirement, input, output,
  failure modes.
- **Components:** file path, exported props (names + types), which local UI
  primitives it must use, its `data-testid` hooks.
- **Pure functions:** signature + edge-case behaviour.
- **Constants:** shared ids (e.g. `default-campaign`) and where they live.

## Steps

Ordered, each independently verifiable. Every step names its files and its
proof.

### Step 1 — <name> (`P<n>.<m>`)

- Files: `src/...`, `src/...`
- Change: <precise description — exported symbols, prop shape, column list>
- Watch out: <the trap this step will hit, from tasks.md / ADRs>
- Proof: <command, test name, or exact UI check>

### Step 2 — <name> (`P<n>.<m>`)

<same shape>

## Verification

```sh
# exact commands, in order
npm run type-check
npm run lint
npm run test:unit
```

Manual, signed in and signed out:

1. <step, expected result>
2. <step, expected result>

Gates that must be green this phase (from `../high-level-plan.md` § Phase 6 and
`../tasks.md`):

- <grep / assertion / route>

## Risks

| Risk | Trigger | Mitigation |
| --- | --- | --- |

## Open questions

Questions this session cannot answer alone. Each either gets an ADR or is
resolved in the session and struck out:

- [ ] <question> → <ADR link once decided>

## Outcome

Filled in at the end of the phase, never rewritten afterwards.

- **Shipped:** <what is live>
- **Slipped:** <what moved, and to which task id>
- **Deviations:** <ADR ids>
- **Inherited by the next phase:** <assumptions now safe to make>
