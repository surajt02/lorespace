# 0010 — Rules depth: six attributes and nothing else

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** game mechanics
- **Constraints:** `P3.1`, `P3.5`, `P5.5`; schema already shipped in `P2a.2`

## Context

The shipped `characters` schema has six ability scores, `hp`/`maxHp`, `ac`, and
an archetype. The plan mentions derived modifiers and DC checks but nothing
further. A d20 system invites more: skills, saves, proficiency, conditions,
initiative, XP, spells.

Every one of those costs schema columns, sheet UI, GM prompt surface, and test
coverage — in a 96-hour build ([ADR 0008](./0008-playable-interview-build.md)),
against an eight-beat demo script that only needs *one ability check against one
DC*.

## Decision

The rules are: **six ability scores → modifiers → a d20 + modifier against a DC**,
plus AC, HP/maxHP, one active enemy with name/HP/maxHP, and a scene DC. Nothing
else — no skills, saves, proficiency, conditions, initiative, levels, XP, spells,
or equipment modifiers. The model narrates everything the rules do not cover.

## Consequences

- **Positive:** the whole system is `src/lib/d20.ts` and four columns, testable in
  one file. The sheet is one panel. The GM prompt stays short enough to be fast.
- **Negative:** a player asking "do I have advantage?" or "what are my skills?"
  gets prose, not mechanics. Combat is coarse: attack, damage, HP.
- **Follow-up:** any extension is an ADR, not an increment — the moment
  conditions exist, the GM prompt and the classifier both grow.

## Alternatives considered

- **5e-lite** (skills + saves + conditions). Rejected: doubles the surface for
  beats the demo never reaches.
- **SRD-faithful.** Rejected: months of work and licensing surface.
