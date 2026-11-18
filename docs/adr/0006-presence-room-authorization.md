# 0006 — Campaign presence room access

- **Status:** Proposed
- **Date:** 2026-11-18
- **Area:** realtime
- **Constraints:** `P4.1`, `P4.2`; open decision `D4` in `docs/tasks.md`

## Context

`/ws/presence/:scopeId` requires no token, applies no `resolveAppRole` gate, and
performs no validation on the scope id — unlike the canvas and cron routes,
which resolve a role first. An anonymous client can open
`/ws/presence/campaign:default-campaign`, receives an `anon-<uuid>` user id, and
can read and emit peer state. Peer state itself is unbounded and unsanitized:
`updateState` merges arbitrary keys and broadcasts them to every peer.

So the roster must either tolerate anonymous peers (they never join to
`characters`, so they appear as ghosts or get filtered) or the route needs a
membership gate.

## Decision

**Unresolved.** Options:

1. **Filter client-side.** Accept anonymous peers at the socket, drop
   `isAnonymousUserId` entries from the roster. Zero server change; signed-out
   visitors can still observe broadcast payloads.
2. **Gate the route.** Add a membership check to `wsRoute`'s `extraIdentity`
   hook for `/ws/presence/*`. One-line insertion point, but it makes presence
   unavailable in the signed-out preview unless the preview uses a separate
   scope.
3. **Both.** Gate the campaign scope, keep an unauthenticated preview scope
   (`campaign:preview`) for the marketing surface.

## Consequences

Because presence payloads carry `characterName`, `archetype` and `lastRoll`,
option 1 leaks campaign activity to anyone who guesses the scope string. Option
3 is the only one that keeps the preview working while closing that leak.

## Alternatives considered

Not yet — decide at `P4.1`, before the roster contract is written.
