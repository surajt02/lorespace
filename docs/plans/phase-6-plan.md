# Phase 6 — Gates, Tests, Deploy

- **Status:** Done
- **Session:** 2026-11-20, orchestrator + read-only scouts
- **Governing tasks:** `P6.1`–`P6.9` in [`../tasks.md`](../tasks.md)
- **ADRs in force:** [0005](../adr/0005-dice-roll-authority.md),
  [0006](../adr/0006-presence-room-authorization.md),
  [0008](../adr/0008-playable-interview-build.md),
  [0009](../adr/0009-engine-owns-outcomes.md),
  [0013](../adr/0013-visual-register.md),
  [0014](../adr/0014-public-read-table.md),
  [0021](../adr/0021-roll-banner-reads-roll-logs.md),
  [0022](../adr/0022-gm-tools-confined-to-chat-turn.md),
  [0028](../adr/0028-one-dc-per-action.md),
  [0030](../adr/0030-per-character-check-gate.md)
- **Depends on:** Phase 5 outcome — streamed GM, engine-gated arc, narrative
  combat, shared `gm-messages` thread, locally proven.
- **Unblocks:** the shipped interview deliverable. There is no Phase 7.

## Goal

Turn the locally proven table into the deliverable: mechanical gates clean, a
Playwright suite that proves the multi-window contract (two accounts, roster,
requested check, roll, feed) rather than the auth template, a live deployed URL
smoke-tested through the GM write path, a README that is the front door, and
three timed rehearsals of the eight-beat demo under five minutes.

## Definition of done

- [x] The five Phase 6 grep gates return the required 0 / valid hits; the strict
      emoji sweep over `src/**` returns no emoji codepoints.
- [x] `npm run type-check` checks `tests/**` (P6.5), `npm run lint` passes,
      `npm run test:unit` passes.
- [x] `npm run test:e2e` passes: smoke (including `/home` H1 + preview table),
      api, presence, and the rewritten `collab.spec.ts` (two accounts, character,
      roster, requested check, roll in both windows).
- [x] `npx deepspace deploy` serves the phase-6 commit at
      `https://lorespace.app.space`; the live smoke script exits 0 with zero
      console/WebSocket errors and at least one GM-driven HP/loot mutation.
- [x] `README.md` carries the live URL, three screenshots, three sentences on
      what the app is, how sync works, and ADR 0005 / 0009 / 0014 links.
- [x] Three timed live rehearsals of the eight beats each finish under five
      minutes with zero console errors.

## Scope

**In scope:**

- Comment/test-string edits for the grep gates: `src/components/ChatPanel.tsx`,
  `src/ai/__tests__/tools.test.ts`, `src/components/ui/Select.tsx`.
- `tsconfig.json` + `package.json` (add `@types/node`) so `tests/**` type-checks.
- `tests/helpers/` — deterministic owner-credential check helper and signed-in
  action caller.
- `tests/collab.spec.ts`, `tests/presence.spec.ts`, `tests/smoke.spec.ts`,
  `tests/playwright.config.ts`.
- `src/components/vtt/ActionFeed.tsx` — `data-testid="feed-empty"` on the empty
  state (the current spec references a dead id).
- `src/components/CharacterSheetPanel.tsx` — live `data-character-id` (the
  test-only hook cleanup needs; preview rows expose nothing).
- `scripts/live-smoke.mjs` — live deploy smoke + screenshot capture + timed
  rehearsal, run against `https://lorespace.app.space`.
- `README.md`, `docs/assets/*.png`, `docs/tasks.md`, this plan.

**Out of scope (explicit non-goals):**

- Any change to schemas, permissions, actions, routes or GM tools. The phase
  proves the Phase 5 system; it does not extend it.
- Restoring a free-roll UI path or changing ADR 0028 / 0030's one-DC gate.
- New features, copy polish beyond README/demo affordances, or a recorded demo
  (ADR 0008: the repo link is the deliverable).
