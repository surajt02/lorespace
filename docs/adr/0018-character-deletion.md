# 0018 — Deleting a character removes its items first, in one owner-only action

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** data integrity
- **Constraints:** `P3.15`, `P3.16`
- **Relates to:** [0015](./0015-server-authored-character-state.md)

## Context

Members cannot delete character rows (ADR 0015 made `characters` read-only to
them), and the product needs a way to undo a Forge so a player can try another
archetype. Inventory rows point at a character by `characterId` as **metadata
only** — the SDK's `reference` interpretation creates no foreign key and no
cascade — so deleting a character would leave its kit behind, invisible and
undeletable from any UI.

## Decision

**`deleteCharacter({ characterId })`** — a bearer action that requires
`characters.userId === ctx.userId` and the default campaign:

1. drains the character's `inventory` rows with paged
   `tools.deleteWhere('inventory', { characterId })` (100 per call, repeat while
   a full page comes back);
2. then removes the `characters` row.

Items first, so a failure leaves a character whose pack is empty and can be
re-forged, rather than orphan rows nobody can reach. There are no transactions:
an inventory failure reports `write_failed` with stage `inventory` and the
character untouched; a character failure reports stage `character` with
`applied: ['inventory']`.

The settings page lists the caller's characters under a **Characters** header
with a `Delete <name>` button and a confirm dialog naming the character. `/home`
then shows Forge again because the sheet is query-driven.

## Consequences

- **Positive:** one reset path, owner-checked, with no orphans. The Forge flow
  stays the only creation path.
- **Negative:** a partial failure can cost a player their kit while keeping the
  character (`write_failed` reported honestly); items are gone before the row,
  so the window is one write. Deletion is permanent — the UI says so.
- **Follow-up:** if inventory ever gains a writable owner field, item deletion
  could move back to the client; it should not.

## Alternatives considered

- **Client `removeConfirmed` on both collections.** Rejected: characters are not
  member-deletable, and a two-call client cascade can half-complete with no
  server report.
- **Character first, items after.** Rejected: it orphans loot, and nothing can
  reach an item whose character row is gone.
- **Soft delete (`deletedAt`).** Rejected: schema cost and every reader would
  need the filter, for a demo reset button.
