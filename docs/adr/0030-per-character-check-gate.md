# 0030 — The check gate belongs to the character, not the campaign

- **Status:** Accepted
- **Date:** 2026-11-20
- **Area:** game mechanics / AI
- **Constraints:** `P5.31`
- **Supersedes:** the storage clause of [0028](./0028-one-dc-per-action.md)
  (`pendingCharacterId` / `pendingStat` / `pendingDc` on `campaigns`)
- **Keeps:** everything 0028 decided about *semantics* — one DC per action, only
  the requested roll counts, the wrong stat refused before the die

## Context

The pending check was one slot on the campaign row. That is fine for one player
and wrong for two:

- Player A's check blocks player B: B's sheet reads "another adventurer must roll
  WIS" and every one of B's cards is inert.
- Player B's check overwrites A's, so A's request disappears without either being
  rolled.
- A check that fails to clear leaves the table armed until someone else's ask
  lands — the only thing that visibly fixes it is another player being asked.

The gate is a statement about **one sheet** ("this character owes this roll"), so
storing it once for the whole table was the mistake.

## Decision

**Each character carries its own pending check.**

- `characters` gains `pendingStat` (one of the six abilities or empty) and
  `pendingDc` (number, 0 when nothing is pending). The campaign's three columns are
  dropped; `pendingCharacterId` is no longer needed because the row *is* the
  character.
- `request_check({ characterId, stat, dc })` writes those two columns on that
  character. It still writes no `roll-logs` row: a request is not an outcome.
- `rollSkillCheck` reads **the caller's own character row**. A pending check on
  another sheet is invisible to it and cannot gate the caller. A mismatch still
  answers `roll_not_requested` before the die and before any write.
- The clear is part of the resolution, both on success **and on failure** — a
  failed check has been answered too. It is reported in `details` when it fails,
  and the roll still stands (a roll is never lost to a bookkeeping write).
- `startCampaign` clears every character's pending check with the scene, HP,
  packs and log; an accepted scene advance clears the whole party's.
- The sheet reads the viewer's own row (highlight + label), and the banner shows
  the viewer's DC. Another player's outstanding check is not the viewer's problem
  and never dims their cards.

## Consequences

- **Positive:** two players can each owe a roll at the same time; nobody is
  blocked by another's ask; a stale check on one sheet cannot strand the table;
  and the server check becomes a pure per-row read (no join to the campaign).
- **Negative:** one more additive column pair per character row; the campaign row
  no longer answers "who is being asked for what" in a single read, so the GM's
  snapshot must project each character's pending state instead; and a player who
  leaves with a check outstanding keeps it on their sheet until a reset or a
  scene advance (recorded with `P5.29`).
- **Follow-up:** the *round* state ([0031](./0031-round-pacing.md)) is the natural
  place to expire an unanswered check ("the moment passes"), but that is a rules
  decision and is not taken here.

## Alternatives considered

- **Keep one slot, add a queue.** Rejected: a queue of gates is still one gate,
  and it serialises players who could act in parallel.
- **Key the campaign columns by character id** (`pending.byCharacter[recordId]`).
  Rejected: an untyped map in a column that already has an owner row is a
  denormalisation with no benefit.
- **Client-side gate only.** Rejected: the server must enforce it, or the gate is
  decoration.