- Fixing `P5.13` (model default). `GmConsolePanel.tsx:75` already pins
  `claude-haiku-5-5`; this phase verifies it, it does not re-decide it.
- Production cleanup of local e2e roll-log evidence; see Risks.

## Entry state (verified)

| Thing | State | Where |
| --- | --- | --- |
| Phase 6 tasks | `P6.1`–`P6.8` all unticked; no plan file before this one | `docs/tasks.md:1205` |
| Gate 1 | 2 hits, both prose false positives (`prompt (` in a comment/test docstring) | `src/components/ChatPanel.tsx:231`, `src/ai/__tests__/tools.test.ts:9` |
| Gates 2–5 | Pass: no placeholder page text, no `data-theme="slate"`, `home pattern:` at `home.tsx:1`, `data-theme="obsidian"` at `src/themes.css:24` | `index.html`, `src/` |
| Emoji | One `⚠️` in a JSDoc comment; rendered chrome is clean | `src/components/ui/Select.tsx:17` |
| Purple/indigo | Zero hits in `src/**/*.tsx,ts,css` | — |
| Signed-out `/home` | `<h1>{campaign.title}</h1>` in `SceneBanner`; fixed title `Chronicles of the Obsidian Vault`; `preview-table` test id exists | `src/components/vtt/SceneBanner.tsx:96`, `src/lib/campaign-seed.ts:44`, `src/pages/(app)/home.tsx:430` |
| Signed-out fixtures | Roster 2, feed 4, GM turns 3, inventory 3; live rows replace them once any character exists | `src/lib/preview-data.ts:96,190,278`, `home.tsx:291` |
| `feed-empty` | Referenced by `presence.spec.ts:265` but does not exist in `src/` | `tests/presence.spec.ts`, `ActionFeed.tsx:212` |
| Check gate | `characters.pendingStat` + `pendingDc`; stat card rollable only for the requested stat (or a GM-prose fallback); `rollSkillCheck` still permits a free roll when nothing is pending | `src/schemas/characters-schema.ts:46-53`, `src/lib/pending-check.ts:143`, `src/actions/index.ts:1236` |
| Deterministic `request_check` | No member-facing writer; `applyGmMutation` is owner-only and `request_check` writes the two columns. `.dev.vars`' `APP_OWNER_JWT` is an **app** token and the action route refuses it; the local CLI session can mint a 15-minute owner user token | `src/actions/index.ts:475,654`, `~/.deepspace/session` |
| E2E specs | `presence.spec.ts` 3 tests (one two-window roll proof whose bare `stat-card-dex` click is now inert); `collab.spec.ts` 3 identity/`/api-status` tests, zero campaign coverage; `smoke.spec.ts` 6 tests, no `/home` H1/table assertions | `tests/` |
| Accounts | 2 cached (`lorespace-alice`, `lorespace-bob`) with passwords; 64 Playwright state files | `~/.deepspace/test-accounts.json`, `~/.deepspace/playwright-states/` |
| Type check | `tsconfig.json` `include` is `["src","worker.ts"]`; `tests/**` and root `prerender.test.ts` unchecked; no `@types/node` installed | `tsconfig.json` |
| Unit tests | 19 files / 327 `it(` calls; `lintSchema`/`lintSchemas` already asserted; d20 helpers covered | `src/schemas/__tests__/schemas.test.ts:2,20`, `src/lib/__tests__/d20.test.ts` |
| Deploy | Live: release #9, 2026-11-19; source is GitHub-latched (`surajt02/lorespace`), so deploys ship the checkout and record no commit lineage | `npx deepspace status`, `wrangler.toml` |
| Build | `dist/` is a stale Nov 18 build; `deepspace deploy` rebuilds | `dist/` |
| README | Live URL line self-negates ("Not live yet"), 1 screenshot, no sync section, status says Day 1 / Phase 4, "four collections" (nine registered) | `README.md` |

## Contracts

**No production contract changes.** Schemas, routes, actions, permissions and
GM tools are untouched. The only shipped source change is a test id.

