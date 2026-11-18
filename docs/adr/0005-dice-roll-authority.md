# 0005 — Who computes a dice roll

- **Status:** Proposed
- **Date:** 2026-11-18
- **Area:** game integrity
- **Constraints:** `P4.4`, `P5.5`; open decision `D5` in `docs/tasks.md`

## Context

The plan computes rolls in the browser: `Math.floor(Math.random() * 20) + 1`,
classifies the outcome there, then writes the result to `roll-logs` via
`createConfirmed`. The AI GM is then told to "verify the roll in `roll-logs`"
and narrate the consequence.

That means the AI GM verifies nothing: it reads whatever the client wrote. A
player can write any total they like, and the GM will narrate around it. For a
friendly table this is invisible; for a shared campaign with an authoritative
narrator it is a trust gap that the product copy should not overstate.

## Decision

**Unresolved.** Options:

1. **Client-computed (plan as written).** Simplest, instant, works offline-ish.
   `roll-logs` is a shared record, not a trust boundary — and the code must say
   so rather than implying verification.
2. **Server-computed via an action.** `roll_dice` action rolls and writes in
   one privileged call; presence broadcast becomes a notification. Removes
   cheating, costs a round-trip and moves the ephemeral-path latency.
3. **Server-witnessed.** Client rolls, server records `rawRoll` with its own
   timestamp and a nonce; detect impossible sequences (three nat-20s in a row)
   without blocking normal play.

## Consequences

Whichever wins: decide before `P4.4` writes the classification logic, because
option 2 relocates it out of the component, and before `P5.5` promises the GM
"verifies" rolls.

## Alternatives considered

Not yet — this ADR exists to force the choice at `P4.4`.
