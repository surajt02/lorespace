---
description: Implement one phase of the LoreSpace plan (orchestrator mode)
argument-hint: "<phase — e.g. 2a or 1>"
---

Implement **phase $1** of LoreSpace in this repository. If $1 is empty, or does
not match a phase in `docs/tasks.md` § Phase board, stop and ask which phase to
run instead of guessing.

You are this phase's orchestrator, not its sole implementer. Keep your own
context lean: outsource file exploration, code reading and drafting to
subagents, and read files directly only to verify what matters. Match the role to
the work — scout to map, planner to design, worker to change, reviewer to check
independently, researcher for facts outside the repo — fan read-only scouts out
in parallel, and use pipeline when the phase needs several roles in sequence.
Parallel writers each need their own checkout, passed as `cwd`. Never send input
to the block you are running in.

Read these before any code:

- `docs/high-level-plan.md` — this phase at intent level.
- `docs/tasks.md` — the phase's `P$1.*` tasks, the rules, and § Verified SDK
  facts. Trust those facts over the plan's wording.
- `docs/adr/README.md` and every ADR the phase's tasks cite. Accepted decisions
  are not up for re-litigation; changing course needs a new ADR.
- `docs/plans/README.md` and `docs/plans/template.md` — the shape your plan must
  take, and the Outcome section you must leave behind.
- `AGENTS.md` — commands, version control, DeepSpace conventions.
- The source paths this phase touches, per `docs/tasks.md` § Architecture map.

Then, before writing code: draft `docs/plans/phase-$1-plan.md` from the
template — scope with explicit non-goals, entry state verified against the actual
files, the contracts the next phase will inherit, ordered steps that each name
files and proof, verification commands, risks, and open questions. Map every
step to a `P$1.<m>` id, adding missing tasks to `docs/tasks.md` first. Report the
plan and wait for my approval. Where the plan rests on a guess, send a scout
instead of guessing.

While executing: one step at a time, verifying each step as the plan says rather
than at the end; run long builds and test suites in the background. If you hit
something the plan did not cover, stop and tell me instead of widening scope.

When the phase is done: tick its tasks in `docs/tasks.md`, fill the plan's
§ Outcome (shipped, slipped, deviations, what the next phase inherits), record
any decision change as an ADR, run the phase's full verification, commit with a
`phase $1:` prefix, and report what shipped with the exact evidence.

Close the report on the next phase, in the last lines I read: name it from the
phase board, say whether it is **ready** or **blocked** (and on exactly which
task, with that task's id), and give me the one command to start it —
`/phase <next>`. If a later phase became ready or blocked as a side effect of
this one, say so there too, so I never have to read the board to decide what to
run. Do not start the next phase yourself.