- **Test hook — `feed-empty`:** `src/components/vtt/ActionFeed.tsx`'s empty
  state carries `data-testid="feed-empty"`, replacing the dead reference in
  `presence.spec.ts`.
- **Test hook — `data-character-id`:** the live `character-sheet` section carries
  the record id (preview rows expose nothing), so a spec can delete only the
  character it forged through the real `deleteCharacter` action.
- **Test helper — `requestCheck`** (`tests/helpers/check-gate.ts`):
  `requestCheck(request: APIRequestContext, input: { characterId: string; stat: AbilityKey; dc: number }): Promise<void>`.
  Posts `/api/actions/applyGmMutation` with
  `{ mutation: { kind: 'request_check', characterId, stat, dc } }` and
  `Authorization: Bearer <owner token>`, minting that token from
  `~/.deepspace/session` (cached for its 15-minute life). Throws an actionable
  error on a missing login or non-`success` result; never prints the token.
- **Test helper — `callAsPlayer`** (`tests/helpers/check-gate.ts`):
  `callAsPlayer(page: Page, name: string, params: Record<string, unknown>): Promise<unknown>`
  obtains the member bearer from `GET /api/auth/token` inside the page and
  posts `/api/actions/:name`. Used for `deleteCharacter` cleanup.
- **Playwright ordering:** `workers: 1` in `tests/playwright.config.ts` — every
  spec mutates the one default campaign, so parallel files are not independent.
- **Spec ownership:** `collab.spec.ts` owns character creation → roster sync →
  requested check → roll → feed/banner in two windows, with `finally` cleanup.
  `presence.spec.ts` owns membership gating (anonymous socket, preview scope)
  and the signed-out watcher banner, reusing the check helper. No duplicate
  two-window roll proof.
- **Live script:** `node scripts/live-smoke.mjs [--capture] [--rehearse <n>]`
  signs in the cached test accounts against `https://lorespace.app.space`,
  ensures one character each, requests and rolls a check, sends one GM turn,
  asserts a GM mutation row, records console/WebSocket errors, optionally writes
  `docs/assets/*.png`, and exits non-zero on any failed assertion or console
  error. It does not run in CI or `test:e2e`.

## Steps

### Step 1 — Mechanical gates (`P6.1`)

- Files: `src/components/ChatPanel.tsx`, `src/ai/__tests__/tools.test.ts`,
  `src/components/ui/Select.tsx`.
- Change: reword the two prose `prompt (` occurrences so the gate's regex no
  longer matches (e.g. `` `prompt` (`P5.7`) ``); replace the JSDoc `⚠️` with the
  word `Warning:`. No behaviour change.
- Watch out: do not weaken the gate or exclude paths; the gate is the point.
- Proof: the five commands from `docs/high-level-plan.md` § Phase 6, plus a
  strict emoji sweep over `src/**` returning no emoji codepoints, plus
  `grep -rnE '(purple|indigo|violet|fuchsia)-[0-9]' src/` returning nothing.

### Step 2 — Type-check the tests (`P6.5`)

- Files: `tsconfig.json`, `package.json`, `package-lock.json`,
  `tests/**` (fixes only).
- Change: add `@types/node` as a devDependency; add `"node"` to
  `compilerOptions.types`; widen `include` to
  `["src", "worker.ts", "tests"]`. Keep root `prerender.test.ts` outside
  deliberately (it is a Node-only vitest file kept out of the browser project
  per `vitest.config.ts:18`) and record that choice here.
- Watch out: `types` currently restricts globals to workers + vite; adding
  `node` must not break `src` (skipLibCheck is on). Playwright's `Page`/`expect`
  imports must resolve.
- Proof: `npm run type-check` passes with `tests/**` included; deliberately
  introduce a type error in a scratch spec and confirm `tsc` reports it, then
  remove it.

### Step 3 — Deterministic check gate + serialized e2e (`P6.9`)

