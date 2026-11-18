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
step to a `P$1.<m>` id, adding missing tasks to `docs/tasks.md` first. Where the
plan rests on a guess, send a scout instead of guessing. If `docs/tasks.md` says
this phase has **no plan file**, skip drafting one and work straight from its
tasks — do not manufacture ceremony.

Do **not** wait for approval by default. Post the plan as a short summary — what
changes, in what order, what settles each open question — then start step 1, and
say plainly when nothing crucial was open. Stop and ask me only when a
**crucial** decision is open:

- it would change a contract another phase depends on, or supersede an accepted
  ADR;
- it is expensive or impossible to reverse — schema shape, a route, a deploy, a
  data migration;
- it is a product or taste call — copy, visual direction, naming, trimming scope;
- it needs something only I can supply — credentials, accounts, a paid resource,
  or a choice between two viable designs with different products.

Anything the plan, `tasks.md`, or the ADRs already determine is settled:
proceed. Implementation detail, file layout, step order, refactors inside a
step, and local naming never need my sign-off.

While executing: one step at a time, verifying each step as the plan says rather
than at the end; run long builds and test suites in the background. If you hit
something the plan did not cover, stop and tell me instead of widening scope.

When the phase is done: tick its tasks in `docs/tasks.md`, fill the plan's
§ Outcome (shipped, slipped, deviations, inherited assumptions, **and the feature
inventory and review list below verbatim**), record any decision change as an
ADR, run the phase's full verification, and commit with a `phase $1:` prefix.

Then report. The report is a **feature inventory**, not a summary: I must be able
to tell what actually works without opening the repo, and what is a picture of a
feature. Use these seven sections, in this order.

**1. Shipped, by feature.** One row per feature this phase added or changed.

| Feature | State | Files | Evidence |
| --- | --- | --- | --- |

- `State` is `real` **only** if something reads, writes, routes, or tests it —
  and the word must name which: "read", "action", "route", "auth", "unit test",
  "e2e". If it only renders, it is `sample` and it belongs in section 2.
- `Files` are repo-relative and backticked. **A row without a file is not
  allowed.** No adjectives as features: "polished the UI" is rejected; "pixel
  chrome utilities, consumed by `Badge` and `Button`" is a row.
- `Evidence` is the command, test name, or exact UI check that proves the state.
- Half-built things go in section 2, never here. This table is a claim that it
  works; if it is not wired, do not list it.

**2. Not real yet.** Every panel, control or number a user can see with no
system behind it. Mandatory even when empty ("no fixture data remains in this
surface").

| What you see | Actually | Becomes real in |
| --- | --- | --- |

- Name the fixture constant and its file (`PREVIEW_ROLLS` in
  `src/pages/(app)/home.tsx`), or the hardcoded prop (`online: true`).
- `Becomes real in` is a phase and the system that does it, not a restatement of
  the plan: "Phase 4 — server roll + `roll-logs`".
- Include disabled or fake affordances (a native `<input>` that does nothing is a
  row), and any read that silently falls back to a fixture.

**3. Persistence check.** One line, plainly: did this phase make the app write
to any collection, and if so which collection, from where. "Nothing in the app
writes to any collection" is a valid and important answer — say it when true,
and say which phase changes it.

**4. Pending, by phase.** Only phases after this one. One line each: phase →
what it turns live. No re-narrating the plan.

**5. Worth your eyes.** The few things only a human can judge — where a passing
test is not the same as it being right. Put nothing here that a command proves.

| Tier | Item | Why a human | What to check | Files |
| --- | --- | --- | --- | --- |

- **Tier every row.** `blocks` when being wrong costs rework, is hard to
  reverse, or is a security/permission choice; `taste` when it is copy, spacing
  or preference. `blocks` rows come first.
- **Cap `blocks` at five.** More than five is the finding: say which phase each
  extra one belongs to, or which decision the plan skipped, instead of trimming
  to fit.
- **A row may never be dropped for length.** If it does not fit, move it into the
  plan's § Risks with one line so it stays on the record.
- `taste` rows are uncapped but skippable in ten seconds: a file and one clause,
  no argument.
- Only judgment calls. If the section is empty, write "nothing this phase needs
  human judgment" — do not pad it.
- Candidates: schema shape versus design intention · permission/RBAC matrices ·
  the AI system prompt, which is product behaviour · user-visible copy · visual
  proportions and palette in situ · accepted risks and known compromises ·
  anything expensive to reverse (column names, route paths, the GitHub source
  latch).
- `What to check` names a **decision to confirm**, not a file to open:
  "`characters` has no `level`/`xp` — still matches ADR 0010?" beats "review the
  schema".
- Point at the smallest useful thing: a column list, an exported symbol, a line
  range, a constant.
- Do not repeat section 2. Fixtures are known-absent; this is for things that
  exist and could be wrong.
- An accepted risk listed here must name its ADR.

**6. Files touched.** Output of
`git diff --stat <first commit before this phase>..HEAD`, trimmed to source
files, with the commit hashes named. This is the receipt for section 1.

**7. Verification.** Exact commands run and their results, plus the demo beats
that pass by hand if this phase touched a beat.

Close on the next phase, in the last lines I read: name it from the phase board,
say whether it is **ready** or **blocked** (and on exactly which task, with that
task's id), and give me the one command to start it — `/phase <next>`. If a later
phase became ready or blocked as a side effect of this one, say so there too, so
I never have to read the board to decide what to run. Do not start the next phase
yourself.
