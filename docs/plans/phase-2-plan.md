# Phase 2 — RBAC hardening, server actions

- **Status:** Done
- **Session:** 2026-11-18, phase 2 orchestrator session (`/phase 2`)
- **Governing tasks:** [`P2.1`–`P2.6`](../tasks.md#phase-2--rbac-hardening-server-actions)
- **ADRs in force:** [0002](../adr/0002-installed-sdk-is-authority.md) (installed
  SDK is authority), [0003](../adr/0003-roll-log-timestamp-column.md) (`rolledAt`),
  [0007](../adr/0007-default-campaign-trigger.md) (seed is a client-triggered
  action, idempotent upsert, skeleton not empty state), [0008](../adr/0008-playable-interview-build.md)
  (one campaign, HP/loot/scene only), [0011](../adr/0011-content-arc.md) (one arc,
  three scene states; the seed is the threshold state), [0012](../adr/0012-gm-turn-policy.md)
  (no GM role, latest message wins), [0014](../adr/0014-public-read-table.md)
  (public read; `inventory` delete asymmetry accepted)
- **Depends on:** phase 2a (four registered schemas, `DEFAULT_CAMPAIGN_ID`),
  phase 1 (`/home` shell, `PREVIEW_CAMPAIGN` as the fixture, `POST
  /api/actions/:name` route and `actions` map already wired in `worker.ts`)
- **Unblocks:** phase 3 (a campaign row exists to attach characters to), phase 4
  (roll writes into the same room; presence scope already derived), phase 5
  (`applyGmMutation` is the GM's write path; `DEFAULT_CAMPAIGN_SEED` is the
  scene-beat reference)

## Goal

The table gets a real campaign row. A signed-in player lands on `/home`, the
app seeds `campaigns/default-campaign` once through an authenticated server
action, and the shell renders the live row instead of a fixture — with a
skeleton during the round-trip and a visible failure state instead of a silent
fallback. In the same pass the privileged write path the AI GM will use exists:
`applyGmMutation` changes character HP, grants loot, and moves the scene, with
its own ownership check because `ctx.tools` runs with per-record RBAC off.

## Definition of done

- [ ] `npm run type-check && npm run lint` pass; `npm run test:unit` passes with
      4 files (schemas + actions + prerender-entry + prerender).
- [ ] `POST /api/actions/ensureDefaultCampaign` creates exactly one
      `campaigns` row at id `default-campaign` whose eight columns equal
      `DEFAULT_CAMPAIGN_SEED`, and a second call writes nothing (upsert makes it
      harmless, the guard makes it rare).
- [ ] `POST /api/actions/applyGmMutation` refuses (`success: false`,
      `code: 'no_character'`) a caller with no character in the campaign, before
      any write, and succeeds for a caller who has one.
- [ ] Signed in on an empty database, `/home` shows the seeding skeleton, then
      the live campaign — never the "no campaign" empty state.
- [ ] Signed out, `/home` is unchanged: fixture table, `preview-table` test id,
      no action call, no skeleton.
- [ ] No native `window.confirm|alert|prompt`, no emoji in chrome, no new
      collection, no schema change (`git diff src/schemas*` is empty).

## Scope

**In scope**

- `src/lib/campaign-seed.ts` (new) — `CampaignRow` type + `DEFAULT_CAMPAIGN_SEED`
- `src/lib/preview-data.ts` — consume the seed module instead of duplicating it
- `src/actions/index.ts` — `ensureDefaultCampaign`, `applyGmMutation`
- `src/actions/__tests__/actions.test.ts` (new) — fake-tools unit tests
- `src/lib/actions.ts` (new) — `callAction` client helper (bearer + JSON)
- `src/pages/(app)/home.tsx` — mount trigger, skeleton, failure notice
- `docs/tasks.md` ticks + board status; this file's § Outcome

**Out of scope (explicit non-goals)**

- Character creation, the sheet, inventory UI, d20 math — phase 3 (`P3.*`).
- Rolling, `roll-logs` writes, presence — phase 4 (`P4.4`). `applyGmMutation`
  writes no `roll-logs` row; the GM's evidence is the record write itself
  (ADR 0009), and `rollSkillCheck` owns roll rows.
- The AI GM tools and prompt that will call `applyGmMutation` — phase 5
  (`P5.3`). Phase 2 exposes the action; nothing in the UI calls it yet.
- Any "GM" role or campaign-ownership model. ADR 0008 cuts multiple campaigns;
  ADR 0012 has no turn order or GM seat, so table membership is the only
  authority that exists.
- E2E specs. `P6.2`/`P6.3` own Playwright; this phase's committed gate is
  unit tests plus one throwaway proof run (see § Verification).

## Entry state (verified)

| Thing | State | Where |
| --- | --- | --- |
| Action route | `POST /api/actions/:name`, bearer required (cookie refused), always HTTP 200 + `ActionResult` body; 401/404 are the only non-200s | `src/server/action-routes.ts:45-68` |
| `actions` map | `export const actions: Record<string, ActionHandler<Env>> = {}` — every action 404s | `src/actions/index.ts:4` |
| Action tools | `create/update/remove/deleteWhere/get/query/integration/registerUser`, RBAC **off** (`X-App-Action`), no transactions | `src/server/action-routes.ts:70-160` |
| Client action caller | none anywhere in `src/`; no SDK web wrapper exists (only `native`) | `grep -rn "api/actions" src/` → route only |
| Auth token | `getAuthToken(): Promise<string \| null>` exported from `deepspace` | `node_modules/deepspace/dist/index.d.ts:2106` |
| `/home` campaign read | `useQuery<CampaignRow>('campaigns')`, `status` discarded, silent fixture fallback | `src/pages/(app)/home.tsx:38-43` |
| Seed-of-record | `PREVIEW_CAMPAIGN.data` — threshold state (exploration, DC 12, no enemy) | `src/lib/preview-data.ts:81-97` |
| Sketched seed values in the old plan text | Sunken Reliquary / dungeon / DC 13 / Sentinel 24-24 | `docs/high-level-plan.md` § Phase 2 |

**Conflict resolved before coding:** the high-level plan's literal seed values
(Sunken Reliquary, dungeon, DC 13) match none of ADR 0011's three states, and
`PREVIEW_CAMPAIGN` declares itself the drift guard for `P2.3`. ADR 0011 is the
accepted decision and lists the **threshold** (exploration, DC 12) as state one,
which is also the demo's opening beat. The seed is therefore
`DEFAULT_CAMPAIGN_SEED` = today's `PREVIEW_CAMPAIGN.data`; the dungeon/Sentinel
values are the *third* scene state and arrive through `update_scene`, not the
seed. Recorded as a deviation in § Outcome; no new ADR because no direction
changes — this is ADR 0011's first state, not a new one.

## Contracts

**Data:** no schema change. `campaigns` (8 columns, only `title` required) and
`characters` (13 columns, `ownerField: 'userId'`, `uniqueOn:
['userId','campaignId']`) are as registered in phase 2a. `inventory` rows carry
`characterId` + `campaignId`, no `userId` (ADR 0014's accepted asymmetry).

**`src/lib/campaign-seed.ts`** — the single source for the seeded scene:

```ts
export interface CampaignRow { title; locationName; atmosphereTag;
  sceneSummary; activeThreatDc; enemyName; enemyHp; enemyMaxHp }
export const DEFAULT_CAMPAIGN_SEED: CampaignRow   // = today's PREVIEW_CAMPAIGN.data
export function isAtmosphereTag(value: string): boolean  // schema's select options
```

`preview-data.ts` keeps exporting `CampaignRow` (re-export) and builds
`PREVIEW_CAMPAIGN.data` from `DEFAULT_CAMPAIGN_SEED`, so the fixture and the
seed cannot drift. No React/SDK import in the seed module (worker-importable).

**`ensureDefaultCampaign`** — `POST /api/actions/ensureDefaultCampaign`, no
params. Bearer required (route). Returns
`ActionResult<{ campaignId: string; created: boolean }>`:
`query('campaigns', { limit: 1 })` → empty ⇒
`create('campaigns', DEFAULT_CAMPAIGN_SEED, DEFAULT_CAMPAIGN_ID)` and
`created: true`; non-empty ⇒ `created: false`, no write. Idempotent by upsert;
a tool failure returns `{ success: false, code: 'seed_failed', error }`.

**`applyGmMutation`** — `POST /api/actions/applyGmMutation`, params
`{ mutation }` (zod-validated at the boundary, `zod/v4`):

```ts
type GmMutation =
  | { kind: 'character_hp'; characterId: string; delta: number }          // ±
  | { kind: 'grant_loot'; characterId: string; item: {
        itemName: string; category?: 'weapon'|'armor'|'consumable'|'relic'|'quest';
        description?: string; quantity?: number } }
  | { kind: 'update_scene'; scene: Partial<Pick<CampaignRow,
        'locationName'|'atmosphereTag'|'sceneSummary'|'activeThreatDc'
        |'enemyName'|'enemyHp'|'enemyMaxHp'>> }>
```

Success data: `{ kind, characterId?, hp?: { before, after, maxHp, appliedDelta },
item?: { recordId, itemName, quantity }, scene?: { applied: string[] } }`.
Failure codes: `invalid_params` (zod issues in `issues`), `no_character`
(caller has no character in the campaign — the ownership check, before any
write), `character_not_found` (target missing or in another campaign),
`write_failed` (with `details.stage` and `details.applied`, an ordered
best-effort report because **there are no transactions**).

**Authorization, stated once:** the caller must own a character in
`DEFAULT_CAMPAIGN_ID` (`characters` where `userId === ctx.userId &&
campaignId === DEFAULT_CAMPAIGN_ID`). That proves table membership; the mutation
may then target any character **in the same campaign**, because the AI GM acts
for the table and ADR 0012 gives no player a GM seat. A caller with no character
is refused before any read of the target. Client-side RBAC still restricts
direct `characters` writes to `'own'` (phase 2a), so this action is the only
cross-character write path.

**`callAction`** — `src/lib/actions.ts`:
`callAction<T>(name: string, params?: Record<string, unknown>): Promise<T>`.
`getAuthToken()` → null ⇒ throw `ActionCallError('not_authenticated')`; POST
JSON with `Authorization: Bearer`; non-OK or `success === false` ⇒ throw
`ActionCallError(error, code, status, issues)`; success ⇒ `data`. No retries
(a GM mutation is not idempotent in general).

**`/home` seeding state** — `seedState: 'idle' | 'seeding' | 'seeded' |
'failed'`, `useRef` fired-guard set on dispatch (not on success). Skeleton when
signed in and no live row and (`status === 'loading'` or `seeding`). After
`'seeded'`, render `DEFAULT_CAMPAIGN_SEED` until the subscribed query delivers
the row (the values are equal by construction, so this is not a lie and it
avoids a skeleton that hangs if the subscription lags). `'failed'` renders the
fixture plus a notice (`data-testid="seed-failed"`) — visible, never silent —
and the guard resets on the next mount. Signed-out path untouched.

## Steps

### Step 1 — Seed module + `ensureDefaultCampaign` (`P2.3`)

- Files: `src/lib/campaign-seed.ts` (new), `src/lib/preview-data.ts`,
  `src/actions/index.ts`
- Change: move the eight seed values out of the fixture into
  `DEFAULT_CAMPAIGN_SEED`, have `PREVIEW_CAMPAIGN.data` point at it (same object
  is fine — nothing mutates fixtures), implement the action with
  query-then-upsert and the `{ campaignId, created }` result.
- Watch out: `campaigns` has no `campaignId` column — filter on `recordId`
  only. `create` with a known id is the upsert; do not `update` (never creates).
  Only `title` is required, but send all eight so the row is the seed, not
  schema defaults.
- Proof: `npm run type-check`; step 3's unit test asserts
  `created === false` on the second call and deep-equality of the row with
  `DEFAULT_CAMPAIGN_SEED`.

### Step 2 — `applyGmMutation` (`P2.4`)

- Files: `src/actions/index.ts`
- Change: zod schema for the three mutation kinds; membership check via
  `tools.query('characters', { where: { userId, campaignId } })`; then per kind:
  `character_hp` — `tools.get` the target, verify `campaignId`, clamp
  `0..maxHp`, `tools.update` `{ hp }` and report the applied delta (0 when
  already at a bound); `grant_loot` — same target check, `tools.create`
  `inventory` with `campaignId` forced to the constant and `quantity` default 1;
  `update_scene` — `tools.update('campaigns', DEFAULT_CAMPAIGN_ID, scene)` with
  only the whitelisted keys present in the input, reporting which were written.
- Watch out: no `ctx.request` (context is `{ userId, params, tools, env,
  callerJwt }`); the route always answers 200, so failures are `success: false`
  bodies; no transactions — write in a fixed order, stop at the first failure,
  and return what already landed instead of implying atomicity (comment says so
  in the code). `characters.userId` is `userBound` + `immutable`: never include
  it in an update.
- Proof: step 3's unit test names each case; `npm run type-check`.

### Step 3 — Action unit tests (`P2.6`)

- Files: `src/actions/__tests__/actions.test.ts` (new)
- Change: a fake `ActionTools` (`vi.fn()` per tool) returning canned
  `ActionResult`s and recording calls; call the exported handlers with
  `{ userId, params, tools: fake, env: {} as Env, callerJwt: '' }`. Cases:
  seed empty → creates at `default-campaign` with seed values, `created: true`;
  seed non-empty → no write, `created: false`; seed tool failure → `seed_failed`;
  mutation for a caller with no character → `no_character`, zero writes;
  `character_hp` delta clamps at 0 and at `maxHp` and reports `appliedDelta`;
  `grant_loot` forces `campaignId` and defaults `quantity`; `update_scene`
  ignores `title`/unknown keys; second write failure returns `write_failed` with
  the first write listed in `details.applied`; invalid params → `invalid_params`
  with issues.
- Watch out: Vitest is node-only with the `@` alias (`vitest.config.ts`) — no
  jsdom, no React. Keep the fake's types honest: cast only the tools object, not
  the handler.
- Proof: `npm run test:unit` — the new file is listed and green.

### Step 4 — Client action helper (`P2.5`)

- Files: `src/lib/actions.ts` (new)
- Change: `callAction` + `ActionCallError` exactly as in § Contracts.
- Watch out: `getAuthToken()` returns `null` when signed out — fail with
  `not_authenticated` before fetching; the worker refuses a cookie-only call
  with 401, so a missing token would otherwise surface as a confusing toast.
- Proof: `npm run type-check`; exercised by step 5's throwaway browser run.

### Step 5 — `/home` seed trigger, skeleton, failure notice (`P2.5`)

- Files: `src/pages/(app)/home.tsx`
- Change: keep `status` from `useQuery`; add `seedState` + `useRef`; `useEffect`
  on `[isSignedIn, status, records.length, userId]` dispatching once when
  `isSignedIn && status === 'ready' && records.length === 0 && !guard.current`;
  on success `'seeded'`, on failure `'failed'` + `toast.error(...)`. Render a
  skeleton shell (banner bar + three `pixel-frame` columns with `animate-pulse`
  bars, `data-testid="workspace-skeleton"`) while seeding, and a
  `data-testid="seed-failed"` notice line when failed. Campaign = live row ??
  (`seeded` ? `DEFAULT_CAMPAIGN_SEED` : `PREVIEW_CAMPAIGN.data`).
- Watch out: do not gate the skeleton on `records.length === 0` alone — that
  would break the signed-out preview. `SceneBanner` takes a non-null
  `CampaignRow`, so the skeleton replaces the slot rather than passing `null`.
  No `useQuery` refetch exists; the row arrives over the room subscription, and
  the `'seeded'` fallback covers a lag. Do not add a retry loop — ADR 0007 says
  retry on the next mount.
- Proof: throwaway Playwright run (below) plus manual signed-in check.

### Step 6 — Gates, board, commit

- Files: `docs/tasks.md`, this plan
- Change: tick `P2.3`–`P2.6`, board row `done`, § Outcome; commit `phase 2: …`.
- Proof: full § Verification below.

## Verification

```sh
npm run type-check
npm run lint
npm run test:unit                                   # expect 4 files, all green
git diff --stat                                     # no src/schemas*, no worker.ts
grep -rn "api/actions" src/                         # route + src/lib/actions.ts only
grep -rn "default-campaign'" src/ | grep -v constants  # only the unit test
```

Throwaway browser proof (not committed — `P6.2` owns specs). Write
`tests/phase2-seed.tmp.spec.ts`, run `npx deepspace test run
tests/phase2-seed.tmp.spec.ts`, then delete it:

1. sign in as `Alice` (select by name — the pool holds
   `lorespace-alice@deepspace.test`), open `/home`;
2. assert `workspace-skeleton` disappears, `scene-banner` shows *The Ashen
   Threshold*, and no `seed-failed` notice renders;
3. evaluate `fetch('/api/actions/ensureDefaultCampaign', …)` a second time with
   the page's token and assert `data.created === false`;
4. reload `/home` and assert the banner still renders and the skeleton is gone
   (row already exists).

Manual, signed in and signed out:

1. signed out `/home` — fixture table, `preview-table`, no network call to
   `/api/actions/*`.
2. first signed-in `/home` on an empty campaigns collection — skeleton, then
   live banner; reload shows the live banner immediately.
3. signed in with the campaign already seeded — no second create (`created:
   false` on the wire).

Gates that must stay green this phase:

- no native `<select>`, no `window.confirm|alert|prompt` in new code;
- no emoji in UI chrome; icons from `lucide-react`;
- `viewer` still read-only: no schema change, so ADR 0014's public read stands.

## Risks

| Risk | Trigger | Mitigation |
| --- | --- | --- |
| Skeleton hangs because the subscription never delivers the seeded row | room broadcast missed after the action's create | `'seeded'` falls back to `DEFAULT_CAMPAIGN_SEED`, which is the same eight values; no false screen, no infinite skeleton |
| Two tabs seed at once | two signed-in mounts, both see an empty collection | `create` with a known id is an upsert (ADR 0007); both converge on one row, `created` may be `true` twice — acceptable and noted in code |
| Action is a cross-character write path with RBAC off | any signed-in caller POSTs `applyGmMutation` | membership check before any target read; target must share `campaignId`; phase 5's tools call the same action, not the tools directly |
| Partial apply because there are no transactions | seed/mutation second write fails after the first | ordered best-effort, stop at first failure, return `details.applied`; comment says "no transactions" rather than claiming atomicity |
| `getAuthToken()` null in a signed-in tab (expired session) | token refresh fails | `not_authenticated` error → toast + `seed-failed` notice, fixture still renders; next mount retries |
| Fixture/seed drift reintroduced | someone edits `PREVIEW_CAMPAIGN` directly | seed values live in `campaign-seed.ts`, the fixture and the action both import them; unit test deep-equals the created row to the constant |

## Open questions

None blocking. Settled in this session:

- [x] Seed values (plan text vs ADR 0011 vs `PREVIEW_CAMPAIGN`) → ADR 0011 state
      one; one shared constant; recorded as a deviation, no new ADR.
- [x] `applyGmMutation` authorization → caller owns a character in the campaign;
      target must share the campaign. No GM seat exists (ADR 0012), so table
      membership is the only authority available. Listed in § Worth your eyes
      for confirmation.
- [x] Skeleton vs. signed-out preview → skeleton only when `isSignedIn`.

## Outcome

- **Shipped:** `ensureDefaultCampaign` and `applyGmMutation` as bearer-only
  server actions; the shared seed constant and the fixture as one object; the
  app's first client action caller (`callAction`); `/home`'s signed-in seeding
  state machine (skeleton → live row, visible failure notice, no silent fixture
  fallback).
- **Slipped:** nothing moved to another task. One promised test case was
  untestable as written (see Deviations).
- **Deviations:**
  - **Seed content** is ADR 0011's *threshold* state, not the high-level plan's
    literal `Sunken Reliquary / dungeon / DC 13 / Runebound Sentinel`. That prose
    matches none of ADR 0011's three states, while `PREVIEW_CAMPAIGN` called
    itself the drift guard for `P2.3` and `SceneBanner` already renders the
    enemy block only when `enemyMaxHp > 0`. No new ADR: this is ADR 0011's first
    state, not a new direction. Values now live once, in
    `src/lib/campaign-seed.ts`.
  - **`details.applied`** is in `applyGmMutation`'s failure shape but is always
    `[]`: every mutation kind performs exactly one write, so "a later write
    failed after the first landed" cannot occur today. The P2.6 test asserts the
    single-write failure instead; the field stays so a future multi-write kind
    does not change the wire contract.
  - **Commit entanglement:** commit `01720d5` ("docs: per-archetype armor bonus
    for P3.1", authored by a concurrent session in this worktree) swept in this
    phase's in-flight files — `src/lib/campaign-seed.ts`, the
    `preview-data.ts` rewiring, this plan, and the throwaway proof spec. The
    code is unchanged and verified here; the history is not clean, and the
    throwaway spec was deleted in the phase-2 commit that follows. Not rewritten
    (history is written) — recorded instead.
- **Inherited by the next phase:** a `campaigns/default-campaign` row exists
  after the first signed-in visit, identical to `DEFAULT_CAMPAIGN_SEED`;
  `callAction` is the way to reach an action from the browser; `applyGmMutation`
  accepts `{ mutation: character_hp | grant_loot | update_scene }` and is the
  GM's only write path; `characters.userId` is never written by an action;
  `campaigns` may contain foreign rows, so readers must key on
  `DEFAULT_CAMPAIGN_ID`.
- **Feature inventory** (report sections 1-5, verbatim): see
the close-out report in this session; the table below is that report's content.

### 1. Shipped, by feature

| Feature | State | Files | Evidence |
| --- | --- | --- | --- |
| Campaign seed action (`POST /api/actions/ensureDefaultCampaign`, idempotent upsert at `default-campaign`) | route, write, unit test | `src/actions/index.ts`, `src/lib/campaign-seed.ts` | live browser run logged `[action] "ensureDefaultCampaign"` and rendered *The Ashen Threshold*; `actions.test.ts` "creates the default campaign with the fixture values on an empty collection" |
| Seed values as one shared constant (`DEFAULT_CAMPAIGN_SEED` = `PREVIEW_CAMPAIGN.data`) | read (fixture + action import the same object) | `src/lib/campaign-seed.ts`, `src/lib/preview-data.ts` | unit test deep-equals the created row to `PREVIEW_CAMPAIGN.data`; banner text identical signed in/out |
| `/home` signed-in seeding state (`idle → seeding → seeded \| failed`, `useRef` guard, `seeded` fallback) | action, read | `src/pages/(app)/home.tsx` | throwaway spec: banner text after mount, no stale skeleton, no notice, and **zero** action calls on an already-seeded table |
| Client action caller (`callAction`, bearer + JSON, `ActionCallError`) | action | `src/lib/actions.ts` | observed in the browser run (the action reached the worker with a bearer token); 401-with-no-slug mapped to `not_authenticated` |
| GM mutation action (`POST /api/actions/applyGmMutation`: HP clamp to `0..maxHp`, loot with forced `campaignId`, scene whitelist) | route, unit test | `src/actions/index.ts` | `applyGmMutation` block of `actions.test.ts` (membership refusal, clamp at 0 and maxHp, other-campaign refusal, loot pinning, scene whitelist, `write_failed`, invalid params) |
| Action unit gate (fake `ActionTools`, 15 tests) | unit test | `src/actions/__tests__/actions.test.ts` | `npm run test:unit` → 4 files / 32 tests |

### 2. Not real yet

| What you see | Actually | Becomes real in |
| --- | --- | --- |
| Party roster (Kaelen, Vesper) with green online dots | `PREVIEW_CHARACTERS` in `src/lib/preview-data.ts`; `online: true` hardcoded in `src/pages/(app)/home.tsx` | Phase 3 — `characters` query; Phase 4 — presence peers |
| Action feed (roll rows) | `PREVIEW_ROLLS` in `src/lib/preview-data.ts` | Phase 4 — `rollSkillCheck` + `roll-logs` |
| GM console transcript and its input | `PREVIEW_GM_MESSAGES` in `src/lib/preview-data.ts`; no ai-chat feature, no `/api/ai/chat` | Phase 5 — `ai-chat` install + GM tools |
| Character sheet numbers and inventory list | `PREVIEW_CHARACTERS` / `PREVIEW_INVENTORY`, passed as props by `src/pages/(app)/home.tsx` | Phase 3 — sheet + inventory panels |
| Enemy HP block in the scene banner | never rendered for the seed row (`enemyMaxHp: 0`) | Phase 5 — `update_scene` via the GM |
| `applyGmMutation` itself | implemented and tested, but no UI or tool calls it | Phase 5 — `P5.3` GM tools |

### 3. Persistence check

Yes — one collection. `campaigns` (`default-campaign`) is written once per empty
room from `/home` by the signed-in seed via `POST
/api/actions/ensureDefaultCampaign`. Nothing else in the app writes anything;
`applyGmMutation` can write `characters.hp`, `inventory`, and `campaigns` scene
columns, but it has no caller until Phase 5.

### 4. Pending, by phase

- Phase 3 → the character sheet, Forge creation, d20 math and inventory read as
  live `characters`/`inventory` rows instead of the preview arrays.
- Phase 4 → the roster, feed and roll banner become presence + server-computed
  `roll-logs` writes.
- Phase 5 → the GM console becomes a real streamed agent, and it is the caller
  that makes `applyGmMutation` live.
- Phase 6 → gates, the rewritten `collab` spec, deploy and the live URL.

### 5. Worth your eyes

| Tier | Item | Why a human | What to check | Files |
| --- | --- | --- | --- | --- |
| blocks | Seed is the threshold state, not the high-level plan's dungeon seed | content/beat choice, and the opening frame of the demo | Confirm the demo opens at The Ashen Threshold (exploration, DC 12) and the Sentinel arrives through the GM, per ADR 0011 | `src/lib/campaign-seed.ts` |
| blocks | `applyGmMutation` authority is table membership: any signed-in player with a character can change another character's HP, grant loot, and move the scene | permission model, expensive to reverse once the GM prompt and demo rely on it | Confirm "no GM seat, the whole table can prompt and mutate" is the story you want to tell (ADR 0012 has no GM role) | `src/actions/index.ts:160-190` |
| blocks | Loot rows carry no `userId`, so any member can delete GM-granted loot | accepted risk, but now the GM creates those rows | Confirm ADR 0014's accepted asymmetry still holds for AI-granted items | `src/schemas/inventory-schema.ts` |
| blocks | Scene numbers are unclamped (`enemyHp` above `enemyMaxHp`, any DC) — deferred to the GM tools | accepted gap, visible on the banner | Confirm deferring clamping to `P5.3` rather than guarding in the action | `src/actions/index.ts:72-90` |
| taste | Failure copy: "The live campaign could not be loaded, so this is the preview table. Reload to try again." | copy | Skim it; it is one sentence, no emoji | `src/pages/(app)/home.tsx` |
| taste | Skeleton: one banner bar + three pulse columns, same grid as the real shell | visual proportion | Glance at a cold load; no argument needed | `src/pages/(app)/home.tsx` |

- **Next:** `/phase 3` — **ready**. Phase 3 depends on a seeded campaign row
  (`P2.3`/`P2.5`, shipped) and nothing else in this phase blocks it. `P6.2`
  gains a real signed-in flow to assert, but no phase became blocked as a side
  effect of this one.

