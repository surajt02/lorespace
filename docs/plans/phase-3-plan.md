# Phase 3 — Character sheet, d20 math, inventory

- **Status:** Done
- **Session:** 2026-11-18, phase 3 orchestrator session
- **Governing tasks:** `P3.1`-`P3.9` in [`../tasks.md`](../tasks.md); replaces
  the click half of `P3.5` with `P4.8`
- **ADRs in force:** [0001](../adr/0001-schemas-before-ui.md),
  [0005](../adr/0005-dice-roll-authority.md),
  [0008](../adr/0008-playable-interview-build.md),
  [0010](../adr/0010-rules-depth.md), [0011](../adr/0011-content-arc.md),
  [0013](../adr/0013-visual-register.md), [0014](../adr/0014-public-read-table.md)
- **Depends on:** Phase 2 outcome — a seeded `campaigns/default-campaign` row,
  four registered domain collections, `callAction`, and the three-column shell
  whose panels take row props (`phase-1-plan.md` § Inherited).
- **Unblocks:** Phase 4 may assume `src/lib/d20.ts` exists with the classifier,
  that a signed-in player can own exactly one character row, and that
  `inventory.characterId` holds a character `recordId`.

## Goal

A signed-in player at `/home` gets a real character: forge one from four
archetype presets, see their own six stats, AC and HP from the `characters`
collection, adjust HP and spend/discard inventory items through awaited
confirmed writes, and watch a second window update without a reload. The d20
rules live once, in a pure module the worker can import in Phase 4. Signed-out
visitors keep the deterministic preview table.

## Definition of done

- [x] `npm run validate` and `npm run lint` pass
- [x] `npm run test:unit` includes `src/lib/__tests__/d20.test.ts`; AC 16/14 and
      modifier boundaries (1/10/11/20) pinned
- [x] `grep -rn "Math.random\|window\.\|document\." src/lib/d20.ts` finds nothing
- [x] `grep -rn "PREVIEW_INVENTORY\|PREVIEW_CHARACTERS" 'src/pages/(app)/home.tsx'`
      shows character/inventory fixtures only on the `preview` branch (roster
      stays fixture until `P4.3`)
- [x] Forge, HP adjust, Use and Discard each perform a write visible in a second
      browser window without reload
- [x] Live URL: `/` and `/home` serve after `P3.8`

## Scope

**In scope:**

- `src/lib/d20.ts` — `getModifier`, `formatModifier`, `calculateArmorClass`,
  `classifyRoll`, `ARCHETYPE_PRESETS`, `ARCHETYPE_ORDER` + row types.
- `src/lib/__tests__/d20.test.ts` — node-env unit tests.
- `src/components/CharacterSheetPanel.tsx` — live `characters` read, skeleton,
  read-error notice, Forge, six stat cards, HP bar + controls.
- `src/components/InventoryPanel.tsx` — live `inventory` read, Use/Discard with
  `ConfirmModal`, read-error notice.
- `src/pages/(app)/home.tsx` — query both collections, resolve the viewer's
  character, pass `mode`/`status`/records; keep the roster/feed/GM fixtures.
- `docs/tasks.md`, `docs/plans/README.md`, this file.
- `P3.8` — the first deploy (latches GitHub, ADR 0008).

**Out of scope (explicit non-goals):**

- **Browser-computed rolls.** No `Math.random`, no client-side dice. The click
  on a stat card resolves through the server action in `P4.4`/`P4.8`
  (ADR 0005). This phase renders the cards non-interactive.
- **Creation modal, stat allocation, archetype editing** — cut by ADR 0008.
- **Inventory add/edit forms** — cut by ADR 0008. Read + Use + Discard only.
- **Item effects and healing** — ADR 0010 has no rules for them. "Use" spends
  one charge, nothing else.
- **Roster, presence, feed, roll banner, GM console** — `P4.*`/`P5.*`.
- **Schema changes.** No new collection, no new column; `schemas.test.ts`
  column pins stay untouched.
- **Component/e2e tests.** Vitest is node-only; Playwright breadth is `P6.2`.
  This phase proves itself with unit tests + a throwaway signed-in spec that is
  deleted before the commit (Phase 2 precedent).

## Entry state (verified)

