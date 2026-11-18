# 0005 — Dice rolls are computed server-side

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** game integrity
- **Constraints:** `P3.1`, `P4.4`, `P4.6`, `P5.5`

## Context

The plan computes rolls in the browser: `Math.floor(Math.random() * 20) + 1`,
classifies the outcome there, then writes the result to `roll-logs` via
`createConfirmed`. The AI GM is then told to "verify the roll in `roll-logs`"
and narrate the consequence.

That means the AI GM verifies nothing: it reads whatever the client wrote. A
capable client can submit any total, and the GM will narrate around it — so the
product claim and the mechanics diverge. It also duplicates classification logic
(roller and GM tools) and makes roll history untestable.

## Decision

**Every roll is computed and classified by the server.** A dedicated action
(`rollSkillCheck` in `src/actions/index.ts`) takes
`{ characterId, campaignId, statName }`, verifies the caller owns the character
(per-record RBAC is off inside actions), rolls with `crypto.getRandomValues`,
classifies through the pure helpers in `src/lib/d20.ts`, writes the
`roll-logs` row, and returns the full payload
`{ rawRoll, modifier, total, targetDc, outcome, rollLogId }`.

The client then broadcasts that authoritative payload over presence. The
plan's dual path stays dual, but reordered: **durable before ephemeral**
(Path B, then Path A). The browser never generates or supplies a result.

## Consequences

- **Positive:** `roll-logs` is evidence rather than a claim, so the GM's
  "verify the roll" step is real. One classification implementation, shared with
  the GM tools. Deterministic tests: seed or inject the generator and assert
  crit/fail boundaries in `src/lib/d20.ts`. Signed-out visitors cannot roll,
  which is correct — the preview is sample data.
- **Negative:** one round-trip before the banner instead of instant local
  rendering (sub-200ms on a warm DO; acceptable). The action needs a bearer
  token and a resolved campaign. If the presence broadcast fails after the write
  succeeds, the feed shows the roll and peers miss the banner — that divergence
  is accepted and must not trigger a retry, because a retry would roll twice.
- **Follow-up:** `P4.4` is rewritten by this decision. `src/lib/d20.ts` must
  stay DOM-free so worker code can import it. `P5.5` may now describe the GM as
  verifying a server-computed roll.

## Alternatives considered

- **Client-computed (the plan as written).** Rejected: makes the GM's
  verification decorative, duplicates classification, and leaves history
  forgeable.
- **Server-witnessed nonce.** Client rolls, server records a nonce and flags
  impossible sequences. Rejected: extra machinery that still leaves the roll
  itself outside the record layer.
