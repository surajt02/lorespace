# 0025 — "Start New Campaign" is a new game: HP and packs reset too

- **Status:** Accepted
- **Date:** 2026-11-19
- **Area:** content / game flow
- **Constraints:** `P5.16`
- **Supersedes:** the reset clause of
  [0023](./0023-campaign-reset-and-scene-progression.md) ("Characters, items and
  roll history are untouched"). Everything else in 0023 stands: one campaign,
  five scenes, `sceneIndex`, engine-gated exits, the opening beat.
- **Complements:** [0018](./0018-character-deletion.md) (items go before their
  character), [0020](./0020-no-player-hp-path.md)
- **Partially superseded by:** [0026](./0026-reset-clears-roll-log.md) — the
  roll log is cleared by the reset, not kept

## Context

ADR 0023 reset the scene and left characters, HP and packs alone, so "Start New
Campaign" was a scene rewind. That reads wrong the moment it is used: a table
that starts Act I with three wounded adventurers and a pack full of loot from the
previous run is not starting a story, it is replaying a scene. In this build —
one campaign, one arc, a demo — the button the player expects is **new game**:
everyone at full health, everyone back to their starting kit, the story at Act I.

The budget has no room for a save-slot model, and there is nothing to preserve:
characters are one per player ([ADR 0019](./0019-one-character-per-player.md)),
and every character is re-creatable with Forge.

## Decision

**`startCampaign` resets the table to the state a first visit produces.**

In one action, in this order, stopping at the first failure and reporting what
already landed:

1. **Scene:** write the arc's scene 0 (location, atmosphere, summary, DC, enemy
   name/HP, `sceneIndex: 0`) — unchanged from ADR 0023.
2. **HP:** set every character in `default-campaign` to `hp = maxHp`. The value is
   engine-authored (`maxHp`, already on the row); the caller never supplies a
   number, so this is not a player HP path
   ([ADR 0020](./0020-no-player-hp-path.md) stands).
3. **Packs:** delete every `inventory` row in the campaign
   (`deleteWhere('inventory', { campaignId }, …)` drained in batches), then
   re-create each character's archetype starter items from
   `ARCHETYPE_PRESETS[archetype].starterItems`, owned by that character's owner —
   the same rows Forge would have written, so a reset and a fresh forge converge.
4. **Log:** one `gm_event` row, "A new game begins — Act I, Scene 1" (ADR 0023's
   marker). **Roll history is kept**: it is server-authored evidence (ADR 0005)
   and the copy of a record is not something a reset button should delete; the
   marker row is the boundary a reader uses.

**Who may reset:** a signed-in member who is at the table — the action refuses
with `not_at_table` unless the caller has a character in the campaign. That keeps
a drive-by visitor from resetting a live table without adding a GM seat, and it
is the same "the GM acts for the table" posture as ADR 0012. The button sits in
the campaign banner behind a `ConfirmModal` whose description names exactly what
returns to the start (scene, HP, every pack) and what does not (characters, the
roll log).

## Consequences

- **Positive:** "Start New Campaign" means what a player expects in this build;
  the demo can be reset between reviewers without re-forging characters; the
  starter kit rule lives in one place (`ARCHETYPE_PRESETS`), so a reset cannot
  drift from a forge.
- **Negative:** a member can wipe the table's loot and healing — recoverable only
  by playing on or forging again; that is the point of the button, and the
  confirm modal is the gate. Items a GM granted mid-arc are not restored (they
  were not starter items), which is honest: a new game starts from the kit.
- **Follow-up:** if a save-slot or multi-campaign model ever arrives, the reset
  becomes a new run rather than a mutation of the one row, and this ADR is
  superseded by that one.

## Alternatives considered

- **Scene-only reset (ADR 0023 as written).** Rejected after using it: a wounded
  party with the old loot starting a "new" campaign reads as a bug.
- **Also clear `roll-logs`.** Rejected: the log is the app's audit trail and the
  GM's evidence; a reset that deletes rows it did not author is a different,
  larger decision (and would contradict ADR 0005's evidence claim).
- **Owner-only reset.** Rejected: the reviewer driving the demo is not the app
  owner, so the button would be dead for the person it is for.
