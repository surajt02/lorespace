# 0031 — Round pacing: stage the table, resolve each action as it comes

- **Status:** Accepted
- **Date:** 2026-11-20
- **Area:** AI / game flow
- **Constraints:** `P5.32`, `P5.33`
- **Supersedes:** [0012](./0012-gm-turn-policy.md) (latest message wins, no turn
  order) and the "address exactly one character per turn" clause of the voice
  rules
- **Complements:** [0029](./0029-roster-parity-and-online-table.md) (the table is
  who is online), [0030](./0030-per-character-check-gate.md)

## Context

The GM answered the newest message and addressed one character. With one player
that reads as a story; with two it reads as a private game that happens to share
a dice log — each player is answered in turn and nobody is ever asked to act, so
the table never feels like a table.

The owner asked for the opposite: **the GM sets the stage for everyone, names who
has not acted, and waits for each of them — while still resolving each action as
it arrives.** "Waiting for each of them" is a fact about state, not a tone of
voice, so it cannot live in the prompt alone.

## Decision

**The engine owns a round; the GM stages it and resolves each action immediately.**

- `campaigns.roundNumber` (number, default 1) is the round; `characters.actedRound`
  (number, default 0) is the last round that character acted in.
- A player's turn marks their own character (`actedRound = roundNumber`) *before*
  the model is called, so the GM never sees a turn from someone it still thinks is
  waiting.
- When every **online** character ([0029](./0029-roster-parity-and-online-table.md))
  has acted in the round, the engine increments `roundNumber`. Nothing else
  advances it: no timer, no idle turn, no GM fiat.
- `get_campaign_snapshot` returns the round and, per character, whether they have
  acted this round and what check they owe ([0030](./0030-per-character-check-gate.md)).
- The GM **stages**: at the start of a round (the opening beat, a scene advance, or
  the reply that closes the previous round) it addresses the players who have not
  acted and asks what they do — naming each of them, not just the last speaker.
  It resolves each answer as it arrives: consequences per action, never held until
  the round completes.
- Single-player is unchanged in feel: a round of one is staged once, resolved, then
  staged again on the next turn.
- **Waiting is prose.** There is no banner, no disabled composer, no "waiting on X"
  chrome; the GM simply asks. That keeps the table's voice in one place and avoids
  a UI that contradicts the fiction.

## Consequences

- **Positive:** every online player is asked to act each round; the GM cannot
  quietly run a solo game in a shared thread; resolution stays snappy because it is
  per action rather than per round; and the round is verifiable (a test can assert
  who was asked).
- **Negative:** a player who never answers holds the round open — the others are
  still resolved per action, but `roundNumber` will not advance, so "who has
  acted" can drift from the fiction; a player joining mid-round is asked on the
  next GM turn (their `actedRound` is behind, so they count as waiting); and the
  prompt grows, which fights the brief's word budget.
- **Follow-up:** expiring a round after inactivity, or letting the GM close a round
  explicitly, would be a new decision. Not taken here — an unanswered round is
  better than a turn timer that acts for people.

## Alternatives considered

- **Prompt-only staging.** Rejected by the owner (and by us): unenforceable, and it
  fails silently in exactly the way the missed `request_check` did.
- **Strict initiative order with a visible queue.** Rejected for now: it makes the
  table wait on one person at a time and needs UI the owner explicitly does not
  want.
- **Hold all consequences until the round completes.** Rejected by the owner:
  resolution per action is what keeps the table moving.
