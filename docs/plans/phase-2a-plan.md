# Phase 2a — Data model prelude (schemas only)

- **Status:** Done
- **Session:** 2026-11-18, phase 2a orchestrator session (`/phase 2a`)
- **Governing tasks:** [`P2a.1`–`P2a.8`](../tasks.md#phase-2a--data-model-prelude-schemas-only)
- **ADRs in force:** [0001](../adr/0001-schemas-before-ui.md) (schemas before
  UI), [0002](../adr/0002-installed-sdk-is-authority.md) (installed SDK is the
  authority), [0003](../adr/0003-roll-log-timestamp-column.md) (`rolledAt`, not
  `createdAt`), [0007](../adr/0007-default-campaign-trigger.md) (default
  campaign id / trigger)
- **Depends on:** nothing at runtime. Phase 0 (test accounts, Chromium) is not
  needed: this phase is verified by `tsc` + Vitest (node), not Playwright.
- **Unblocks:** Phase 1 (workspace reads real collections), Phase 2 (`P2.3`
  seeds the campaign id defined here, `P2.4` writes these collections),
  Phase 3 (character/inventory queries), Phase 4 (`roll-logs` writes, presence
  scope derived from the campaign id), Phase 5 (GM tools over these four).

## Goal

Four LoreSpace collections — `campaigns`, `characters`, `inventory`,
`roll-logs` — exist as typed SQLite schemas with a deliberate RBAC matrix,
are registered so both browser and worker see them, pass `lintSchema` with zero
warnings, and the shared `default-campaign` record id lives in one constant.
No UI, no actions, no presence: after this phase the workspace can be built
data-driven once instead of being written twice.

## Definition of done

- [ ] `npm run validate` (`tsc --noEmit` + `vitest run`) passes, and
      `npm run lint` passes.
- [ ] `src/schemas/__tests__/schemas.test.ts` asserts `lintSchema(schema)` is
      `[]` for **every** schema in the `schemas` array from `src/schemas.ts`,
      and `lintSchemas(schemas)` is `[]` (set-level rules).
- [ ] `src/schemas.ts` registers exactly `users`, `settings`, `campaigns`,
      `characters`, `inventory`, `roll-logs` — and none of the messaging
      drop-ins (`CHANNELS_SCHEMA`, `MESSAGES_SCHEMA`, `REACTIONS_SCHEMA`,
      `CHANNEL_MEMBERS_SCHEMA`, `READ_RECEIPTS_SCHEMA`), per `D2`. Asserted, not
      assumed.
- [ ] `DEFAULT_CAMPAIGN_ID` is exported from `src/constants.ts`, and
      `'default-campaign'` appears as a literal only there and in the test that
      pins its value — never in production code outside the constant.
- [ ] `tsc --noEmit` type-checks the new schema files (they are under `src/`,
      so they are inside the project's `include`).
- [ ] No route, action, page or component changed. `git diff --stat` touches
      only `src/schemas*`, `src/constants.ts`, and the new test.

## Scope

**In scope**

- `src/schemas/campaigns-schema.ts` (`P2a.1`)
- `src/schemas/characters-schema.ts` (`P2a.2`)
- `src/schemas/inventory-schema.ts` (`P2a.3`)
- `src/schemas/roll-logs-schema.ts` (`P2a.4`, incl. ADR 0003's `rolledAt`)
- `src/schemas.ts` registration (`P2a.5`)
- `src/schemas/__tests__/schemas.test.ts` (`P2a.6`, `P2a.7`)
- `src/constants.ts` — `DEFAULT_CAMPAIGN_ID` (+ derived presence scope) (`P2a.8`)
- `docs/tasks.md` ticks and the phase board row

**Out of scope (explicit non-goals)** — a reader might expect these here; they
live elsewhere:

- RBAC audit of the matrix, `inventory` delete asymmetry, `ensureDefaultCampaign`
  and `applyGmMutation` → Phase 2 (`P2.1`, `P2.2`, `P2.3`, `P2.4`).
- Any component, `useQuery` call, or the signed-out preview → Phase 1.
- Presence room gating and the roll action → Phase 4 (`P4.2`, `P4.4`).
- Messaging drop-in schemas → deferred until a feature reads them (`D2`).
- AI tools/system prompt over these collections → Phase 5 (`P5.3`, `P5.5`).
- Seeding rows. This phase ships **schemas**, not data: `default-campaign` is a
  constant plus a Phase 2 upsert, and the signed-out preview uses fixtures.
- `deepspace.migrations.json`. 0.44.2 runs DDL at `RecordRoom` init
  (`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN`); the manifest is an
  SDK-behaviour record, not a DB queue. Nothing to add (`P2a.5` watch-out).

## Entry state (verified)

| Thing | State | Where |
| --- | --- | --- |
| `src/schemas.ts` | registers `usersSchema`, `settingsSchema` only | `src/schemas.ts:13-16` |
| `src/schemas/` | `users-schema.ts`, `admin-schema.ts`; no `__tests__/` dir | `src/schemas/` |
| `src/constants.ts` | `APP_NAME`, `APP_ID`, `SCOPE_ID`, `ROLES`/`ROLE_CONFIG` re-export; **no** campaign constant | `src/constants.ts` |
| `src/actions/index.ts` | `export const actions: Record<string, ActionHandler<Env>> = {}` | 4 lines |
| Roles | `ROLES = { VIEWER:'viewer', MEMBER:'member', ADMIN:'admin' }`; `ROLE_ANONYMOUS = 'viewer'` | `node_modules/deepspace/dist/index.d.ts:184-188`, `:731` |
| `'*'` permissions key | Legal (`permissions: Record<string, RolePermissions>`) and **real at runtime**: `getRolePermissions` falls back `permissions[role]` → `permissions['*']` → deny-all | `schema.d.ts:88`; `dist/server.js:4047-4051` |
| `RolePermissions.create` | `boolean` only — `'own'` does not compile | `schema.d.ts:61-69` |
| `ColumnDefinition` | `id?, name, storage:'number'\|'text', interpretation, expression?, userBound?, immutable?, required?, maxLength?, default?, timestampTrigger?{field,value?}` | `schema.d.ts:34-54` |
| `ownerField` / `uniqueOn` | `ownerField?: string`, `uniqueOn?: string[]`; `ownerField` absent ⇒ `'own'` = "created by". `uniqueOn` is enforced twice: the DDL unique index is **warn-only**, the runtime duplicate pre-check is authoritative (hard refusal `Duplicate: a record with … already exists`) | `schema.d.ts:70-88`; `dist/worker.js:843-858` (index) vs `:1635-1654` (runtime) |
| `lintSchema(schema)` | Warn-only, returns `string[]`, **3 per-schema rules**: visibilityField vs `read:true`; `ownerField` column not `userBound` while a role other than literal `owner`/`admin` has `create:true` and `update !== 'unclaimed-or-own'` (so `'*'` and `viewer` both count); `userBound` column with `storage!=='text'`. The **4th rule is set-level** in `lintSchemaSet`, reachable only via `lintSchemas`: `'team'` level with no `team_members` collection. `tasks.md` says "4 rules" loosely — the 4th is not in `lintSchema` | `dist/server.js:4164-4216` |
| Silent override by name | `SchemaRegistry` uses `Map.set`, so a schema named `users`/`canvas-settings` replaces the base schema without error — our four names collide with nothing | `dist/server.js:4223-4238` |
| Vitest | node env; `include: ['prerender.test.ts', 'src/**/*.{test,spec}.{ts,tsx}']`; baseline is **2 files / 3 tests green**; `describe`/`it`/`expect` must be imported explicitly (no `globals` in `vitest.config.ts` or `tsconfig` `types`) | `vitest.config.ts:29-35` |
| `deepspace/worker` under Node | `dist/worker.js` imports no `cloudflare:workers` and touches no binding at module top level; `import('deepspace/worker')` yields 270 exports in plain Node ESM, and a probe test under `src/schemas/__tests__/` compiled and passed | verified empirically this session |
| `lintSchema` import path | exported **only** from `deepspace/worker` (`worker.d.ts:6245`); `deepspace/schema` does not export it | `dist/worker.d.ts:1225` |
| `tsconfig.json` `include` | `["src", "worker.ts"]` — new schema files and the test are type-checked | `tsconfig.json` |
| `deepspace.migrations.json` | 13 SDK migration ids, no collection entries | file itself |

## Contracts

Interfaces later phases inherit. Column names, storage and interpretation are
**exact**; the workspace, the router's `useQuery` calls and the Phase 5 GM tools
all key off them.

### `campaigns` (`src/schemas/campaigns-schema.ts` → `campaignsSchema`)

8 columns:

| Column | storage | interpretation | other |
| --- | --- | --- | --- |
| `title` | text | plain | `required: true` |
| `locationName` | text | plain | `default: 'The Ashen Threshold'` |
| `atmosphereTag` | text | `select: ['exploration','combat','tavern','dungeon','boss']` | `default: 'exploration'` |
| `sceneSummary` | text | plain | `default: ''` |
| `activeThreatDc` | number | plain | `default: 12` |
| `enemyName` | text | plain | `default: ''` |
| `enemyHp` | number | plain | `default: 0` |
| `enemyMaxHp` | number | plain | `default: 0` |

Permissions: `'*'` read-only; `viewer` read-only; `member` read + create +
update (no delete); `admin` all. No `ownerField`, no `uniqueOn`.

### `characters` (`src/schemas/characters-schema.ts` → `charactersSchema`)

13 columns: `userId` (text, plain, `userBound: true`, `immutable: true`,
`required: true`), `campaignId` (text, plain, required), `name` (text, plain,
required), `archetype` (text, `select: ['Vanguard','Shadowblade','Arcanist','Cleric']`,
required), `hp` / `maxHp` / `ac` (number, plain, required), `str` `dex` `con`
`int` `wis` `cha` (number, plain, required).

`ownerField: 'userId'`, `uniqueOn: ['userId','campaignId']` → one character per
user per campaign; ownership cannot be spoofed (`userBound`).

Permissions: `'*'` read-only; `viewer` read-only; `member` read, `create: true`,
`update: 'own'`, `delete: 'own'`; `admin` all.

### `inventory` (`src/schemas/inventory-schema.ts` → `inventorySchema`)

6 columns: `characterId` (text, `reference{targetTable:'characters',
displayColumn:'name'}`, required), `campaignId` (text, plain, required),
`itemName` (text, plain, required), `category` (text,
`select: ['weapon','armor','consumable','relic','quest']`, `default: 'relic'`),
`description` (text, plain, `default: ''`), `quantity` (number, plain,
`default: 1`).

Permissions: `'*'` read-only; `viewer` read-only; `member` read + create +
update + delete; `admin` all.

**Trap:** `interpretation: 'reference'` is metadata only — no FK, no cascade.
The inventory→character join is client-side (`P3.6`); a discarded character does
not remove items. Asymmetry to `characters` (`'own'` writes) is deliberate for
now and reviewed in `P2.2`.

### `roll-logs` (`src/schemas/roll-logs-schema.ts` → `rollLogsSchema`)

12 columns: `userId` (text, plain, `userBound: true`, `immutable: true`),
`campaignId` (text, plain, required), `characterName` (text, plain, required),
`entryType` (text, `select: ['roll','action','gm_event','combat']`, required),
`statName` (text, plain, `default: ''`), `rawRoll` / `modifier` / `total` /
`targetDc` (number, plain, `default: 0`), `outcome` (text,
`select: ['critical_success','success','failure','critical_failure','info']`,
`default: 'info'`), `summary` (text, plain, required), **`rolledAt`** (number,
`datetime`, `timestampTrigger: { field: 'summary' }`).

`ownerField: 'userId'`. Permissions: `'*'` read-only; `viewer` read-only;
`member` read + create + `update: 'own'` + `delete: 'own'`; `admin` all.

**Trap (ADR 0003):** the column is `rolledAt`, not `createdAt`.
`orderBy: 'createdAt'` resolves to the system `_created_at`, so a custom
`createdAt` would be unsortable and redundant. Order by `_created_at`, display
`rolledAt`.

### `src/schemas.ts`

`schemas: CollectionSchema[]` = `[usersSchema, settingsSchema, campaignsSchema,
charactersSchema, inventorySchema, rollLogsSchema]`. Order is not load-bearing.
Messaging drop-ins stay unregistered (`D2`) — adding them later is a one-line
change because 0.44.2 creates tables on DO init.

### `src/constants.ts`

```ts
/** Shared record id for the app's single seeded campaign (P2a.8, ADR 0007). */
export const DEFAULT_CAMPAIGN_ID = 'default-campaign'
/** Presence scope for that campaign — Phase 4 broadcasts here (P4.1, ADR 0006). */
export const DEFAULT_CAMPAIGN_PRESENCE_SCOPE = `campaign:${DEFAULT_CAMPAIGN_ID}`
```

Consumers: `P2.3` (`ctx.tools.create(..., DEFAULT_CAMPAIGN_ID)`), `P4.1`
(`usePresenceRoom(DEFAULT_CAMPAIGN_PRESENCE_SCOPE)`), `P3.3`/`P4.3`
(`where: { campaignId: DEFAULT_CAMPAIGN_ID }`).

### Pure functions

None. This phase adds no runtime logic beyond schema literals and constants.

## Steps

### Step 1 — `campaigns` schema (`P2a.1`)

- Files: `src/schemas/campaigns-schema.ts` (new)
- Change: `export const campaignsSchema: CollectionSchema` with the 8 columns and
  the 4-role matrix in § Contracts. `import type { CollectionSchema } from 'deepspace/schema'`
  (the shape the existing `admin-schema.ts` uses).
- Watch out: `RolePermissions.create` is boolean-only — do not write
  `create: 'own'`. `'*'` is a real fallback key (`server.js:4047-4051`), so
  listing it *and* `viewer` is deliberate redundancy: `viewer` is the anonymous
  role today, `'*'` covers any role added later.
- Proof: `npm run type-check` clean; the file has exactly 8 column entries.

### Step 2 — `characters` schema (`P2a.2`)

- Files: `src/schemas/characters-schema.ts` (new)
- Change: 13 columns, `ownerField: 'userId'`, `uniqueOn: ['userId','campaignId']`,
  `userBound: true` + `immutable: true` on `userId`.
- Watch out: `lintSchema` rule 2 fires on `ownerField` when the column is not
  `userBound` — this is the step that keeps it quiet. `required: true` on
  `userId` is satisfied by the stamp, not by a client value.
- Proof: `npm run type-check`; test in Step 5 covers lint.

### Step 3 — `inventory` schema (`P2a.3`)

- Files: `src/schemas/inventory-schema.ts` (new)
- Change: 6 columns; `characterId` uses
  `interpretation: { kind: 'reference', targetTable: 'characters', displayColumn: 'name' }`.
- Watch out: reference is metadata only — no FK. Do not add a `userId` column;
  ownership runs through `characters` (that is `P2.2`'s subject, not this
  phase's to change).
- Proof: `npm run type-check`.

### Step 4 — `roll-logs` schema (`P2a.4`)

- Files: `src/schemas/roll-logs-schema.ts` (new)
- Change: 12 columns with `rolledAt` (number, `datetime`,
  `timestampTrigger: { field: 'summary' }`) per ADR 0003; `ownerField: 'userId'`
  with `userBound`/`immutable`.
- Watch out: naming the column `createdAt` is the trap ADR 0003 exists to
  prevent; `summary` is `required`, so a hand-seeded row without it gets no
  `rolledAt`.
- Proof: `npm run type-check` + `grep -n "rolledAt" src/schemas/roll-logs-schema.ts`.

### Step 5 — Registration, constant, lint test (`P2a.5`, `P2a.6`, `P2a.7`, `P2a.8`)

- Files: `src/schemas.ts`, `src/constants.ts`, `src/schemas/__tests__/schemas.test.ts` (new)
- Change:
  - `src/schemas.ts`: import + register the four schemas. No messaging schemas.
  - `src/constants.ts`: append `DEFAULT_CAMPAIGN_ID` and
    `DEFAULT_CAMPAIGN_PRESENCE_SCOPE` (see § Contracts).
  - Test, Vitest node env:
    - for each of the six registered schemas: `expect(lintSchema(schema)).toEqual([])`
      and `expect(lintSchemas?.(schemas) ?? [])` — use `lintSchemas(schemas)`
      for the set-level rule;
    - `expect(schemas.map(s => s.name).sort()).toEqual(['campaigns','characters','inventory','roll-logs','settings','users'])`
      → proves `D2` (no messaging drop-ins) and guards accidental duplication;
    - `expect(DEFAULT_CAMPAIGN_ID).toBe('default-campaign')` and
      `DEFAULT_CAMPAIGN_PRESENCE_SCOPE === 'campaign:default-campaign'` → the id
      Phase 4 depends on;
    - **column pins** (added after review, because lint cannot see a rename):
      column counts per collection (8/13/6/12), `characters.ownerField` and
      `uniqueOn`, `characters.userId` `userBound`/`immutable`,
      `inventory.characterId`'s `reference` shape, and `rolledAt`'s
      `timestampTrigger: { field: 'summary' }` plus the absence of a `createdAt`
      column. The permission matrices are **not** asserted here — `P2.1` audits
      them.
- Watch out: import `{ lintSchema, lintSchemas }` from `'deepspace/worker'`
  (verified to load under Vitest's node env; `deepspace/schema` does not export
  them). `lintSchema` is warn-only, so the test — not the SDK — is the gate.
  Import `describe`/`it`/`expect` from `'vitest'` explicitly: neither
  `vitest.config.ts` nor `tsconfig.json` enables globals. The test lives under
  `src/`, so `tsc --noEmit` type-checks it as well.
- Proof: `npm run test:unit` (new test appears and passes), `npm run type-check`,
  `npm run lint`, `grep -rn "'default-campaign'" src/` → `src/constants.ts` plus
  the pinning assertion in the test, never production code elsewhere.

### Step 6 — Verification and handoff

- Files: `docs/tasks.md`, this plan
- Change: tick `P2a.1`–`P2a.8`, phase board rows for 2a and 1, fill § Outcome.
- Proof: the § Verification block below, whole; `git status` shows a clean tree
  after the `phase 2a:` commit.

## Verification

```sh
npm run type-check      # tsc --noEmit, tests excluded from tsc include? see P6.5 — src/ is included
npm run test:unit       # vitest run; the new schemas test is the lint gate
npm run lint            # eslint .
npm run validate        # tsc + vitest, the phase gate
grep -rn "'default-campaign'" src/     # → src/constants.ts + the pinning assertion in the test only
grep -n "rolledAt" src/schemas/roll-logs-schema.ts
grep -c "name: '" src/schemas.ts       # registration sanity (6 collection names)
```

Manual, no browser needed (this phase has no UI):

1. `src/schemas.ts` lists exactly the six collections → the workspace built in
   Phase 1 can `useQuery` all four domain collections.
2. `src/constants.ts` exports `DEFAULT_CAMPAIGN_ID` → `P2.3` can upsert that id.

Gates that must be green this phase:

- `lintSchema(schema)` → `[]` for every registered schema (`P2a.6`).
- `lintSchemas(schemas)` → `[]` (set-level: no `'team'` level without
  `team_members`).
- Registration excludes the five messaging drop-ins (`D2`).
- No `data-theme`, `home pattern:`, or landing-page gate — those are Phase 1's.

## Risks

| Risk | Trigger | Mitigation |
| --- | --- | --- |
| `deepspace/worker` cannot load under Vitest node env (pulls `cloudflare:workers`) | `npm run test:unit` fails on import | Import `lintSchema`/`lintSchemas` from the entry that loads (verify before writing the test); worst case assert the schema literals directly and record the deviation as an ADR |
| A column name drifts from this contract because Phase 3/4 wire `useQuery` names later | Typo, or "improving" `enemyHp`→`hp` mid-phase | § Contracts is the reference; the unit test pins column **counts** per collection, `uniqueOn`, `rolledAt`'s trigger and `userBound`/`immutable` on `characters.userId`. Individual names are not pinned — a rename that keeps the count passes, so § Contracts stays the source of truth |
| `uniqueOn` reads as a DB constraint but the DDL index is warn-only | Duplicate `(userId, campaignId)` rows if the index silently failed to build | The runtime duplicate pre-check is a hard refusal, so duplicates cannot be written through the record layer; `P2.1`/`P3.4` should still treat `Duplicate: …` as a normal failure mode rather than a crash |
| `'*'` + `viewer` redundancy mistaken for a bug and "cleaned up" | Review pass deletes `'*'` | § Contracts and the schema file comments explain that `'*'` is a fallback, not an alias. Nothing asserts the matrix — `lintSchema` never inspects permissions — so the matrix audit is `P2.1`'s, deliberately **not** this phase's gate |
| Registering collections widens the AI/MCP `records.*` reach | Phase 5 audit assumes a narrow set | Recorded in § Outcome as an inherited assumption; `P5.3`/`P5.5` own the prompt/allowlist |
| DDL at DO init on an app that already has a live DO | A deployed DO has no such tables | 0.44.2 runs `CREATE TABLE IF NOT EXISTS` at init; no migration file needed (`P2a.5` watch-out) |

## Open questions

- [x] `'*'` vs `viewer` — settled by reading `getRolePermissions`: `'*'` is a
      real fallback, `viewer` is `ROLE_ANONYMOUS`. Both are listed.
- [x] `createdAt` vs `rolledAt` — settled by
      [ADR 0003](../adr/0003-roll-log-timestamp-column.md).
- [x] Messaging schemas here? — settled by `D2`: no, and the test asserts it.
- [ ] Can Vitest (node env) import `deepspace/worker`? → resolved during Step 5;
      if not, the fallback is recorded here, not in an ADR, because it changes
      no contract.

## Outcome

- **Shipped:** four schema files (`campaigns` 8 columns, `characters` 13,
  `inventory` 6, `roll-logs` 12 with `rolledAt` per ADR 0003), registered as six
  collections in `src/schemas.ts` with the messaging drop-ins deliberately
  absent (`D2`); `DEFAULT_CAMPAIGN_ID` and the derived
  `DEFAULT_CAMPAIGN_PRESENCE_SCOPE` in `src/constants.ts`; the lint gate
  `src/schemas/__tests__/schemas.test.ts` (17 unit tests: lint per schema, set
  lint, registration list, both constants, and column/`uniqueOn` pins for the
  fields Phases 3–5 write by name). `npm run validate` 3 files / 17 tests,
  `npm run lint` clean (0 errors), `npm run type-check` clean, and
  `npm test` 8/8 (smoke+api) — which booted workerd and initialized the
  RecordRoom with the new schema list, the only runtime proof of automatic DDL
  available in this phase.
- **Slipped:** nothing. `P2a.1`–`P2a.8` all ticked.
- **Deviations:** none from the ADRs. Two clarifications recorded in
  `tasks.md` § Verified SDK facts: `lintSchema` has **3** per-schema rules (the
  4th is set-level in `lintSchemaSet`/`lintSchemas`), and `'*'` is a fallback
  key rather than an alias for `viewer`. Neither changes a contract, so no new
  ADR: the plan asked for both keys to be listed, and both are.
- **Inherited by the next phase:**
  - Query/write these collections by the exact column names in § Contracts
    (`campaignId`, `enemyHp`/`enemyMaxHp`, `rolledAt`, `summary`, the six
    attribute names). The unit test pins counts, `uniqueOn`, `rolledAt` and
    `userBound` — not every name, so § Contracts remains the reference.
  - `member` can create a `characters` row but only update/delete its own;
    `inventory` writes are open to every member. That asymmetry is deliberate
    and is `P2.2`'s audit, not a bug to fix in Phase 3.
  - The four collections are now inside the AI/MCP surface automatically:
    `schema.list`/`schema.describe`, the `buildSystemPrompt` schema dump
    (`src/ai/tools.ts:46-74`) and `records.*` reach every registered collection.
    The only guard is each schema's permissions, so Phase 5 must treat the
    permission matrix as part of its prompt/tool design. `inApp` stays false
    (no `ai-chats` schema yet), but local agent routes are already live.
  - `deepspace.migrations.json` needed no entry: 0.44.2 runs
    `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN` at RecordRoom init,
    and DDL is additive only. A later column *rename* is not migratable.
  - `uniqueOn` is a runtime duplicate **refusal** (`Duplicate: … already
    exists`), not a silent index — `P3.4` should surface it as a normal failure.
- **Next:** `/phase 1` — ready. Phase 1 consumes these four collections through
  `useQuery`; `P1.10` keeps components prop-driven so Phases 3/4 swap the data
  source without rewriting markup.

Also update the Status column of this phase and the next one on the phase board
in [`../tasks.md`](../tasks.md), so the board and this file agree. _Done: 2a
`done 2026-11-18`, 1 `next`._
