# 0028 — One DC per action, and only the requested roll counts

- **Status:** Accepted
- **Date:** 2026-11-19
- **Area:** game mechanics / AI
- **Constraints:** `P5.19`
- **Supersedes:** the "the check's DC is the scene's `activeThreatDc`" clause of
  [0023](./0023-campaign-reset-and-scene-progression.md), and step 2 of
  [0024](./0024-narrative-combat.md) (the GM no longer sets a check's DC through
  `update_campaign_scene`)
- **Complements:** [0010](./0010-rules-depth.md) ("one DC" means one per check,
  not one per scene), [0009](./0009-engine-owns-outcomes.md)

## Context

`activeThreatDc` was the scene's single DC, so every check in a scene resolved
against the same number: a risky jump and a heavy lever were both "DC 12". The GM
also narrated that it was setting the DC ("the stakes are set at DC 12"), because
its only lever for a DC was a scene mutation.

The table then had a second problem: any stat card was clickable, so a player who
was asked for WIS could roll INT, produce a real `roll-logs` row, and leave the GM
to explain that the row did not answer the request — mechanics in the middle of
the story.

## Decision

**The DC belongs to the requested check, and only that check can be rolled.**

- New GM tool `request_check({ characterId, stat, dc })` writes the pending check
  onto the campaign: `pendingCharacterId`, `pendingStat`, `pendingDc` (three
  additive columns, defaulting to nothing pending). It writes **no** `roll-logs`
  row: a request is not an outcome.
- `rollSkillCheck` reads the pending check. When one is pending it uses
  `pendingDc` as `targetDc` and refuses anything else — wrong stat or another
  character's sheet answers `roll_not_requested` **before the die and before any
  write**. With nothing pending it falls back to the scene DC, so the stat-card
  roll still works outside a scripted beat.
- A successful roll clears the pending trio; so do an accepted scene advance and
  `startCampaign`. A half-written or hand-edited pending row is ignored rather
  than locking the table out of every roll.
- The sheet greys out every stat except the requested one and outlines it; the
  banner shows the pending DC, pulsing while a roll is owed. The GM says the
  number only inside the request ("Roll DEX against 18"), never as system talk
  ([ADR 0028](./0028-one-dc-per-action.md) + the brief's voice rules).

## Consequences

- **Positive:** a jump and a lever can need different numbers, which is the
  minimum a table expects; a wrong click cannot create a row the GM must
  apologise for; the GM no longer mutates scene state to ask for a roll, so the
  banner's DC and the check are the same number by construction.
- **Negative:** two players acting at once overwrite each other's request — the
  newest request wins, and the previous asker is simply un-asked (no queue, ADR
  0012). A check that is never rolled leaves the scene DC showing as pending until
  the next request, the next advance or a reset.
- **Follow-up:** a request queue, or per-character pending checks, would be a new
  ADR; the current model is deliberately one pending check for the table.

## Alternatives considered

- **Parse the GM's prose for "DC 14" and gate on that.** Rejected: a regex over
  model output is a second, fragile source of truth.
- **Let any roll land and have the GM ignore the wrong one.** Rejected: it is
  how a table ends up with a real row that means nothing, and the GM then has to
  narrate mechanics.
- **Keep the scene DC and let the GM write it per action.** Rejected: the scene's
  DC is scene state; a check's DC is an event.
