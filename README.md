# LoreSpace

A real-time, multiplayer d20 tabletop where a party and an AI Game Master share
one live campaign — one table, one dice log, one source of truth.

**Live:** <https://lorespace.app.space>

![LoreSpace landing page: pixel d20 hero and Enter the table](/docs/assets/landing.png)

## What it is

LoreSpace is a shared virtual tabletop: players forge a d20 character, declare
actions, and roll against the scene's stakes while every browser stays in sync
over a Durable Object record room. An AI Game Master narrates, sets a DC, and
mutates persistent state through server-side tools — but it never invents a die
roll. Dice are computed on the server ([ADR 0005](docs/adr/0005-dice-roll-authority.md)),
outcomes are owned by the engine ([ADR 0009](docs/adr/0009-engine-owns-outcomes.md)),
and the table is readable by link, signed in or out
([ADR 0014](docs/adr/0014-public-read-table.md)).

## The table

Signed out, `/home` is the whole table: the live campaign's scene, party roster,
dice feed, GM console and the first character's sheet. It is the same campaign
rows a signed-in player sees, with a sign-in banner in place of the composer.

![Signed-out table: scene banner, party roster, dice feed, character sheet and inventory](/docs/assets/table-signed-out.png)

Signed in, a player forges one adventurer (six attributes, AC, HP, a pack) and
takes a seat. When the GM asks for a check, that ability lights up on the sheet;
rolling it writes a `roll-logs` row that every window renders — the roller from
the action's response, peers from the records socket, and the banner from the
newest log row. Presence carries identity only, never roll data
([ADR 0021](docs/adr/0021-roll-banner-reads-roll-logs.md)).

![Signed-in table: the shared GM thread, requested check and live party](/docs/assets/table-signed-in.png)

## How the sync works

- **Records** live in a campaign-scoped Durable Object `RecordRoom`. A write
  (a forge, a roll, an HP change) broadcasts the changed row to every subscribed
  browser, so windows converge without polling or reloads.
- **Presence** is a second, membership-gated room
  ([ADR 0006](docs/adr/0006-presence-room-authorization.md)). It carries who is
  at the table, their character identity and a typing flag — nothing that can
  disagree with the database.
- **The GM** runs one streamed turn per beat. Its write tools are confined to
  the in-app chat turn ([ADR 0022](docs/adr/0022-gm-tools-confined-to-chat-turn.md)),
  and every consequence is a record write (`combat` or `gm_event` in
  `roll-logs`), so the prose can never claim a number the engine did not store.
- **The table is public-read by link** ([ADR 0014](docs/adr/0014-public-read-table.md)):
  `viewer` can read the campaign; writes stay member-only.

The app's data model is nine collections: `campaigns`, `characters`,
`inventory`, `roll-logs`, `gm-messages`, `settings`, `users`, plus the AI chat
pair `ai-chats` / `ai-messages`.

## Run it locally

```sh
npm install
npx deepspace dev start     # vite + miniflare on http://localhost:5173
```

Local sign-in note: use Chrome. Safari refuses the `__Secure-` session cookie on
`http://localhost`; it works on the deployed HTTPS URL. Sign-in uses the
DeepSpace platform account (`npx deepspace auth login`). The schema and default
campaign are created automatically at first boot — there is no migration step.

## Verify

```sh
npm run type-check          # tsc --noEmit, including tests/
npm run lint                # eslint
npm run test:unit           # Vitest (schemas, d20, GM tools, pending checks)
npm run test:e2e            # smoke + api + collab + presence (Playwright)

node scripts/live-smoke.mjs             # one pass against the deployed URL
node scripts/live-smoke.mjs --rehearse 3 # three timed demo rehearsals
```

`npm test` runs only `smoke` and `api`; the multi-window specs need
`npm run test:e2e`. Multi-user specs require two cached DeepSpace test accounts
(`npx deepspace test accounts recover --all`) and a CLI login for the owner-only
check request. The live script also spends owner-billed GM tokens.

## Where things are

| Path | What |
| --- | --- |
| `src/pages/index.tsx` | static, prerendered landing page |
| `src/pages/(app)/home.tsx` | the three-column campaign table |
| `src/components/` | panels (`CharacterSheetPanel`, `InventoryPanel`, `vtt/*`) |
| `src/schemas/` | the nine collections + RBAC |
| `src/actions/` | privileged server actions (forge, roll, GM mutation, reset) |
| `src/server/realtime-routes.ts` | record and presence room gates |
| `src/ai/` | GM tools, system brief, streamed chat route |
| `src/lib/preview-data.ts` | signed-out fixture, used only when the table is empty |
| `docs/adr/` | the decisions behind the shape (start with 0005, 0009, 0014) |
| `docs/tasks.md` | the phase board and what is done |

## Status

Built to the 96-hour interview spec in [ADR 0008](docs/adr/0008-playable-interview-build.md).
Phases 1–6 are done: pixel shell, server-authored characters, presence and
server-computed rolls, the streamed AI GM with engine-gated scenes and narrative
combat, and a deployed build with a multi-window Playwright suite. The repo is
the deliverable; `docs/tasks.md` is the honest board.
