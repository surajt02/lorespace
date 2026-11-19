# 0015 — Character state is server-authored

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** game integrity
- **Constraints:** `P3.4`, `P3.5`, `P3.6`, `P3.10`-`P3.13`, `P5.3`
- **Supersedes:** the client-write half of the phase-3 implementation (not an
  earlier ADR). Complements [0005](./0005-dice-roll-authority.md) and
  [0009](./0009-engine-owns-outcomes.md).

## Context

Phase 3 shipped the sheet with `characters` writable by its owner
(`member.update: 'own'`) and `inventory` writable by any member. HP was written
straight from the browser with `putConfirmed(recordId, { hp })`, and a forged
character was created client-side with client-supplied `hp` and `ac`.

That makes HP a claim, not a fact: a client can set its own row to any HP, heal
itself through `useItem`'s planned effect, or forge a character with 999 HP and
an invented AC. Rolls are already server-owned (ADR 0005), so the table has two
different trust models for two numbers that sit side by side.

## Decision

**Every write that changes a character's stat block is an action.** The record
collections become read-only to members:

- `characters`: `member.create/update/delete` → `false`.
- `inventory`: gains a `userId` column (`ownerField: 'userId'`, immutable) and
  `member.update/delete` → `'own'`; `create` → `false`.
- `src/actions/index.ts` adds three bearer actions that run with per-record RBAC
  off and therefore check ownership themselves:
  - `forgeCharacter({ name, archetype })` — rejects a caller who already owns a
    character in the campaign; writes the character with `userId = ctx.userId`,
    `hp = maxHp`, `ac = calculateArmorClass(dex, armorBonus)` from the preset;
    then the preset's starter items, each stamped with the owner's `userId`.
    Returns `{ characterId, itemsMissing }` — no transactions, so a failed item
    is reported, not rolled back.
  - `adjustCharacterHp({ characterId, step })` — `step` is one of the sheet's
    five buttons (`minus5`, `minus1`, `plus1`, `plus5`, `rest`). The server maps
    the step to a number (Short Rest fills the bar), so a client cannot name an
    arbitrary HP or delta. The caller must own the character
    (`characters.userId === ctx.userId`); clamps `0..maxHp`; writes `hp` only;
    returns `{ before, after, maxHp, appliedDelta }`.
  - `useItem({ itemId })` — the item's character must belong to the caller;
    category must be `consumable`; the heal comes from server-owned data
    (`CONSUMABLE_EFFECTS` in `src/lib/d20.ts`), clamped to `maxHp`; refuses at
    full HP (`at_full`) so a charge is never wasted; decrements quantity or
    removes the row.
- `Discard` stays a client `removeConfirmed`, now safe because inventory rows
  carry `userId` and member delete is `'own'`. No add/edit form (ADR 0008), and
  no member update: renaming is a content write, not a disposal.
- `applyGmMutation` stamps the target character's `userId` on granted loot. Its
  authority moved to the owner credential in
  [ADR 0017](./0017-gm-owner-credential.md).

HP is still *changed* by a player's click; what changes is that the server
computes and writes the result, exactly like a roll.

## Consequences

- **Positive:** the browser cannot write `hp`, `ac`, or `userId` at all. Forge,
  damage/healing and item use share one trust model with rolls. `inventory`
  gains row-level ownership, closing the "any member can delete any item" hole
  recorded in `P2.2`.
- **Negative:** every HP click and every Use is a network round-trip before the
  bar moves; there are no transactions, so a failed second write is reported
  (`write_failed` with `applied`) rather than undone. `useItem` also reads the
  row's `quantity` and writes `quantity - 1`, so two simultaneous calls from the
  owner's own two tabs can spend one charge twice; that is accepted (only the
  owner can race themselves, and there is no conditional-update API).
  `inventory` rows created before this ADR have no `userId` and become read-only
  to members — locally that means re-forging; production had no characters.
- **Follow-up:** `P5.3`'s loot tool must set the owner's `userId` and should use
  item names that exist in `CONSUMABLE_EFFECTS` if the loot is a consumable.

## Alternatives considered

- **Keep HP client-side and validate in the UI.** Rejected: the room API is
  reachable without the UI; a client can write its own row.
- **Server-validated `putConfirmed`.** Rejected: there is no per-field server
  hook, and inventing one for one column is more machinery than three actions.
- **Forge stays a client create with a server hp clamp later.** Rejected:
  creation also writes `ac`, so the same hole reappears one step earlier.
