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

- [ ] `npm run validate` and `npm run lint` pass
- [ ] `npm run test:unit` includes `src/lib/__tests__/d20.test.ts`; AC 16/14 and
      modifier boundaries (1/10/11/20) pinned
- [ ] `grep -rn "Math.random\|window\.\|document\." src/lib/d20.ts` finds nothing
- [ ] `grep -rn "PREVIEW_INVENTORY\|PREVIEW_CHARACTERS" 'src/pages/(app)/home.tsx'`
      shows character/inventory fixtures only on the `preview` branch (roster
      stays fixture until `P4.3`)
- [ ] Forge, HP adjust, Use and Discard each perform a write visible in a second
      browser window without reload
- [ ] Live URL: `/` and `/home` serve after `P3.8`

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

Filled in at the end of the phase.
