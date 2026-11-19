# 0026 — The new-game reset clears the roll log too

- **Status:** Accepted
- **Date:** 2026-11-19
- **Area:** content / game flow
- **Constraints:** `P5.16`
- **Supersedes:** the "roll history is kept" clause of
  [0025](./0025-new-game-reset.md). Everything else in 0025 stands.
- **Complements:** [0005](./0005-dice-roll-authority.md),
  [0009](./0009-engine-owns-outcomes.md)

## Context

ADR 0025 kept `roll-logs` through a reset on the grounds that history is
server-authored evidence (ADR 0005). Using it made the opposite case: after
"Start New Campaign", the feed still shows fifty rolls from the previous run
above the new opening scene, the GM's snapshot still reads them as context, and
"Act I, Scene 1" sits under a table that has visibly already played. A new game
that leaves the old log on screen is the same bug 0025 fixed for HP and packs.

## Decision

**`startCampaign` deletes every `roll-logs` row for the campaign, then writes its
own marker row as the last step.** After a reset the feed holds exactly one row —
"A new game begins — Act I, Scene 1" — and the GM's snapshot has no prior roll to
reason from. Order is load-bearing: drain `roll-logs` first (batched
`deleteWhere`, same pattern as the packs), reset scene / HP / packs, and write the
marker last so the reset cannot delete its own evidence.

The reset is the **only** code path that deletes roll history, it is a
member-at-the-table action behind a `ConfirmModal`, and the confirm copy now says
the log is cleared. ADR 0005's claim ("the row is the evidence for a roll under
way") is unchanged inside a run; a reset ends the run.

## Consequences

- **Positive:** a reset produces a genuinely clean table — one feed row, the same
  first-visit state a new reviewer sees — and the GM cannot narrate from a
  previous session's dice.
- **Negative:** evidence is destroyed by a click. It is bounded (one campaign,
  demo scale, behind a confirm), and it is the same act as starting a new game.
  A future audit requirement would need an archive collection, which is a new
  ADR, not a silent change here.
- **Follow-up:** `P5.16`'s test must assert exactly one row survives a reset, and
  that a refused reset (`not_at_table`) deletes nothing.

## Alternatives considered

- **Keep the log (ADR 0025).** Rejected after seeing the reset in use: the stale
  feed contradicts the fresh scene.
- **Archive the rows to another collection.** Rejected for this build: a second
  collection and a retention policy for demo data is scope the budget does not
  have.