- Files: `tests/helpers/check-gate.ts` (new), `tests/playwright.config.ts`,
  `src/components/vtt/ActionFeed.tsx`, `tests/presence.spec.ts` (dead-id line
  only).
- Change: implement `requestCheck` and `callAsPlayer` as specified in
  Contracts; set `workers: 1`; add `data-testid="feed-empty"` to the feed empty
  state and use it instead of the dead `.or()`.
- Watch out: the helper needs `~/.deepspace/session` (a CLI login), not
  `.dev.vars`; the error must say to run `npx deepspace auth login`. Never log or
  commit the token.
- Proof: a focused spec assertion that `requestCheck` makes
  `stat-card-dex[data-pending="true"]` appear for a forged character, and that
  an un-requested stat is disabled (`npm run test:e2e -- presence --grep …` or
  the full spec).

### Step 4 — Rewrite `collab.spec.ts`; fix `presence.spec.ts` (`P6.2`)

- Files: `tests/collab.spec.ts`, `tests/presence.spec.ts`,
  `src/components/CharacterSheetPanel.tsx`.
- Change: replace the three identity/`/api-status` tests with:
  1. *two accounts forge two adventurers and see each other's roster row* —
     `users(2)`, `ensureCharacter` (reuse the presence helper shape,
     `__test-<ts>__` names), roster count 2, peer row names the other, no reload.
  2. *a requested check rolls in both windows* — owner `requestCheck` for
     Alice's `dex`, assert `pending-label`/`data-pending`, click
     `stat-card-dex`, assert both banners and Bob's first feed entry; assert a
     different stat stays disabled.
  Cleanup in `finally`: delete only characters created by this test via
  `callAsPlayer(deleteCharacter)`; close extra contexts.
  In `presence.spec.ts`, replace the bare `stat-card-dex` click with
  `requestCheck` first, and use `feed-empty` honestly.
- Watch out: accounts are persistent between runs; `ensureCharacter` must
  reuse an existing sheet (no forge form) rather than fail. Roll-log evidence
  rows are append-only and have no delete action — cleanup removes characters,
  not their roll rows; say so in the report.
- Proof: `npm run test:e2e` — `collab` 2/2, `presence` 3/3, zero console
  errors, no `test.skip` on this machine.

### Step 5 — `smoke.spec.ts` `/home` assertions (`P6.3`)

- Files: `tests/smoke.spec.ts`.
- Change: add one signed-out test: `/home` has `app-navigation`, then
  `signed-out-banner`; `scene-banner h1` has text
  `Chronicles of the Obsidian Vault`; `preview-table` is visible and contains
  `party-roster`, `action-feed`, `character-sheet`, `inventory-panel`,
  `gm-stream`; `<title>` matches `/LoreSpace/`; signed out renders zero
  `stat-card-*` and zero `start-campaign`.
- Watch out: do **not** assert fixture counts (2/4/3) — live characters switch
  the signed-out branch to live rows. The H1 is in `SceneBanner`, not the page.
- Proof: `npm run test:smoke` 7/7.

### Step 6 — Full local pass (`P6.4`)

- Files: none (fixes only).
- Change: run the whole gate locally and fix what it finds without widening
  scope.
- Proof: `npm run type-check && npm run lint && npm run test:unit && npm run
  test:e2e`; `npm test` (smoke+api) also green. Run e2e in the background.

### Step 7 — Deploy + live smoke (`P6.6`)

- Files: `scripts/live-smoke.mjs` (new).
- Change: implement the live script per Contracts. Sign in both cached test
  accounts on the live URL, forge `Kaelen`/`Vesper` if absent, request a `dex`
  check via the owner JWT, roll it, send the GM a damage-bearing turn, assert a
  `combat`/`gm_event` row and no console/WS errors. Commit before deploying;
  source is GitHub-latched, so the release records no commit lineage — verify
  the live HTML/asset hash serves the new commit.
- Watch out: model tool use is not deterministic; give the GM an explicit
  damage outcome and allow one retry. If no mutation after two attempts, stop
  and report a Phase 5 defect rather than fake it.
