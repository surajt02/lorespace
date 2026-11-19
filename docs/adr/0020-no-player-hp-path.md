# 0020 — Players have no HP write path

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** game integrity
- **Constraints:** `P3.17`, `P4.4`, `P5.3`
- **Supersedes:** the five-step player HP path in
  [0015](./0015-server-authored-character-state.md). Everything else in 0015
  (Forge, Use, inventory ownership, read-only collections) stands.

## Context

ADR 0015 moved HP writes to the server but kept the sheet's `-5/-1/+1/+5/Short
Rest` buttons, with `adjustCharacterHp` accepting exactly those five steps. That
closed the "arbitrary value" hole but not the product one: a player could still
move their own HP at will, and the action stayed callable by any signed-in owner
even with the buttons hidden.

The product rule is simpler: **players do not set HP.** Damage and recovery come
from the game — the AI GM's tools, and items consumed at a cost. A player's HP
is a number they read, like their AC.

## Decision

- Delete `adjustCharacterHp` from `src/actions/index.ts` (and its params schema,
  step table and tests). The registered surface shrinks to:
  `ensureDefaultCampaign`, `applyGmMutation`, `forgeCharacter`, `useItem`,
  `deleteCharacter`.
- Remove the HP controls from `CharacterSheetPanel` (buttons, pending state,
  toast). The sheet shows the bar and `hp/maxHp` only.
- HP changes only two ways:
  1. `applyGmMutation` `character_hp` — owner credential, arbitrary clamped
     delta (ADR 0017);
  2. `useItem` — a consumable heals its fixed amount, spends a charge, and
     refuses at full HP (ADR 0016).
- `characters` stays read-only to members (ADR 0015).

## Consequences

- **Positive:** no player-facing HP surface at all, in the UI or over the action
  route. One writer for story damage (the GM) and one bounded, resource-costed
  writer (items). The trust model is the same as rolls.
- **Negative:** until `P5.3` wires the GM tools, **nothing can lower HP**, so the
  bar is static after Forge and `Use` always refuses at full HP. That is a
  visible gap for Phases 3-4 and belongs in the close-out's "not real yet", not
  in a hidden control.
- **Follow-up:** `P5.3` must use `applyGmMutation` with the owner credential;
  a player-token call is `not_gm`. If a demo needs a manual damage control
  later, it is a new ADR with a real authority behind it.

## Alternatives considered

- **Hide the buttons, keep the action.** Rejected: the route is reachable
  without the UI, so the player path would still exist.
- **Gate `adjustCharacterHp` to the owner credential.** Rejected: then it is
  `applyGmMutation`'s HP kind with extra steps.
- **Keep a "take damage" self-report button.** Rejected by the product rule:
  no player-authored damage.