| Thing | State | Where |
| --- | --- | --- |
| `src/lib/d20.ts` | does not exist; a local `modifier()` duplicate in the sheet | `src/components/CharacterSheetPanel.tsx:23-26` |
| `CharacterSheetPanel` | presentational; props `{character: CharacterRow \| null, inventory: InventoryRow[]}`; EmptyState "No character at this table"; no controls | `src/components/CharacterSheetPanel.tsx:34-40` |
| `InventoryPanel` | presentational; props `{items: InventoryRow[]}`; no actions | `src/components/InventoryPanel.tsx:11` |
| `home.tsx` reads | `campaigns` only (no `where`), resolved by `recordId === DEFAULT_CAMPAIGN_ID`; character/inventory from `PREVIEW_*` | `src/pages/(app)/home.tsx:60-71,134-140` |
| `home.tsx` writes | one action call (`ensureDefaultCampaign`); **zero** `useMutations` call sites in `src/` | `src/pages/(app)/home.tsx:86` |
| Fixture | Kaelen Vanguard 16/12/14/8/10/11, 22/24 HP, AC 16; Vesper Shadowblade 10/17/12/12/10/14, 17/17, AC 14; 3 Kaelen items | `src/lib/preview-data.ts:83-171` |
| `characters` schema | 13 required columns, `ownerField: 'userId'`, `userBound`+`immutable` userId, `uniqueOn: ['userId','campaignId']`, member `create` + `'own'` update/delete | `src/schemas/characters-schema.ts:17-38` |
| `inventory` schema | 6 columns, no `userId`; member create/update/delete; category select `weapon\|armor\|consumable\|relic\|quest` | `src/schemas/inventory-schema.ts:17-30` |
| `useQuery` / `useMutations` | `useQuery<T>(c, {where})` → `{records: RecordData<T>[], status: 'loading'\|'ready'\|'error'}`; `useMutations<T>(c)` → `{ready, createConfirmed, putConfirmed, removeConfirmed}` | `node_modules/deepspace/dist/index.d.ts:2526-2589` |
| Confirmation semantics | confirmed helpers reject on server refusal (plain `Error` with the server message) and on `not_ready`/`unconfirmed`/`cancelled`; permission denials also fire the provider's `onWriteError` toast | `dist/index.js:2269-2280`, `src/pages/(app)/_layout.tsx:66-79` |
| Unit harness | Vitest node env, `src/**/*.{test,spec}.ts`, alias `@ → ./src` | `vitest.config.ts:20-33` |
| Deploy | never deployed; source/`space` remote unclaimed | `docs/tasks.md` § Current state |

## Contracts

Later phases read this section instead of the code.

### Data (unchanged schemas, new write paths)

- `characters` — created from the browser with `createConfirmed` as a `member`.
  Payload is **all 13 columns**; `userId` comes from `useAuth().userId` (the
  column is `userBound`, so the server stamps/pins the same value). `hp` is
  updated with `putConfirmed(recordId, { hp })` clamped `0..maxHp` client-side;
  `'own'` update is what makes that legal. No other column is ever updated by the
  browser.
- `inventory` — created with `createConfirmed` (6 columns; `characterId` is the
  character **`recordId`**, `campaignId` the campaign id), updated with
  `putConfirmed(recordId, { quantity })`, deleted with `removeConfirmed(recordId)`.
  No `userId` column: any signed-in member could delete another member's row
  (accepted, `P2.2`/ADR 0014). The UI only offers the caller's own items.
- Both are plain record writes over the room socket. **No new action.**
- Trust boundary: HP is client-authored by the character's owner (schema
  permission), unlike dice rolls (ADR 0005). Accepted for this build.

### `src/lib/d20.ts` (pure; worker-safe in `P4.4`)

```ts
export type ArchetypeName = 'Vanguard' | 'Shadowblade' | 'Arcanist' | 'Cleric'
export type ItemCategory = 'weapon' | 'armor' | 'consumable' | 'relic' | 'quest'
export interface AbilityScores { str: number; dex: number; con: number; int: number; wis: number; cha: number }
export interface StarterItem { itemName: string; category: ItemCategory; description: string; quantity: number }
export interface ArchetypePreset {
  name: ArchetypeName
  blurb: string
  armorBonus: number
  maxHp: number
  scores: AbilityScores
  starterItems: [StarterItem, StarterItem]
}
export type RollOutcome = 'critical_success' | 'success' | 'failure' | 'critical_failure'

export function getModifier(score: number): number          // Math.floor((score - 10) / 2)
export function formatModifier(modifier: number): string    // 0 → '+0', -1 → '-1'
export function calculateArmorClass(dexScore: number, armorBonus: number): number // 10 + getModifier(dex) + armorBonus, no clamp
export function classifyRoll(rawRoll: number, total: number, targetDc: number): RollOutcome
export const ARCHETYPE_PRESETS: Record<ArchetypeName, ArchetypePreset>
export const ARCHETYPE_ORDER: readonly ArchetypeName[]      // Vanguard, Shadowblade, Arcanist, Cleric
export const ABILITY_SCORES: readonly { key: keyof AbilityScores; label: string }[] // STR..CHA
```

`ABILITY_SCORES` (shipped) is the sheet's card order and is the one place the
six keys are enumerated for UI; `P4.8` reuses it for the click targets.

- `classifyRoll`: `rawRoll === 20` → `critical_success`; `rawRoll === 1` →
  `critical_failure`; else `total >= targetDc` → `success`; else `failure`.
  Presets carry `armorBonus`: Vanguard 5, Cleric 4, Arcanist 2, Shadowblade 1.
  Their DEX values reproduce the fixture ACs: Vanguard 16, Shadowblade 14.
- `ARCHETYPE_PRESETS`: Vanguard `16/12/14/8/10/11`, maxHp 24; Shadowblade
  `10/17/12/12/10/14`, maxHp 17; Arcanist `8/14/12/16/13/10`, maxHp 18; Cleric
  `12/10/15/10/16/11`, maxHp 22. Two starter items each; the Vanguard pair is
  the fixture's sword + buckler.
