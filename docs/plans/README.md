# Phase Plans

One file per phase: `phase-N-plan.md`. Written **in that phase's own session**,
before any code, and kept current while the phase runs.

This folder is the "how", narrowly scoped to one phase. The other documents are:

| Document | Answers |
| --- | --- |
| [`../high-level-plan.md`](../high-level-plan.md) | What the app is, all six phases at intent level |
| [`../tasks.md`](../tasks.md) | What is done, what is next, across all phases |
| [`../adr/`](../adr/README.md) | Why a decision was made, and what replaced it |
| **`../plans/phase-N-plan.md`** | How exactly this phase gets built, file by file |

## Rules

1. **Write the plan before the code.** Start the phase session by drafting
   `phase-N-plan.md` from [`template.md`](./template.md), then work from it.
2. **Be specific enough to execute without re-deciding.** Name files, exported
   symbols, column names, component props, test ids, and the exact commands that
   prove the phase is done. "Build the character sheet" is not a plan step;
   "create `src/lib/d20.ts` exporting `getModifier(score): number`" is.
3. **Carry the verified facts forward.** Copy only the SDK/paths facts that this
   phase actually depends on, from `tasks.md` § Verified SDK facts — do not
   restate the whole thing.
4. **Map every step to a `P<n>.<m>` task id** in `../tasks.md`. If the plan
   needs work that has no task, add the task first (next free number).
5. **Record deviations while they happen.** A decision that changes direction
   becomes an ADR and a link from the plan, not a paragraph of rationalisation.
6. **Plan files are historical once the phase ends.** Finish with a § Outcome
   (what shipped, what slipped, what the next phase inherits). Do not rewrite a
   completed plan to match what happened.

## Index

| Phase | Plan | Status |
| --- | --- | --- |
| 0 | — (no plan file; three prerequisite tasks) | **done** — 2 accounts, `collab` 3/3, cache warm |
| 2a | `phase-2a-plan.md` | not written — data model prelude, prerequisite of Phase 1 |
| 1 | `phase-1-plan.md` | **next** — theme, landing page, workspace shell |
| 2 | `phase-2-plan.md` | not written — RBAC hardening, server actions |
| 3 | `phase-3-plan.md` | not written — character sheet, d20 math, inventory |
| 4 | `phase-4-plan.md` | not written — presence roster, dice engine |
| 5 | `phase-5-plan.md` | not written — AI Game Master |
| 6 | `phase-6-plan.md` | not written — gates, tests, deploy |
