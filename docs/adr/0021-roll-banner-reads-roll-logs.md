# 0021 — The roll banner reads `roll-logs`; presence carries identity only

- **Status:** Accepted
- **Date:** 2026-11-19
- **Area:** realtime / game integrity
- **Constraints:** `P4.1`, `P4.4`, `P4.5`, `P4.10`, `P4.13`, `P4.17`; supersedes
  the broadcast clause of [0005](./0005-dice-roll-authority.md) and narrows the
  payload of `P4.1`

## Context

Phase 4 shipped [ADR 0005](./0005-dice-roll-authority.md) as written: the
server computes the roll, then the client broadcasts the returned payload over
presence and every peer renders that payload as a banner. Durable first,
ephemeral second. Two problems surfaced in use.

1. **The banner showed a claim, not a record.** A peer's banner rendered
   `characterName`, `rawRoll`, `total` and `outcome` from another browser's
   `updateState` payload. The action is the only writer of `roll-logs`, but the
   banner never read it, so a member could announce any numbers they liked and
   the banner would print them. Presence payloads are also capped and merged,
   which made `lastRoll` a key that outlived the roll it described.
2. **A signed-out window never saw the banner.** Presence is membership-gated
   ([ADR 0006](./0006-presence-room-authorization.md)), so a signed-out tab on
   the same table saw the feed update over the public `roll-logs` read
   ([ADR 0014](./0014-public-read-table.md)) and no banner at all — the same
   roll visible in one surface and absent in the other.

The record layer already solves both: `roll-logs` is written before anything is
broadcast, it is readable by the anonymous `viewer` role, and `useQuery` pushes
new rows to every subscribed window.

## Decision

**The banner's only source is a `roll-logs` row.** `RollBannerLayer` watches the
live `roll-logs` read, takes the first `ready` snapshot as its baseline (so
history is never replayed and no clocks are compared), and announces each new
row once, newest first, filtered to `entryType: 'roll'`. The banner renders that
row's numbers and nothing else.

**Presence carries identity only** — `characterId`, `characterName`,
`archetype`. `lastRoll` is removed from the payload; the ephemeral broadcast of a
roll is retired. The record room *is* the announcement. Presence keeps its job:
who is connected and which sheet to render.

Consequences for who sees what: a signed-in window and a signed-out window on
the same table both announce the same roll, from the same row, without the
signed-out one joining the campaign room — ADR 0006 stands unchanged.

## Consequences

- **Positive:** the banner cannot display a number that no row holds, so the
  last unverified surface in the roll path is gone (ADR 0009's "no consequence
  without a record"). One announcement path instead of three (roller, peers,
  later-joining peers), so it cannot double-fire; the presence payload shrinks
  to three keys; and the signed-out demo table shows the banner, which is what
  the table looks like to the person reviewing it.
- **Negative:** the banner now waits for the row's round-trip through the record
  room instead of being pushed by the room that already has the peer connected —
  in practice the same tick, but the roller's instant feedback is the toast, not
  the banner. A `roll-logs` read failure now silently means "no banners" (the
  feed says so; the overlay cannot).
- **Follow-up:** `P4.1`'s payload text and `P5.9`'s typing indicator both land on
  the identity-only payload; the GM (`P5.7`) can hang auto-resolve on the same
  new-row signal instead of a presence event.

## Alternatives considered

- **Keep the presence broadcast and verify it client-side** (peer fetches the
  row, falls back to the payload). Rejected: two sources that can disagree is
  the bug, and the fallback is exactly the forgeable path.
- **Let anonymous clients join the campaign scope to see the banner.** Rejected:
  reopens ADR 0006 — peer state carries names and activity, which is why the
  scope is gated in the first place.
- **Broadcast a `rollLogId` only, and have peers fetch the row.** Equivalent in
  effect to the decision, but keeps a socket dependency for a row that every
  signed-in window is already subscribed to. Rejected as machinery with no gain.
