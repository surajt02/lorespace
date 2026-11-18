# 0009 — Engine owns outcomes, the model supplies inputs

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** game integrity
- **Constraints:** `P4.4`, `P5.3`, `P5.5`, `src/lib/d20.ts`

## Context

[ADR 0005](./0005-dice-roll-authority.md) settled that dice are computed
server-side. The next question is everything else the GM touches: damage, DCs,
loot, whether someone dies.

The category evidence is one-sided. The GDC 2026 survey of AI-native games:
"constrained creativity wins… the single strongest pattern among AI games that
actually retained players." The best post-mortem in the space (Tableside) ended
at *"the model stopped deciding what happened and was left deciding only how it
read"* — it "could not count, could not roll dice, and could not be trusted to
know when the story should end." A reviewer playing with a model-GM had **every**
roll succeed because the model admitted "subconscious bias in favor of narrative
momentum."

## Decision

**Two-tier split.** The model chooses *inputs* — a DC, a damage amount, an item,
a scene transition — and writes them into records through tools
(`update_campaign_scene`, `modify_character_hp`, `grant_character_loot`). Code
computes every *result*: modifiers, totals, outcome classification, HP clamping,
loot insertion. The GM may never state a consequence that is not backed by a
`roll-logs` row or a record write.

## Consequences

- **Positive:** outcomes are auditable and testable; narration cannot contradict
  state; no sycophancy surface. The prompt gets shorter because arithmetic leaves
  it. `src/lib/d20.ts` is the single classifier for both the action and the AI
  tools.
- **Negative:** the model must route every stake through a tool call before
  narrating, which costs tokens and one round-trip per beat. A model that forgets
  produces prose with no state behind it — the prompt has to enforce the order
  ("tool first, then narrate").
- **Follow-up:** `P5.5` must state the split explicitly, and `P5.3`'s tools must
  validate their inputs (clamp HP themselves) rather than trusting the model.

## Alternatives considered

- **Model adjudicates freely, engine only logs.** Rejected: makes ADR 0005
  pointless and reproduces the failure mode the research documents.
- **Full rules engine** (conditions, saves, initiative, action economy).
  Rejected: a multi-phase project; see [ADR 0010](./0010-rules-depth.md).
