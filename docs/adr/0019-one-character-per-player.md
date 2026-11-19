# 0019 — One character per player; delete-and-reforge is the reset

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** product
- **Constraints:** `P3.15`, `P4.1`-`P4.3`, `P5.3`
- **Relates to:** [0008](./0008-playable-interview-build.md), [0018](./0018-character-deletion.md)

## Context

`characters` already carries `uniqueOn: ['userId','campaignId']`, so the schema
allows one row per player per campaign. The question came up while adding a
delete option: should a player be able to keep several characters and pick one?

Everything downstream assumes a 1:1 mapping: `/home` resolves *the* viewer's
character for the sheet, the presence payload (`P4.1`) broadcasts one
`characterId`, the roster join (`P4.3`) treats a character as a seat, and the GM
targets a `characterId`. Supporting several would add an "active character"
notion (a column or a settings row), a picker UI, and a rule for which one
presence and the GM see — none of which serves an eight-beat demo.

## Decision

**One character per player per campaign.** The `uniqueOn` constraint and the
Forge's `already_forged` refusal stay. To try another archetype, delete the
character ([ADR 0018](./0018-character-deletion.md)) and forge again.

## Consequences

- **Positive:** the sheet, roster, presence payload and GM target keep one
  obvious referent; no selection state to sync or to explain in the demo.
- **Negative:** no alts, no character history; a player who wants to keep a
  build cannot branch. Deletion is the only reset and it is permanent.
- **Follow-up:** multiple characters is an ADR plus a schema/UX change
  (active-character marker, picker, presence re-broadcast), not a flag.

## Alternatives considered

- **Several with an "active" flag.** Rejected for this build: new column, new
  selection UI, and presence/GM rules for a feature no demo beat uses.
- **One per campaign but several campaigns.** Cut by ADR 0008 (no campaign
  browser).
