# 0023 — Campaign reset and scene progression

- **Status:** Accepted
- **Date:** 2026-11-19
- **Area:** content / game flow
- **Constraints:** `P5.16`, `P5.17`; supersedes the "three scene states
  expressed in the existing campaign columns" clause of
  [0011](./0011-content-arc.md)
- **Complements:** [0009](./0009-engine-owns-outcomes.md) (engine owns
  outcomes), [0012](./0012-gm-turn-policy.md) (turn policy)
- **Partially superseded by:** [0025](./0025-new-game-reset.md) — the reset
  clause below now also resets HP and packs, and the button is a new game

## Context

Phase 5 shipped a GM that answers when spoken to, against one seeded campaign
row with eight columns and no notion of progress. Two product problems followed:

1. **The story never starts.** A player opens the table and has to know what to
   ask. The GM reads the scene but does not open it, so the demo's first beat is
   a text box, not a story.
2. **There is no arc.** `locationName` / `atmosphereTag` / `sceneSummary` /
   `activeThreatDc` describe *a* scene, not *where the table is* in a campaign.
   ADR 0011 fixed three scene states and no content library, which was right for
   Phase 1 but leaves "Act I, Scene 2 of 5" unrepresentable, and leaves the GM
   free to move the scene anywhere at any time — a model deciding when the story
   ends, the exact failure ADR 0009 exists to prevent.

Multiple campaigns remain cut (ADR 0008): one row, `default-campaign`.

## Decision

**One campaign, a five-scene scaffold, and an engine-enforced exit per scene.**

- **The scaffold is code, not content.** `src/lib/campaign-arc.ts` exports
  `CAMPAIGN_ARC`: five scenes across three acts, each with `act`, `title`,
  `locationName`, `atmosphereTag`, `sceneSummary`, `activeThreatDc`, an optional
  enemy (`enemyName`, `enemyMaxHp`) and an `exit`: `'check'` (one successful
  `roll-logs` row at that scene's DC) or `'defeat'` (enemy at 0 HP). The GM
  expands inside a scene; it does not invent the arc.
- **`sceneIndex` is the only new column** (`campaigns`, number, default `0`,
  additive DDL). Everything else stays in the columns ADR 0011 named.
- **`startCampaign` resets the table.** A signed-in member confirms "Start New
  Campaign" in the campaign banner; the action writes the arc's scene 0 columns,
  `sceneIndex: 0`, and one `gm_event` row ("A new campaign begins — Act I, Scene
  1"). Characters, items and roll history are untouched: the log is evidence
  (ADR 0005), not state to erase.
- **Advancement is engine-checked.** `update_campaign_scene` accepts
  `sceneIndex`, but only `current + 1`, and only when the current scene's `exit`
  is satisfied by records: a successful `roll-logs` row for this scene's DC, or
  `enemyHp === 0`. Otherwise it refuses with `scene_not_complete` and the GM may
  not narrate past it. The model chooses DCs and damage *inside* a scene; the
  engine decides when the scene is over (ADR 0009).
- **The GM opens the campaign when the player starts it.** The "Start New
  Campaign" click sends one synthetic opening turn ("Begin the campaign"), so
  the opening narration is a consequence of a user action, not a mount timer.
  A scene advance narrates in the same turn that advances it (tool, then prose).
  Combined with the existing auto-resolve, the GM has exactly three moments of
  initiative, all attributable to a record or a click. No idle or timed turns.

## Consequences

- **Positive:** the table has a beginning, a middle and an end it can see
  ("Act I · Scene 2 of 5" in the banner); the GM drives beats without a clock;
  the story cannot jump a scene the engine has not closed; reset is one action
  and leaves the evidence intact.
- **Negative:** five scenes is a small arc, and a table that wants to wander is
  constrained to it — ADR 0011's trade, made explicit. Reset is available to any
  member (it is a table action, like the seed); a griefer can restart the story,
  which is one `gm_event` row and no lost data.
- **Follow-up:** a second arc, branching, or per-player progress would be a new
  ADR; `CAMPAIGN_ARC` is the seam for it.

## Alternatives considered

- **Multiple campaigns with a picker.** Rejected: ADR 0008's cut list, and the
  presence scope, feed filter and GM tools would all need a campaign parameter.
- **Model decides advancement.** Rejected: the GM would end the story when the
  prose felt finished — the documented failure mode in ADR 0009.
- **Progress derived from `atmosphereTag`.** Rejected: atmosphere is mood, not
  ordinal; three values cannot express five scenes.
