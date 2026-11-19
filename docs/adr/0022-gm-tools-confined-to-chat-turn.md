# 0022 — GM write tools run only inside the in-app GM chat turn

- **Status:** Accepted
- **Date:** 2026-11-19
- **Area:** security
- **Constraints:** `P5.3`, `P5.11`; complements
  [0012](./0012-gm-turn-policy.md), [0017](./0017-gm-owner-credential.md)

## Context

`P5.3` adds four domain tools to `buildTools`. Two facts collide:

1. Every tool in that `ToolSet` is auto-exposed over `/_deepspace/agent/*` HTTP and
   MCP to any verified app member — not just to the in-app chat panel.
2. The GM tools must write as the app owner, because
   [ADR 0017](./0017-gm-owner-credential.md) refused the caller path: an AI GM
   that mutates HP has no seat and no user credential, so its writes go through
   the owner-credential action (`applyGmMutation`), which ADR 0017 restricted to
   `OWNER_USER_ID`.

Put together, a naive implementation lets a player POST `modify_character_hp`
over MCP and set their own HP — the exact door ADR 0017 closed, reopened one
layer up. The same is true of `grant_character_loot` and
`update_campaign_scene`.

The GM conversation is different. [ADR 0012](./0012-gm-turn-policy.md) has no GM
seat and no turn order: the GM acts for the table, and talking it into a change
is the product. The boundary that matters is therefore not "who may ask the GM"
but "may this be asked of the GM at all, outside a GM turn".

## Decision

**The three GM write tools execute only when the request they were built for is
the in-app chat turn.** `buildTools` receives `AgentToolContext.request`; a write
tool checks `new URL(context.request.url).pathname === '/api/ai/chat'` and
otherwise returns a refusal object (`{ success: false, code:
'gm_tools_chat_only' }`) without reading or writing a record. The read-only
`get_campaign_snapshot` stays available on every surface, because a table read
is already public by link ([ADR 0014](./0014-public-read-table.md)).

Writes continue to run as the owner through a synthetic `ActionContext`
(`userId: env.OWNER_USER_ID`, action tools built for that id) calling the single
`applyGmMutation` implementation — no second clamping or gating rule.

## Consequences

- **Positive:** an MCP or local-agent caller cannot mutate campaign state
  directly, so ADR 0017's "no player HP path" holds across every transport.
  There is still exactly one GM-turn policy (ADR 0012) and one mutation
  implementation.
- **Negative:** a reviewer's local Codex/Claude client can inspect the table but
  not run the GM. Driving the GM means using the app's chat panel. If a
  headless GM demo is ever wanted, that is a new decision with its own
  authorization story, not a path check to relax.
- **Follow-up:** the path check is a string comparison against an SDK-owned
  route. If the SDK renames `/api/ai/chat`, the tools fail closed (every write
  refuses) rather than open — the safe direction, and the tool test pins the
  path.

## Alternatives considered

- **Expose the GM tools to every surface and accept the risk.** Rejected: it is
  the vulnerability ADR 0017 exists to prevent, with a smaller payload.
- **Give GM tools a caller-identity write path with delta validation.**
  Rejected in ADR 0017: any delta rule that admits the GM admits the player.
- **Separate `buildTools` factories per surface.** Cleaner in principle, but
  `registerAgent` builds both surfaces from one factory; splitting it means
  duplicating the SDK's access resolver in app code for a check that belongs to
  the tool.