- The module imports nothing from React, the DOM, or `deepspace`; **no
  randomness**. `P4.4` supplies `rawRoll` from `crypto.getRandomValues`.

### Components

```tsx
// src/components/CharacterSheetPanel.tsx
export type SheetMode = 'preview' | 'live'
export type QueryStatus = 'loading' | 'ready' | 'error'
export function CharacterSheetPanel(props: {
  campaignId: string
  mode: SheetMode
  status: QueryStatus
  character: RecordData<CharacterRow> | null   // resolved for this viewer
  items: RecordData<InventoryRow>[]            // that character's items
}): JSX.Element
```

| Mode/status | Renders |
| --- | --- |
| `preview` | the fixture character read-only: no Forge, no HP controls (testid `character-sheet`) |
| `live` + `loading` | `animate-pulse` skeleton matching the sheet's dimensions (`character-sheet-skeleton`) |
| `live` + `error` | visible notice, never fixture (`sheet-read-error`) |
| `live` + `ready` + `character === null` | Forge form (`character-forge`): name `Input` + four preset buttons (`forge-preset-vanguard` …), selected button `loading` |
| `live` + `ready` + character | name, archetype `Badge`, AC, segmented HP bar, six stat cards (`font-mono tabular-nums`), carried count, HP controls (`hp-controls`) |

```tsx
// src/components/InventoryPanel.tsx
export function InventoryPanel(props: {
  mode: SheetMode
  status: QueryStatus
  items: RecordData<InventoryRow>[]
}): JSX.Element
```

Each row keeps its name, category `Badge`, quantity and description. Live rows add
`Use` (only `category === 'consumable'`) and `Discard`; preview rows add neither.
Discard opens `ConfirmModal` titled `Discard "<itemName>"?`.

`data-testid`s: `character-sheet`, `character-sheet-skeleton`, `sheet-read-error`,
`character-forge`, `hp-controls`, `inventory-panel`, `inventory-skeleton`,
`inventory-read-error`, `inventory-use`, `inventory-discard`.

### `/home` data boundary

- `useQuery<CharacterRow>('characters', { where: { campaignId: DEFAULT_CAMPAIGN_ID } })`
  and the same for `inventory`; resolve
  `records.find(r => r.data.userId === userId)` and
  `inventoryRecords.filter(r => r.data.characterId === record.recordId)`.
- Signed out: `mode = 'preview'`, status `'ready'`, character
  `PREVIEW_CHARACTERS[0]`, items `PREVIEW_INVENTORY` filtered to it.
- Signed in: `mode = 'live'`; sheet status is the `characters` status. The pack
  status is `'loading'` while either query is loading, `'error'` when the
  `characters` read failed (it cannot be filtered to an unresolved character),
  else the `inventory` status. **Never** fixture values on the live branch.
- Roster, feed, GM console keep their `PREVIEW_*` props (`P4.*`/`P5.*`).

## Steps

### Step 1 — pure d20 rules (`P3.1`)

- Files: `src/lib/d20.ts`
- Change: the exports above, exact signatures; presets as data, no functions
  that roll; doc comment naming `P4.4` as the only caller of `classifyRoll`.
- Watch out: **no DOM/React/`deepspace` imports and no `Math.random`** — worker
  code imports this module. AC takes `armorBonus` from the preset, not a flat 2.
- Proof: `npx tsc --noEmit`; `grep` gate in § Definition of done.

### Step 2 — d20 unit tests (`P3.2`)

- Files: `src/lib/__tests__/d20.test.ts`
- Change: modifier boundaries `1→-5, 10→0, 11→0, 20→+5`; `formatModifier(0)` and
  negatives; AC with zero/positive/negative DEX modifier and an explicit
  no-clamp case (`calculateArmorClass(1, 0) === 5`); every preset has a positive
  `armorBonus`, six scores, two starter items, and the two fixture builds compute
  `calculateArmorClass(12, 5) === 16` and `calculateArmorClass(17, 1) === 14`;
  `classifyRoll` at 1/2/19/20 and `total === targetDc`.
- Watch out: node env, no jsdom; assert values, not snapshots.
- Proof: `npm run test:unit` (file count +1).

### Step 3 — live sheet read, skeleton, empty/error states (`P3.3`, `P3.7`, `P3.9`)

- Files: `src/components/CharacterSheetPanel.tsx`,
  `src/components/InventoryPanel.tsx`, `src/pages/(app)/home.tsx`
- Change: new prop contracts; home queries both collections and resolves the
  viewer's character (**deviation:** the query sits in `/home`, not the panel —
  one join for the sheet and the pack, `P3.3`'s clause and skeleton unchanged);
  skeletons on load; live read errors render a notice (never fixture); reuse the
  existing EmptyStates; delete the local `modifier()` in favour of
  `getModifier`/`formatModifier`; swap the `InventoryRow[]` props to
  `RecordData<InventoryRow>[]` so writes have record ids.
