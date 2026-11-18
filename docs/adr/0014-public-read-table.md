# 0014 — The table is public-read by link

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** security / data access
- **Constraints:** `P1.9`, `P2.1`, `P2.2`; schema permissions already shipped in `P2a`

## Context

`P2a` shipped `viewer: read: true` on all four collections, and `viewer` is the
**anonymous** role. So today a signed-out browser can `useQuery` real campaigns,
characters, inventory and roll logs over the public record socket. `P2.1` was
left open to decide whether that is intended.

Two facts pull in opposite directions. The interview link is public, and demo
beat 2 is a *populated* table before sign-in — easiest if the preview reads what
is really there. But "public" also means anyone with the URL reads the party's
sheets, and `inventory` grants `member: delete: true` (any member can delete any
item), since it has no `userId` column.

## Decision

**Keep `viewer` read access; writes stay member/admin.** The signed-out preview
renders **live campaign rows when the seed exists**, and falls back to a bundled
fixture when `campaigns` is empty (nobody has signed in yet, so
`ensureDefaultCampaign` has not run). `inventory`'s permissive delete is
accepted as a demo-scope risk and recorded here rather than re-architected.

## Consequences

- **Positive:** no auth wall between the interviewer and the app; no second
  "preview data" code path to drift from real data; beat 2 shows the real party.
- **Negative:** the party's HP, names and inventory are world-readable to anyone
  with the link, and any signed-in member can delete any inventory row. Neither
  is acceptable for a product; both are acceptable for a 96-hour interview build
  whose entire dataset is two test characters. The fixture fallback is a second
  data shape to keep honest — it must match the schema, not invent fields.
- **Follow-up:** if this ever ships beyond the interview, flip `viewer` to
  `read: false` on `characters`/`inventory`/`roll-logs`, add `userId` to
  `inventory`, and give the preview its own scope (ADR 0006's
  `campaign:preview`).

## Alternatives considered

- **Gate reads and render sample data only.** Rejected for now: costs an hour,
  weakens beat 2, and would need the fixture path anyway.
- **Public read but strip the roster when signed out.** Rejected: half a table
  looks broken, and the roster is the product.