- Proof: `npx deepspace deploy` exit 0, release listed by
  `npx deepspace releases`; `node scripts/live-smoke.mjs` exit 0 printing
  `consoleErrors: []`, `wsErrors: []`, `mutationRows >= 1`, live URL.

### Step 8 — README + screenshots (`P6.7`)

- Files: `README.md`, `docs/assets/landing.png`,
  `docs/assets/table-signed-out.png`, `docs/assets/table-signed-in.png`.
- Change: rewrite the front door: live URL at the top (no "not live yet"),
  three screenshots, the existing three-sentence what, a sync section naming
  `RecordRoom`, `PresenceRoom`, the membership gate (ADR 0006), public-read
  table (ADR 0014) and the two-path roll (ADR 0021); links to ADRs 0005/0009/
  0014; correct the status, verify commands (`test run e2e`, `npm test` scope)
  and "nine collections".
- Watch out: capture with `node scripts/live-smoke.mjs --capture`; no emoji,
  no purple; screenshots must show the real live table, not fixtures pretending
  to be live.
- Proof: `grep` the README for the live URL, three image links resolving to
  committed files, ADR links; open the raw Markdown and read it.

### Step 9 — Three timed rehearsals (`P6.8`)

- Files: none (evidence in this plan's Outcome).
- Change: run `node scripts/live-smoke.mjs --rehearse 3` on the deployed URL:
  signed out → landing → `/home` preview → sign in → forge/reuse → requested
  roll → GM turn → mutation, each run timed.
- Watch out: the five-minute budget is wall-clock for the whole path; model
  latency is the variable. Record each run's seconds and any console error.
- Proof: three timings, all `< 300 s`, zero console/WS errors; capture a final
  screenshot set if the state changed.

## Verification

```sh
# gates
grep -REn '<select|(^|[^[:alnum:]_.])(window\.)?(confirm|alert|prompt)[[:space:]]*\(' src/
grep -rn "placeholder page\|Your app goes here" src/
grep -rn 'data-theme="slate"' index.html
grep "home pattern:" 'src/pages/(app)/home.tsx'
grep 'data-theme="obsidian"' src/themes.css

# code
npm run type-check
npm run lint
npm run test:unit
npm run test:e2e

# deploy + live
npx deepspace deploy
node scripts/live-smoke.mjs
node scripts/live-smoke.mjs --rehearse 3
```

Manual, signed in and signed out, on the live URL:

1. Landing → **Enter the table** → signed-out `/home` shows the three-column
   table and sign-in banner.
2. Sign in as one cached account → roster shows the live party; forge or reuse a
   character.
3. Second window (second account) sees the character without a reload; a
   requested check rolls in both windows with one banner and one feed row.
4. Send one GM turn that names damage → HP changes and a `combat` row appears;
   zero console/WS errors.

## Risks

| Risk | Trigger | Mitigation |
| --- | --- | --- |
| Live GM turn does not call a write tool | model choice, billing refusal | explicit damage prompt, one retry; if still absent, report a Phase 5 defect and do not claim P6.6 |
| Test accounts already have characters or stale storage | repeated runs | `ensureCharacter` reuses; cleanup deletes only this run's characters; `test accounts recover --all` if the registry is lost |
| Parallel spec files mutate the one campaign | Playwright default workers | `workers: 1` in `tests/playwright.config.ts` |
| CLI session missing/expired for `request_check` | a bare `playwright test` on a logged-out machine | helper mints from `~/.deepspace/session` and its error names `npx deepspace auth login` |
| e2e leaves append-only roll-log rows | no delete action for `roll-logs`; ADR 0026 only clears via new-game reset | accepted; characters are deleted, rows name them; live state is reset separately if needed |
| Deploy ships uncommitted bytes (GitHub latch) | `deepspace deploy` after edits | commit first; verify `deepspace status` and that the live page serves the new build |
| Live smoke pollutes the demo table | forging/rolling as test accounts | use presentable names and leave them as the populated table, or delete characters + new-game reset after capture; decide before screenshots |
| `@types/node` in shared `types` leaks into worker code | tsconfig edit | `skipLibCheck` already on; `tsc` + lint prove no regression |

## Open questions

- [x] P5.13 model default — resolved in code: `GmConsolePanel.tsx:75` pins
      `claude-haiku-5-5`; this phase verifies the live turn, no new decision.
- [x] Deterministic `request_check` for tests — resolved: an owner token minted
      from `~/.deepspace/session` by a test helper; no production route added.
- [x] Live table state after rehearsal — left populated (Kaelen/Vesper and the
      real roll/combat rows) so the signed-out table shows live rows; reversible
      with Start New Campaign. Flagged for taste in § Outcome.

## Outcome

- **Shipped:** mechanical gates clean (five greps + emoji/purple sweep); `tests/**`
  type-checked (`@types/node`, widened `include`); a deterministic owner-minted
  check request and a serial e2e suite; rewritten `collab` spec (two accounts,
  roster, requested check, roll in both windows, `finally` cleanup); gated
  `presence` spec; `/home` H1 + preview-table smoke assertions; release #10 live
  at <https://lorespace.app.space>; `scripts/live-smoke.mjs` with capture and
  rehearsal modes; README front door with three live screenshots; three timed
  live rehearsals of the full path (42.0 s / 40.9 s / 41.8 s, zero console errors,
  each with a real GM write: two `combat` rows and one scene advance).
- **Slipped:** nothing. The `P6.6` live smoke needed a second pass after the
  first live GM turn exceeded the script's 150 s ceiling; the corrected sequence
  waits for the console's own auto roll turn (ADR 0031) instead of racing it.
- **Deviations:** none from an accepted ADR. New work was tracked as `P6.9`
  (test-only check gate, `feed-empty` id, serial workers). The owner credential
  is minted from `~/.deepspace/session` because `.dev.vars`' `APP_OWNER_JWT` is
  an app credential and the action route refuses app tokens.
- **Inherited by the next phase:** there is no Phase 7. A later session may
  assume the 14-test e2e suite is green on a machine with two test accounts and
  a CLI login, that `scripts/live-smoke.mjs` proves the deployed GM write path,
  and that the live campaign carries Kaelen/Vesper plus test roll rows.

### Feature inventory

#### 1. Shipped, by feature

| Feature | State | Files | Evidence |
| --- | --- | --- | --- |
| Owner-minted check request for e2e (`requestCheck`) | e2e | `tests/helpers/check-gate.ts` | `tests/collab.spec.ts` "a requested check rolls in both windows"; server log `applyGmMutation caller=<owner>` then `rollSkillCheck caller=<Alice>` |
| Player-bearer action caller (`callAsPlayer`) | e2e | `tests/helpers/check-gate.ts` | `deleteCharacter caller=<Alice>` in the `collab` and `presence` runs; 14/14 e2e |
| Two-window table spec (character, roster, requested check, roll, feed) | e2e | `tests/collab.spec.ts` | `collab` 2/2 in `test run e2e`; unique names avoid the `P5.15` duplicate-name refusal |
| Gated two-window roll in the presence spec | e2e | `tests/presence.spec.ts` | `presence` 3/3; "the campaign presence scope refuses an anonymous socket" |
| Signed-out `/home` H1 + preview-table contract | e2e | `tests/smoke.spec.ts` | "signed-out /home shows the campaign title and the preview table"; smoke 7/7 |
| `tests/**` inside the type-check boundary | read (tsc) | `tsconfig.json`, `package.json` | `npm run type-check`; a scratch type error in `tests/` was reported and removed |
| Character id on the live sheet | read (e2e cleanup) | `src/components/CharacterSheetPanel.tsx` | `data-character-id` read by both specs; deletion test above |
| Real empty-feed state id | read (presence spec) | `src/components/vtt/ActionFeed.tsx` | `feed-empty` used by `tests/presence.spec.ts:265` |
| Serial e2e across one campaign | read (Playwright config) | `tests/playwright.config.ts` | `workers: 1`; 14/14 pass in one worker |
| Live smoke/capture/rehearsal runner | e2e (live) | `scripts/live-smoke.mjs` | three full-path passes 42.0/40.9/41.8 s, zero console errors, GM writes incl. `combat` 24→20 |
| README front door | read (human) | `README.md`, `docs/assets/landing.png`, `docs/assets/table-signed-out.png`, `docs/assets/table-signed-in.png` | live URL, 3 resolving image links, ADR 0005/0009/0014 links |

#### 2. Not real yet

| What you see | Actually | Becomes real in |
| --- | --- | --- |
| Signed-out party roster with two adventurers | `PREVIEW_CHARACTERS` in `src/lib/preview-data.ts`, rendered only when the campaign has no character rows | Already implemented (Phases 3-5) — live `characters` rows replace it; the fixture is ADR 0014's empty-table fallback |
| Signed-out table feed with four roll rows | `PREVIEW_ROLLS` in `src/lib/preview-data.ts` | Already implemented (Phases 4-5) — live `roll-logs` rows replace it once a character exists; `feed-empty` is the no-rolls state |
| Signed-out GM thread with three turns | `PREVIEW_GM_MESSAGES` in `src/lib/preview-data.ts` | Already implemented (Phase 5) — live `gm-messages` rows replace it once a character exists |
| Signed-out sheet and pack (Kaelen, two items) | `PREVIEW_CHARACTERS[0]` + `PREVIEW_INVENTORY` in `src/lib/preview-data.ts` | Already implemented (Phases 3-5) — the first live `characters` row and its `inventory` rows replace it |

#### 3. Persistence check

Phase 6 added no schema or write path; it exercised the existing ones. Local e2e
wrote `characters` (forged, then deleted through `deleteCharacter`) and
`roll-logs` (the roll plus GM `combat`/`gm_event` rows). The live smoke wrote
`characters` (Kaelen/Vesper forged or reused, `pendingStat`/`pendingDc` via
`applyGmMutation`) and `roll-logs` (roll + `combat` rows). The live campaign now
carries those two adventurers and their append-only roll rows.

#### 5. Worth your eyes

| Tier | Item | Why a human | What to check | Files |
| --- | --- | --- | --- | --- |
| blocks | Live GM turn reliability | First live pass hung past 150 s; the three rehearsals then took 41-42 s. A demo cannot depend on a cold turn landing. | Confirm Haiku-on-owner-billing is the intended demo model and that a 150 s ceiling is the right trade-off for a timed rehearsal. | `scripts/live-smoke.mjs`, `src/components/GmConsolePanel.tsx` |
| blocks | Test control uses the developer's CLI session | `requestCheck` reads `~/.deepspace/session` and mints a 15-minute owner token to write pending checks. It never logs the token, but it is a real credential read in committed test code. | Confirm this is acceptable for a repo an interviewer reads, versus a test-only route or a model-driven check. | `tests/helpers/check-gate.ts`, `scripts/live-smoke.mjs` |
| taste | Live campaign now contains test data | Kaelen/Vesper, repeated combat rows and the developer's own characters are on the deployed table; first impression is this state. | Leave it as a populated demo table, or delete the test sheets / start a new campaign before the interview. | live `characters`, `roll-logs`; `src/pages/(app)/home.tsx` |
| taste | Screenshot and README framing | The signed-out shot shows the two test adventurers; the landing shot carries deliberate empty space. | Say if the live-data screenshot is the story you want, or capture a cleaner table. | `README.md`, `docs/assets/*.png` |
| taste | GM prose styling inside pixel chrome | The console's prose block is squared but its typography is not the Silkscreen/pixel register of the rest of the table. | Decide whether the console should be chrome-styled before the interview. | `src/components/ChatPanel.messages.tsx` |
