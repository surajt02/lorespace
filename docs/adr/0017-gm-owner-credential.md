# 0017 — GM mutations require the app-owner credential

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** security
- **Constraints:** `P3.10`, `P5.3`, `P5.4`
- **Supersedes:** the "table membership is the authority" clause of
  [P2.4](../tasks.md) (`applyGmMutation`). Complements
  [0004](./0004-ai-chat-and-owner-billing.md) and
  [0015](./0015-server-authored-character-state.md).

## Context

`applyGmMutation` was authorized on table membership: any signed-in caller who
owned a character in the campaign could write HP, grant loot and move the scene
for any character at that table. At the time that was deliberate — ADR 0012 has
no GM seat, so the AI GM "acts for the table".

ADR 0015 then made HP server-authored and accepts only five named steps from a
player. The GM action undoes that: its wire shape takes an arbitrary
`delta` and a target `characterId`, and a player can satisfy the membership
check with their own character. A player can therefore call it directly and set
their own HP (or grant themselves loot), which is exactly the claim ADR 0015
makes about the browser.

The action has no legitimate caller until `P5.3`, so the hole can close now
without breaking anything shipped.

## Decision

**`applyGmMutation` requires `ctx.userId === ctx.env.OWNER_USER_ID`.** Anything
else is refused with `not_gm` before params are parsed, before any read and
before any write. The target-campaign check stays; the membership requirement is
removed, because the owner is not a player (in this build the owner is the
developer) and the GM acts for the table, not from a seat in it.

The AI GM already runs with the owner credential: `streamDeepSpaceAgent` falls
back to `env.APP_OWNER_JWT` when no user token is passed
([ADR 0004](./0004-ai-chat-and-owner-billing.md)), and the GM tools are built
server-side. Player-facing writes are the three owner-scoped actions from
ADR 0015.

## Consequences

- **Positive:** one credential owns every privileged write. A player cannot set
  arbitrary HP, grant loot, or move the scene, through either the UI or the
  action route. The remaining player-facing surface is: Forge, five HP steps,
  Use (server effect), Discard (own rows).
- **Negative:** a human operator cannot call `applyGmMutation` with their own
  session; they need the owner credential (as the agent already does).
  `P5.3`'s tools must continue to run server-side with `APP_OWNER_JWT`; a
  client-side tool call through a player's token would now be refused.
- **Follow-up:** if a human GM seat is ever added, it is a new ADR and a role,
  not a loosening of `not_gm`.

## Alternatives considered

- **Keep membership and validate deltas.** Rejected: a GM needs arbitrary
  deltas, so any delta rule that admits the GM admits the player.
- **Route-level owner gate.** Rejected for now: the action is also reachable
  over MCP/browser tools, so the check belongs in the handler where every
  transport meets it.
- **Owner *or* admin role.** Deferred: no admin seat exists in the product, and
  the agent does not use one.
