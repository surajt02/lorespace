# 0024 — Combat is narration, a DC, and an engine-clamped consequence

- **Status:** Accepted
- **Date:** 2026-11-19
- **Area:** game mechanics / AI
- **Constraints:** `P5.18`; complements [0010](./0010-rules-depth.md),
  [0009](./0009-engine-owns-outcomes.md), [0022](./0022-gm-tools-confined-to-chat-turn.md),
  [0023](./0023-campaign-reset-and-scene-progression.md)

## Context

Phase 5 left combat unimplemented: `enemyName`, `enemyHp` and `enemyMaxHp` are
columns the GM can set, but nothing moves enemy HP and there is no attack. The
obvious build — an "Attack" button and an `attackEnemy` action — was designed and
rejected in review: in a tabletop game, a player attacks by *saying what they
do*, and the GM answers with a check. A button turns the wedge (a narrated,
turn-by-turn story) into a menu.

The constraint set is tight. ADR 0010 allows six attributes, AC, HP, one enemy
and one DC — no initiative, rounds, conditions or spells. ADR 0009 says the model
supplies inputs and the engine computes results. ADR 0020 says players have no HP
write path. ADR 0022 says GM write tools run only inside the in-app chat turn.

## Decision

**Combat is the conversation, and the engine owns every number in it.**

1. The player narrates an action ("I draw my bow and shoot the sentinel").
2. The GM sets the stakes with the existing `update_campaign_scene` tool —
   `activeThreatDc` is the check's DC, `sceneSummary` names the enemy — and asks
   for the named check. That is the one DC ADR 0010 allows.
3. The player clicks a stat card; the existing `rollSkillCheck` action spends the
   d20 and writes the `roll-logs` row (ADR 0005).
4. The GM verifies that row, then applies the consequence through tools:
   - hit → **new `damage_enemy` tool**: `{ amount, reason }`; the engine reads
     `enemyHp`, clamps to `0..enemyMaxHp`, writes it, and writes one `combat`
     `roll-logs` row naming the enemy, so the banner, the feed and the enemy's
     HP move together;
   - miss → the existing `modify_character_hp` with a negative delta, clamped by
     the action the GM already uses.
5. `enemyHp === 0` satisfies the scene's `exit: 'defeat'` condition
   ([ADR 0023](./0023-campaign-reset-and-scene-progression.md); the GM may then
   advance the scene.

`damage_enemy` refuses when the scene has no enemy (`enemyName` empty or
`enemyMaxHp <= 0`), clamps rather than trusting the model, and is gated to the
chat turn like the other GM writes (ADR 0022). There is no attack action, no
initiative, no turn order, no round counter, no conditions. "Latest message wins"
still governs who the GM answers (ADR 0012).

## Consequences

- **Positive:** the player's agency is language, which is the product; every
  number in a fight is engine-computed and appears in a record before it appears
  in prose; no new columns, no new action surface, no player HP path.
- **Negative:** a player who does not narrate does not fight — there is no
  discoverable button, so the demo script has to say "I attack". The model can
  still pick a damage amount that feels unfair; it is clamped and logged, and the
  number is visible in the feed.
- **Follow-up:** if a future build wants an attack affordance, it is a chip that
  *writes the sentence* into the composer, not an action — the conversation stays
  the interface.

## Alternatives considered

- **`attackEnemy` action + sheet button.** Rejected in review: it replaces the
  table's interface (narration) with a game menu, and it needs `enemyAc` and
  `enemyDamage` columns for numbers the scene DC and the model's inputs already
  cover.
- **Narrative-only combat (the GM calls `modify_character_hp` for both sides).**
  Rejected: enemy HP would be prose-only, with no record for the defeat
  condition to read.
- **Initiative and rounds.** Rejected: ADR 0010's cut, and the wedge is a
  simultaneous table, not a turn queue.
