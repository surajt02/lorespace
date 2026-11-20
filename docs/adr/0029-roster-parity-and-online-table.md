# 0029 — The party is the roster; the table is who is online

- **Status:** Accepted
- **Date:** 2026-11-20
- **Area:** realtime / AI
- **Constraints:** `P5.28`
- **Complements:** [0021](./0021-presence-carries-identity.md) (presence carries
  identity), [0027](./0027-shared-gm-thread.md) (one thread), [0006](./0006-presence-scope.md)
  (no socket signed out)
- **Supersedes:** the "the GM's party is the caller plus the thread's recent
  speakers" rule of `P5.26`

## Context

Two windows showed two different parties. Signed in, the roster was built from
presence — so an offline character (a party member not connected, or a leftover
test character) vanished. Signed out, it was built from `characters` — so the
same character appeared with a full sheet. Meanwhile the GM addressed whoever
had spoken in the thread, which is not the same set as "who is playing".

That is three answers to one question, and the mismatch is what makes a solo
session feel haunted.

## Decision

**One roster, one liveness field, and one table.**

- The roster is **every character in the campaign**, always, in both windows:
  self, present peers, then absent members. `buildParty` appends a `PartyMember`
  for each unmatched `characters` row with `isOnline: false` (`P5.28`).
- Online-ness is a field, not a filter: `isOnline` is true for you and for peers
  whose socket is open, false for the rest. The roster renders it as a filled dot
  plus a `offline` micro-label, so a present player and an absent one are told
  apart at a glance. Signed out, `online` stays `undefined` — no liveness claim
  without a socket ([ADR 0006](./0006-presence-scope.md)).
- **The GM plays with the online set only.** The presence bar reports the online
  character names upward, the console sends them with every turn, and the route
  filters `get_campaign_snapshot` to the caller ∪ that set. An offline character
  is a name on the roster and nothing more: not addressed, not acted for, not
  waited on. A solo session is therefore a single-player story by construction,
  not by prompt luck.
- The online list is client-supplied, so it is bounded (24 names, 40 chars each)
  and can only ever *narrow* what the model sees; the tool executor still runs as
  the caller, so it cannot widen a read.

## Consequences

- **Positive:** both windows describe the same party; going online is the only way
  to join the story; a solo player is never asked "which of you"; no ghost
  character can be narrated because the roster and the snapshot share one source.
- **Negative:** a player who is offline keeps a stale sheet and HP in the roster
  (it reflects the last write, not live state); a pending check addressed to a
  player who then disconnects leaves the table waiting until they return or
  someone advances the scene; and a client that fails to open its socket plays
  alone even if friends are present.
- **Follow-up:** a pending check whose owner is offline should be takeover-able
  (or auto-cleared) — that is a rules decision, not a display one, so it is not
  decided here.

## Alternatives considered

- **Hide offline members** (previous behaviour). Rejected: the signed-out window
  still listed them, so the two windows disagreed.
- **Let the GM see everyone and trust the prompt.** Rejected: it is the failure
  that produced "Ash" narrating from a private sheet.
- **Server-side presence lookup inside the tool.** Rejected: presence lives in a
  Durable Object room with no server read path in this build; the browser is the
  only place that knows.