- Watch out: the sheet's "carried" count must come from the same filtered items;
  signed-out must stay deterministic (`PREVIEW_*`); `RecordData` rows from
  `useQuery` and the fixtures are structurally identical, so no adapter.
- Proof: `npm run validate`; signed-in `/home` with no character shows Forge
  (not fixture stats); signed-out `/home` shows Kaelen exactly as before.

### Step 4 — Forge adventurer (`P3.4`)

- Files: `src/components/CharacterSheetPanel.tsx`
- Change: name input + four preset buttons; on pick, `createConfirmed` the
  full 13-column `characters` row (`hp = maxHp`, `ac =
  calculateArmorClass(preset.scores.dex, preset.armorBonus)`), then two
  `createConfirmed` `inventory` rows from `starterItems`; then
  `toast.success('Adventurer Forged', …)`. Buttons `loading` while in flight,
  disabled when `!ready`. Errors toast; a character created without its items is
  reported as such (no transactions).
- Watch out: `uniqueOn ['userId','campaignId']` — a second forge for the same
  user rejects; the Forge form disappears once the row lands. `userId` must be
  included in the payload for the `CharacterRow` type, from `useAuth()`.
- Proof: forge in a signed-in window; sheet renders with preset stats, AC, full
  HP; a second window shows it without reload; DB has 1 character + 2 items.

### Step 5 — sheet numbers + HP controls (`P3.5`)

- Files: `src/components/CharacterSheetPanel.tsx`
- Change: six stat cards via `ARCHETYPE`-agnostic `ABILITY_SCORES` list,
  `font-mono tabular-nums`, `formatModifier(getModifier(score))`; HP bar composed
  from divs with `bg-success|warning|destructive` and inline width; controls
  `-5 / -1 / +1 / +5 / Short Rest` calling `putConfirmed(recordId, { hp: clamp })`,
  `loading` per pending value, success toast naming the new HP.
- Watch out: stat cards are **display-only** this phase — no `onClick`, no
  pointer affordance; the click path is `P4.8` because the browser may not roll
  (ADR 0005). Clamp `0..maxHp`; disable when `!ready` or `maxHp === 0`.
- Proof: manual — `-5` in window A drops HP in window B; at 0 further damage
  stays 0; Short Rest to `maxHp`; toast each time.

### Step 6 — inventory Use/Discard (`P3.6`)

- Files: `src/components/InventoryPanel.tsx`
- Change: per-row `Use` (consumables only) decrements `quantity` by one via
  `putConfirmed`, or `removeConfirmed` when it is the last one; `Discard` opens
  `ConfirmModal` naming the item and calls `removeConfirmed`; per-row `loading`
  and success toasts; `ready` gating.
- Watch out: no add/edit UI (ADR 0008); no healing/effect on Use (ADR 0010);
  removing the last item is a legitimate state (EmptyState, not an error).
- Proof: manual — Use on Sunfire Vial `x2 → x1`, second Use removes it; Discard
  asks by name then removes; second window mirrors both.

### Step 7 — throwaway signed-in proof, then delete it

- Files: `tests/phase3.tmp.spec.ts` (deleted before the commit)
- Change: one spec signing in as `Alice` (by name), forging a Vanguard, pressing
  `-1`, discarding an item, asserting the visible numbers.
- Watch out: `users()` picks accounts by `name`, never email; the spec must not
  be committed.
- Proof: `npm test` or `npx deepspace test run <spec>` green; file removed in
  the phase commit.

### Step 8 — docs and outcome (`P3.*` ticks, this file)

- Files: `docs/tasks.md`, `docs/plans/README.md`, this file.
- Change: tick `P3.1`-`P3.8` with notes and deviations; add `P3.9` (read-error
  states) and `P4.8` (attribute-card click); update the phase board and the
  plans index; fill § Outcome with the report's sections 1-5 verbatim.
- Proof: `npm run validate && npm run lint`; docs read coherently.

### Step 9 — deploy #1 (`P3.8`)

- Files: none (shell)
- Change: `npx deepspace deploy` on a committed, clean worktree; verify `/` and
  `/home` on the live URL.
- Watch out: the first deploy **permanently latches GitHub** as the app source
  (ADR 0008). It records the commit, so commit first and do not edit afterwards;
  any post-deploy fix is a new commit and a redeploy. If the CLI is not
  authenticated, stop and ask — credentials are the operator's.
- Proof: deploy output URL; `curl -I` on `/` and `/home`; signed-in `/home`
  renders the live table on the deployed host.

## Verification

```sh
npm run validate
npm run lint
npm run test:unit
grep -rn "Math.random\|window\.\|document\." src/lib/d20.ts
git status --porcelain
```

Manual, two signed-in windows (`Alice`, `Bob`) plus one signed-out window:

1. Signed out: `/home` shows Kaelen/Vesper, Kaelen's 3 items, no Forge, no
   Use/Discard.
2. Sign in (`Alice`): sheet shows the Forge form; forge "Vanguard" named
   `Ash`; stats `16/12/14/8/10/11`, AC 16, HP 24/24; second window updates.
3. Inventory: two Vanguard items appear; `Use` on a consumable decrements;
   `Discard` asks by name and removes.
