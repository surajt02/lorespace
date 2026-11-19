# 0016 — Items have explicit uses: consumables heal, quest items are story

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** game mechanics
- **Constraints:** `P3.1`, `P3.6`, `P3.12`, `P5.3`
- **Amends:** [0010](./0010-rules-depth.md) — its exclusion of item effects is
  narrowed to "healing consumables only"; everything else in 0010 still holds.

## Context

Phase 3 shipped five inventory categories and flavour-first descriptions:
weapons and armor were legible, but `relic` and `consumable` were not. "A thumb
of obsidian that warms when a word is left unspoken" does not tell a player what
the item does, and the UI could consume a vial without changing anything.

At the same time the only character stat in the build is HP/maxHp, so the only
mechanic an item can honestly have is healing, plus "this is a quest object".

## Decision

Four categories, each with one meaning:

| Category | Meaning |
| --- | --- |
| `weapon` | The character's attack weapon. No attack roll exists in this build; the GM narrates hits. |
| `armor` | Light/heavy armor. Its bonus is already baked into `characters.ac` at Forge; it is carried, not equipped. |
| `consumable` | Drink/bind to restore HP. The server applies the heal (`useItem`, ADR 0015), capped at `maxHp`, and spends one charge; at full HP the action refuses. |
| `quest` | A quest object (key, sigil). No mechanical effect, not usable; kept for the story. |

`relic` is dropped; `quest` replaces it. Effects are server-owned data:
`CONSUMABLE_EFFECTS` in `src/lib/d20.ts`, keyed by item name
(`Sunfire Vial → 6`, `Field Dressing → 4`). An unknown consumable is not usable
(`no_effect`) rather than silently doing nothing.

Copy is descriptive first, flavour second: "Small shield. +5 to your AC",
"Drink to restore 6 HP, up to your maximum. One use."

## Consequences

- **Positive:** a player can tell what every item does from its row; Use is a
  real, bounded outcome; the heal number lives once, on the server.
- **Negative:** new consumables need an entry in `CONSUMABLE_EFFECTS` before they
  work, including GM-granted ones (`P5.3`). Item effects are still not data on
  the row, so an author cannot add a new effect without a code change.
- **Follow-up:** if loot becomes authorable, move `effect` onto `inventory` and
  delete the name-keyed table.

## Alternatives considered

- **Keep items flavour-only.** Rejected by review: "consumable" then promises a
  mechanic the build does not have.
- **Add `effect`/`heal` columns now.** Deferred: one extra column plus a
  migration for two known items is machinery ADR 0008's budget does not need.
- **Heal via a client write.** Rejected: that is the hole ADR 0015 closes.
