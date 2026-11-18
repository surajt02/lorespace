# Architecture Decision Records

Decisions that shape LoreSpace and that may change as the app grows. The plan
(`../high-level-plan.md`) says what we intend to build; an ADR records **why**
we chose a particular way, so a later session can tell a deliberate choice from
an accident.

## Conventions

- **One decision per file**, named `NNNN-kebab-case-title.md`, numbered from
  `0001` and never reused.
- **Never rewrite an accepted ADR.** Decisions change over time: write a new
  ADR that supersedes the old one and set the old one's `Status` to
  `Superseded by NNNN`. History stays readable.
- **Status** is one of: `Proposed` (open, needs a call), `Accepted`,
  `Rejected`, `Deprecated`, `Superseded by NNNN`.
- Start from [`template.md`](./template.md).
- Link the ADR from the task it constrains in [`../tasks.md`](../tasks.md)
  (e.g. `(ADR 0003)`) and add a row to the index below.
- Keep it short: context, decision, consequences. If an ADR needs more than a
  screen, it is probably two decisions.

## Index

| ADR | Title | Status | Area |
| --- | --- | --- | --- |
| [0001](./0001-schemas-before-ui.md) | Schemas before UI | Accepted | sequencing |
| [0002](./0002-installed-sdk-is-authority.md) | Installed SDK is the authority, not the plan's version | Accepted | platform |
| [0003](./0003-roll-log-timestamp-column.md) | `rolledAt`, not `createdAt`, on roll logs | Accepted | data model |
| [0004](./0004-ai-chat-and-owner-billing.md) | Install `ai-chat` and bill the app owner | Accepted | AI |
| [0005](./0005-dice-roll-authority.md) | Dice rolls are computed server-side | Accepted | game integrity |
| [0006](./0006-presence-room-authorization.md) | Campaign presence room is membership-gated | Accepted | realtime |
| [0007](./0007-default-campaign-trigger.md) | Default campaign seeded by a client-triggered action | Accepted | data model |
| [0008](./0008-playable-interview-build.md) | Playable interview build in 96 hours | Accepted | product |
| [0009](./0009-engine-owns-outcomes.md) | Engine owns outcomes, the model supplies inputs | Accepted | game integrity |
| [0010](./0010-rules-depth.md) | Rules depth: six attributes and nothing else | Accepted | game mechanics |
| [0011](./0011-content-arc.md) | One scaffolded arc, no content library | Accepted | content |
| [0012](./0012-gm-turn-policy.md) | GM answers the latest message, auto-resolves rolls | Accepted | AI |
| [0013](./0013-visual-register.md) | Visual register: Diablo-ward pixel chrome | Accepted | UI |
| [0014](./0014-public-read-table.md) | The table is public-read by link | Accepted | security |