4. HP: `-5` → 19/24 in both windows with a toast; click to 0 and below stays 0;
   Short Rest → 24/24.
5. Reload `/home`: the character persists (record, not component state).
6. Errors: (optional) sign out mid-write shows the provider's not-saved toast,
   never a silent fixture switch.

Gates that must be green this phase:

- `schemas.test.ts` still pins 13/6 columns and the six registered collections.
- No `Math.random`, DOM or React import in `src/lib/d20.ts`.
- `PREVIEW_CHARACTERS`/`PREVIEW_INVENTORY` appear in `home.tsx` only on the
  preview branch.

## Risks

| Risk | Trigger | Mitigation |
| --- | --- | --- |
| Forge is 3 writes with no transaction | character lands, an item write fails | character is still playable; toast says items failed; re-forge is blocked by `uniqueOn`, so the state is stable, not duplicated |
| Confirmed write rejects on server refusal **and** the provider toasts the same denial | permissions changed, signed out mid-write | catch and toast once from the panel; a duplicate permission toast is accepted (unreachable through this UI) |
| HP is client-authored | owner writes `hp` directly | accepted: schema `'own'` update; rolls stay server-side (ADR 0005); note in § Worth your eyes |
| Two tabs forge at once | double click, two windows | `uniqueOn` rejects the second write; Forge form disappears after the first row lands |
| Live read fails on `characters`/`inventory` | cold room error | `sheet-read-error`/`inventory-read-error` notice; **never** fall back to `PREVIEW_*` while signed in |
| Fixture/preset drift | a preset's DEX changes | unit test pins AC 16/14 and the fixture stats; presets are the only source of AC |
| Deploy latches GitHub permanently and refuses a dirty worktree | `P3.8` run before/after commit | commit and verify first; deploy is the last action; auth failure stops the phase and asks the operator |
| Attribute cards look clickable but do nothing | residual hover/cursor classes | render as plain cards; the click path is `P4.8`, recorded as a deviation |
| A write computed from the rendered row can lose a second click made before the room echoes the first | two fast clicks on HP/Use | writes are absolute and the first click disables the controls until it is confirmed; the worst case is one lost decrement, never corruption — accepted, no server counter exists |
| Signed-out preview ignores live rows once a player has forged | ADR 0014 says the preview shows the live party | deferred to `P4.9`: the roster is still a fixture, so a live sheet beside it would be incoherent. Recorded in § Outcome |

## Open questions

All settled inside this session; none escalated.

- [x] Does the attribute card roll this phase? **No.** ADR 0005 puts the roll in
      the worker; `P4.4` builds it, and `P4.8` owns the click. Cards are
      display-only.
- [x] What does "Use" do? **Spends one charge, no effect.** ADR 0010 excludes
      item effects; the write is real (quantity or removal).
- [x] Does the signed-in empty state get a second component? **No.** `P3.4`
      extends the existing `CharacterSheetPanel` EmptyState.
- [x] Do the writes need a server action? **No.** ADR 0005 governs rolls only;
      rule 4 of `tasks.md` prescribes awaited `*Confirmed` mutations for record
      writes.

## Outcome

- **Shipped:** `src/lib/d20.ts` (rules, four presets, classifier, zero imports);
  20 unit tests; a live `characters` read with skeleton and read-error states;
  Forge (name + preset → one character row + two starter items); six stat cards
  (display-only), AC and a segmented HP bar with `-5/-1/+1/+5/Short Rest`
  confirmed writes; a live pack with Use and Discard; the deterministic
  signed-out preview kept intact; deploy #1 live at
  <https://lorespace.app.space> with GitHub source latched.
- **Slipped:** the click half of `P3.5` → `P4.8` (ADR 0005 forbids a
  browser-computed roll and `rollSkillCheck` is `P4.4`). ADR 0014's live-row
  rule for the signed-out preview → `P4.9` (the roster is still a fixture until
  `P4.3`).
- **Deviations:**
  - **`P3.3` query placement:** the `characters`/`inventory` queries live in
    `/home`, which resolves the viewer's record and passes records down; the
    panels stay prop-driven. One join, so the sheet and the pack cannot disagree
    about which character is yours.
  - **`P3.5` numerals:** `pixel-numeral` (Silkscreen, `tabular-nums`) instead of
    `font-mono`, per ADR 0013 ("Silkscreen for … all numerals").
  - **`P3.2` "AC clamping":** pinned as *no clamp* — `calculateArmorClass(1, 0)
    === 5`; the DEX modifier floors, the result does not.
  - **`P3.4` no transaction:** character first, then items; a failed item write
    is reported by name in the toast, and the character row stays.
  - **`P3.6` Use:** spends one charge, no healing or item effect (ADR 0010).
  - **Added tasks:** `P3.9` (read-failure notices, done), `P4.8` (stat-card
    click), `P4.9` (signed-out preview follows live rows), all in
    [`../tasks.md`](../tasks.md).
  - **No new ADR.** Every deviation is a consequence of ADR 0005, 0010, 0013 or
    0014, or a sequencing choice inside the task text.
