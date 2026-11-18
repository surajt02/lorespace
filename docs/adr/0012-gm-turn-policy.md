# 0012 — The GM answers the latest message and auto-resolves rolls

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** AI
- **Constraints:** `P5.5`, `P5.7`, `P4.4` interaction

## Context

With 3-4 humans at one table ([ADR 0008](./0008-playable-interview-build.md)),
something must decide when the GM speaks. Options: strict turn order, an
addressing syntax ("@GM …"), a vote, or the latest message wins. Each roll also
needs a decision: does the player ask the GM to resolve, or does resolution
happen automatically?

Cost matters: owner-billed turns ([ADR 0004](./0004-ai-chat-and-owner-billing.md))
mean every GM turn is the app's money, and measured latency in this category is
3-12s per turn.

## Decision

**The GM answers the latest human message; no turn order and no addressing
syntax.** A resolved roll triggers **exactly one** automatic GM turn carrying the
roll payload, so beat 6 flows into beat 7 without a click. Resolution is capped
at one automatic turn per roll, and nothing else auto-fires.

## Consequences

- **Positive:** the demo flows without choreography, and the table feels live
  rather than turn-based — which is the wedge. Cost per roll is bounded and
  predictable (~$1-2 per rehearsal session).
- **Negative:** a fast typist can monopolise the GM; a player whose action lands
  while the GM is mid-turn waits. With four players the prompt carries four
  characters' names, so attribution depends on `roll-logs` and character names,
  not on who typed last.
- **Follow-up:** `P5.7` owns the automatic turn (synthesise a user message
  carrying the roll result). If a runaway loop appears, the cap is the fix, not a
  queue.

## Alternatives considered

- **Explicit "Resolve my roll" chip only.** Rejected for the demo: it inserts a
  click between beats 6 and 7. Kept as the fallback if auto-resolve misbehaves.
- **Turn order.** Rejected: contradicts "simultaneous table" and adds UI.
