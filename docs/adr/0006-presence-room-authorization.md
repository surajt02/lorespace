# 0006 — Campaign presence room is membership-gated

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** realtime
- **Constraints:** `P4.1`, `P4.2`, `P4.5`

## Context

`/ws/presence/:scopeId` requires no token, applies no `resolveAppRole` gate, and
performs no validation on the scope id — unlike the canvas and cron routes,
which resolve a role first. An anonymous client can open
`/ws/presence/campaign:default-campaign`, receives an `anon-<uuid>` id, and can
read and emit peer state. Peer state carries `characterName`, `archetype` and
`lastRoll`, and `updateState` merges arbitrary keys with no size check.

The signed-out preview does not need this socket: per `P1.9` it renders
deterministic sample data.

## Decision

**Gate the real campaign scope behind app membership, and reserve an
unauthenticated `campaign:preview` scope for sample data.** The membership
check is added in `src/server/realtime-routes.ts` at the `wsRoute`
`extraIdentity` hook — the same shape canvas and cron already use — so an
unverified or non-member connection is refused before the room is reached.

The roster still filters `anon-` peers client-side as defence in depth: a
preview peer must never be rendered as a party member even if a scope is opened
up later.

## Consequences

- **Positive:** character names, archetypes, HP and roll activity stop being
  readable by anyone who guesses the scope string. Presence auth matches the
  other realtime routes instead of being the one exception.
- **Negative:** the preview cannot join the campaign scope, so any future
  "watch live players" marketing surface needs its own room
  (`campaign:preview`) and its own fixture payload. The route change is
  server-side, so it is exercised by the `api`/`collab` specs rather than by
  the browser smoke test.
- **Follow-up:** `P4.2` owns the server change; `P4.5` keeps payloads small
  because a compromised member can still broadcast to peers.

## Alternatives considered

- **Client-side filtering only (plan as written).** Rejected: broadcast payloads
  leak to anonymous listeners; filtering only hides ghosts.
- **Remove presence for signed-out users entirely, no preview scope.**
  Viable today, but it forecloses a live preview surface for no gain — the
  preview scope costs one scope string.
