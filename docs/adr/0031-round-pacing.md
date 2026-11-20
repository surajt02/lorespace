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
- **The GM answers once per completed round** (amended 2026-11-20 after live
  play). A player's message is persisted and marks them as acted, but the model is
  called only when the round is complete — the last player's message is what
  triggers the turn, and the GM answers every action in the batch together. A
  second message from someone who already acted joins the batch and waits.
- **A roll is not a move, but rolls batch.** A resolved check and an engine beat
  (the opening, a scene advance, the missed-check correction) always get an
  immediate turn; only real player messages are gated on the round.
- **Amended 2026-11-20: one roll turn per batch, owned by the server.** Two
  players rolling produced several turns out of order — one per roll, fired by
  every open window, since the trigger was client-side with a per-window dedupe.
  Now a roll turn waits while any character still owes a check, and the route
  claims the batch with a `lastRollTurnAt` cursor before streaming, so exactly one
  turn runs and it carries every roll resolved since the previous one. The GM
  narrates each roll only for its own roller and never advances a character whose
  roll is not in the batch.
- There is no timer: a round closes when every online character has acted. The
  table assumes everyone is playing, so a silent window holds the story rather
  than being resolved on someone's behalf.
- Single-player is unchanged in feel: a round of one is staged once, resolved, then
  staged again on the next turn.
- **Waiting is a UI indicator, not prose.** Amended 2026-11-20 after live
  multiplayer play: the GM naming the players who owe a move made every mid-round
  reply repeat the table's state, and the chat bloated. The console now shows
  `AWAITING YOUR MOVE…` to the player whose `actedRound` is behind `roundNumber`,
  and the GM no longer reminds anyone to act — it answers the action in front of
  it. This reverses the original "waiting is prose" clause; the owner asked for
  the indicator after playing with two windows.

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
