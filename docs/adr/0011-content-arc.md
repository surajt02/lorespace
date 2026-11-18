# 0011 — One scaffolded arc, no content library

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** content
- **Constraints:** `P2.3` seed values, `P5.3` `update_campaign_scene`, demo beat 5

## Context

The GM needs somewhere to stand. Options: a content library (rooms, monsters,
encounters, items), a generator (the model invents everything on demand), or one
hand-seeded arc expressed in the campaign row that already exists.

The `campaigns` schema already holds `locationName`, `atmosphereTag`,
`sceneSummary`, `activeThreatDc`, `enemyName`, `enemyHp`, `enemyMaxHp` — that
is a scene, not just metadata. Seeding one arc costs no new schema and no new UI.

## Decision

**One arc, three scene states, expressed entirely in the existing campaign
columns:** the threshold (exploration, DC 12), the brazier fight (combat, enemy
24/24, DC 14 — the demo's beat 5), and the vault (dungeon, loot, DC 15). The GM
moves between them with `update_campaign_scene`. No maps, no bestiary, no
encounters table, no item catalogue.

## Consequences

- **Positive:** zero schema cost; the same fields drive the top bar, the prompt
  and the demo script, so a scene change is visible on screen instantly. Content
  lives in `ensureDefaultCampaign` where a reader can find it.
- **Negative:** replay value is low and the GM will improvise past the third beat
  unless the prompt tells it to loop or end. A second arc means editing a seed,
  not authoring content.
- **Follow-up:** the prompt must know the three beats by name so beat 5 lands
  reliably.

## Alternatives considered

- **Content library / authoring UI.** Rejected: weeks of work, cut by ADR 0008.
- **Pure generation.** Rejected: without a seed the scene bar is empty on first
  load, which breaks demo beat 2.