- **Inherited by the next phase:**
  - `src/lib/d20.ts` is the only rules module: `classifyRoll(rawRoll, total,
    targetDc)` returns the exact `roll-logs.outcome` select values; presets are
    data, `ABILITY_SCORES` is the card order. `P4.4` imports it in the worker.
  - `/home` already runs campaign-scoped `characters`/`inventory` queries and
    resolves `myCharacter`; `P4.3` joins presence peers to the same records.
  - Panel contracts: `CharacterSheetPanel({campaignId, mode, status, character,
    items})` and `InventoryPanel({mode, status, items})` take `RecordData` rows,
    not `.data`, so writes have `recordId`s. `P4.8` adds the card click inside
    the sheet; it must not move the read.
  - A signed-in player owns at most one character per campaign
    (`uniqueOn ['userId','campaignId']`); Forge disappears once the row lands.
  - Writes are awaited `*Confirmed` mutations with toasts; `ready` gates every
    control. `inventory.characterId` holds a character **recordId**.
  - The live URL exists and deploys ship the GitHub source tree with no commit
    lineage; commit before every deploy.

### 1. Shipped, by feature

| Feature | State | Files | Evidence |
| --- | --- | --- | --- |
| d20 rules (`getModifier`, `formatModifier`, `calculateArmorClass`, `classifyRoll`) | unit test | `src/lib/d20.ts`, `src/lib/__tests__/d20.test.ts` | `npm run test:unit` → 5 files / 52 tests; modifiers 1/10/11/20, AC 16/14, nat 20/1 override |
| Four Forge presets + `ABILITY_SCORES` (per-archetype armor bonus, HP, kit, blurbs) | read (Forge + sheet), unit test | `src/lib/d20.ts` | "seeds the Vanguard starter pair that the fixture shows"; "matches every fixture score, AC and HP" |
| Forge adventurer (name + preset → `characters` row + two `inventory` rows) | write | `src/components/CharacterSheetPanel.tsx` | throwaway signed-in spec: Arcanist "Ash" forged, sheet `18/18`, Forge gone, reload persists |
| Live sheet read (`characters` where `campaignId`, viewer match, skeleton, read-error notice) | read | `src/pages/(app)/home.tsx`, `src/components/CharacterSheetPanel.tsx` | spec reload shows the record; signed-out preview unchanged; no `PREVIEW_*` on the live branch |
| HP controls (`-5/-1/+1/+5/Short Rest`, clamped `0..maxHp`) | write | `src/components/CharacterSheetPanel.tsx` | spec: `-1` → `17/18` in window A and window B without reload |
| Live pack read (rows by `characterId`, skeleton, read-error notice) | read | `src/components/InventoryPanel.tsx`, `src/pages/(app)/home.tsx` | spec: forged Arcanist shows `Cinder Focus` + `Sunfire Vial x2` |
| Use (consumables only: `quantity - 1`, last one removed) | write | `src/components/InventoryPanel.tsx` | spec: `x2 → x1` in both windows, second Use removes the row |
| Discard (`ConfirmModal` naming the item → remove) | write | `src/components/InventoryPanel.tsx` | spec: dialog names "Cinder Focus", row gone after confirm |
| Signed-out preview table (Kaelen, AC 16, 3 items, no write controls) | read (fixture) | `src/pages/(app)/home.tsx` | throwaway spec + live URL check: `preview-table`, no Forge/HP/Use/Discard |
| Deploy #1 (`https://lorespace.app.space`) | route | — | both pages 200; Chromium load: landing + preview table, zero console errors |

### 2. Not real yet

| What you see | Actually | Becomes real in |
| --- | --- | --- |
| Party roster (Kaelen, Vesper) with green online dots | `PREVIEW_CHARACTERS` in `src/lib/preview-data.ts`; `online: true` hardcoded in `src/pages/(app)/home.tsx` | Phase 4 — presence peers (`P4.1`/`P4.3`) |
| Action feed with roll rows | `PREVIEW_ROLLS` in `src/lib/preview-data.ts` | Phase 4 — `rollSkillCheck` + `roll-logs` (`P4.4`) |
| GM console transcript and its input | `PREVIEW_GM_MESSAGES`; no `ai-chat` feature, no `/api/ai/chat` | Phase 5 — `ai-chat` install + GM tools |
| Six stat cards | display-only; no click handler (`CharacterSheetPanel.tsx:283-296`) | Phase 4 — `rollSkillCheck` + `P4.8` |
| Signed-out sheet and pack (Kaelen, 3 items) | `PREVIEW_CHARACTERS[0]` / `PREVIEW_INVENTORY`, shown even when live rows exist | Phase 4 — `P4.9` (ADR 0014's live-row rule) |
| Armor Class | stored at Forge from the preset, display-only; nothing attacks it | Not in this build — ADR 0010/0011 (accepted) |

### 3. Persistence check

Yes — two collections, both from the browser: `characters` (Forge creates the
owner's row; HP controls `putConfirmed` `hp`) and `inventory` (Forge creates two
starter rows; Use updates `quantity` or removes; Discard removes). All through
awaited `createConfirmed`/`putConfirmed`/`removeConfirmed` with toasts. The
`campaigns/default-campaign` seed remains the only server-action write.

### 4. Pending, by phase

- Phase 4 → roster, feed and roll banner become presence + server-computed
  `roll-logs`; the stat-card click lands (`P4.8`); the signed-out preview follows
  live rows (`P4.9`).
- Phase 5 → the GM console becomes a real streamed agent and the caller that
  makes `applyGmMutation` live.
- Phase 6 → gates, the rewritten `collab` spec, final deploy and the README's
  live URL.

### 5. Worth your eyes

| Tier | Item | Why a human | What to check | Files |
| --- | --- | --- | --- | --- |
| blocks | HP is client-authored by the character's owner (`putConfirmed(recordId, { hp })`), unlike a roll | permission boundary the demo will show; expensive to reverse once the GM narrates around it | Confirm "players may set their own HP; only rolls are server-computed (ADR 0005)" is the story | `src/components/CharacterSheetPanel.tsx:150-172` |
| blocks | `inventory` has no `userId`, so any signed-in member can delete any item through the room API; the UI filters to the viewer's pack, the schema does not | accepted risk now that the GM will grant loot | Confirm ADR 0014's accepted asymmetry still holds for player Use/Discard | `src/schemas/inventory-schema.ts:25-30`, `src/components/InventoryPanel.tsx:44-90` |
| blocks | Forge is one `characters` write plus two `inventory` writes, no transaction | data shape under failure; a half-forged character is playable | Confirm a named item-failure toast is preferable to a server action with rollback | `src/components/CharacterSheetPanel.tsx:96-140` |
| blocks | AC is frozen at Forge (`characters.ac`) and never recomputed; the presets' DEX cannot change | schema/derived-value choice, expensive to reverse | Confirm `armorBonus` 5/4/2/1 and stored AC are the contract, not live derivation | `src/lib/d20.ts:87-175`, `src/schemas/characters-schema.ts:23` |
| blocks | The four preset stat arrays, HP values, kit and blurbs are authored here, not in an ADR | product content — the only character content in the demo | Read `ARCHETYPE_PRESETS` once and confirm the four archetypes feel right at the table | `src/lib/d20.ts:87-175` |
| taste | Stat numerals use `pixel-numeral` (Silkscreen) rather than `font-mono` | visual register | Skim the six cards next to AC/HP | `src/components/CharacterSheetPanel.tsx:283-296` |
| taste | "Use" spends a charge and does nothing else | copy/mechanics expectation | Confirm "Used Sunfire Vial — 1 left" reads as intended | `src/components/InventoryPanel.tsx:44-58` |
| taste | Forge copy ("One character per player at this table…") | copy | One glance | `src/components/CharacterSheetPanel.tsx:388-405` |

- **Next:** `/phase 4` — **ready**. `P4.4` has the server-safe classifier it
  needs, `P4.3` can join the existing `characters` query, and `P4.8`/`P4.9`
  record the two things phase 3 deferred. No phase became blocked as a side
  effect of this one; phase 4 still owns its own deploy (#2).

---

## Revision — 2026-11-18 (post-deploy product review)

Appended after the Outcome above; the Outcome is not rewritten. This section is
the current contract. The phase was completed and deployed, then reviewed by the
product owner, who changed four decisions. Recorded as
[ADR 0015](../adr/0015-server-authored-character-state.md) and
[ADR 0016](../adr/0016-item-uses.md), tasks `P3.10`-`P3.14`.

**What changed and why**

| Trigger | Change |
| --- | --- |
| Players could set their own HP | `hp` is server-authored: `adjustCharacterHp` accepts one of the five sheet steps (`minus5`, `minus1`, `plus1`, `plus5`, `rest`), never a delta or target. `characters` member create/update/delete are `false`. |
| Forge was a client record write | `forgeCharacter({ name, archetype })` — server reads the preset, stamps `userId`, writes `hp = maxHp`, computes `ac`, creates the two starter items. The browser sends no stats. |
| Inventory had no `userId`; any member could delete anything | `inventory.userId` (required, immutable, plain text so a GM action can stamp the owner), `ownerField: 'userId'`, member `delete: 'own'`, `create`/`update` off. Closes `P2.2`; `update` stays off because effects are keyed by item name, so a rename would mint charges. |
| Items did not say what they do; Cleric read like Arcanist | Categories are `weapon|armor|consumable|quest` (relic dropped). Consumables heal through `useItem` (`CONSUMABLE_EFFECTS`: Sunfire Vial 6, Field Dressing 4), capped at `maxHp`, refusing at full HP. `Cleric` → `Marksman` (ranged). Copy states the mechanic first. |

**Revised contracts**

- `src/schemas/characters-schema.ts` — 13 columns, `ownerField: 'userId'`,
  `uniqueOn ['userId','campaignId']`, `archetype` options
  `Vanguard|Shadowblade|Arcanist|Marksman`; **member read-only**.
- `src/schemas/inventory-schema.ts` — 7 columns:
  `userId` (required, immutable), `characterId` (reference metadata),
  `campaignId`, `itemName`, `category` (`weapon|armor|consumable|quest`, default
  `quest`), `description`, `quantity`; `ownerField: 'userId'`; member
  `delete: 'own'` only (no create, no update).
- Actions (`POST /api/actions/:name`, bearer, RBAC off inside):
  - `forgeCharacter({name: 1-40 chars, archetype})` →
    `{characterId, name, archetype, itemsMissing[]}`; `already_forged`,
    `invalid_params`, `write_failed` (`create_character`, `membership`).
  - `adjustCharacterHp({characterId, step})` →
    `{characterId, hp: {before, after, maxHp, appliedDelta}}`; `not_owner`,
    `character_not_found`, `invalid_params`.
  - `useItem({itemId})` →
    `{itemId, itemName, heal: {requested, applied, hp, maxHp}, quantity|null}`
    (`null` = last one removed); `not_owner`, `item_not_found`, `not_usable`,
    `no_effect`, `at_full`, `write_failed` (`character_hp` with no prior write,
    or `inventory` with applied `['character_hp']`).
  - `applyGmMutation` — **owner credential only** (`not_gm` otherwise, ADR 0017);
    `grant_loot` stamps the target character's `userId`; category enum shrank to
    the four.
- `src/lib/d20.ts` — presets (Vanguard 16 AC/24 HP, Shadowblade 14/17, Arcanist
  14/18, Marksman 15/19), `CONSUMABLE_EFFECTS`, plain copy.
- Panels — `CharacterSheetPanel` no longer writes records (Forge and HP are
  actions); `InventoryPanel` keeps `removeConfirmed` for Discard only. The forge
  panel no longer takes `campaignId`.
- Review follow-ups (same session): `applyGmMutation` is owner-credential-only
  (ADR 0017), `inventory` member `update` is off, and `adjustCharacterHp` reads
  only `step` (a smuggled `delta` is ignored and tested). Accepted race:
  `useItem`'s read-modify-write of `quantity` can spend one charge twice when the
  owner races their own two tabs; no conditional-update API exists.
- Data note: locally, items created before `P3.13` have no `userId` and are
  read-only to members; production had no characters, so nothing to migrate.

**Deletion and the character limit (same session, after the review)**

- `deleteCharacter({characterId})` — owner + campaign check, drains the pack by
  paged `deleteWhere` **before** removing the row, `write_failed` stages
  `inventory`/`character` with `applied` (ADR 0018). `/settings` gains a
  **Characters** card: `Delete <name>` → `ConfirmModal` naming the character →
  toast; `/home` falls back to Forge. `P3.15`/`P3.16`.
- **One character per player stays** (ADR 0019): `uniqueOn` and
  `already_forged` remain; delete-and-reforge is the reset. Multiple characters
  would need an active-character marker, a picker, and presence/GM rules for
  `P4.1`/`P4.3` — not a demo beat.

**No player HP path (same session, product review)**

The five-step `adjustCharacterHp` action is gone, not hidden: the controls, the
testid, the handler and its tests were removed (ADR 0020), and the old route now
answers 404. HP changes only through `applyGmMutation` `character_hp` (owner
credential, ADR 0017) and `useItem` (bounded, spends a charge, ADR 0016). The
action surface is pinned to five by a test. Consequence: until `P5.3`, nothing
can lower HP, so the bar is static after Forge and `Use` always refuses at full
HP — recorded in "not real yet", not hidden behind a control.

**Revised verification**

- `npm run validate` → 5 files / 89 tests; `npm run lint` clean;
  `npx tsc --noEmit` clean.
- Throwaway signed-in specs (deleted before commit), four runs: Forge, `-5` HP,
  Use (heal + clamp), full-HP refusal, Discard and reload all passed, and the
  worker log shows `[action] "forgeCharacter"`, `"adjustCharacterHp"`,
  `"useItem"`, `"deleteCharacter"` — the page makes no record writes.
- Delete proof: settings `Delete "Wren"` → `characters-empty` → `/home` Forge →
  forge again → delete again, with the kit not resurrected.
- No-HP-path proof: no `hp-controls` or HP buttons in the sheet, the removed
  route answers 404 `Action not found`, and Use at full HP is refused with the
  charge kept.
- Independent review found and closed two holes in the same session: member
  `inventory.update` (rename a sword into a vial) and `applyGmMutation`'s
  membership authority (any player could set their own HP). Both now have tests
  that fail if the hole reopens.
- Redeployed: release `rel_01M7RT6QQSW1VKDTTRE3WYQG3E` at
  <https://lorespace.app.space>. Live check: landing + preview table with the
  new copy, no write controls signed out, zero console errors.
- Redeployed again for deletion: release `rel_01M7RVAWPYQY5WJ12QQZ8V4AKA`.
  Live check: `/`, `/home`, `/settings` serve; signed-out `/settings` gates.

### Revised feature inventory (sections 1-5)

See the phase close-out report in this session; it supersedes the Outcome's
sections 1-5 above. The report's five sections are the authoritative inventory
for the shipped state after `P3.10`-`P3.14`.
