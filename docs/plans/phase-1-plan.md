# Phase 1 — Obsidian theme, landing page, workspace shell

- **Status:** Done
- **Session:** 2026-11-18, phase 1 orchestrator session (`/phase 1`)
- **Governing tasks:** [`P1.1`–`P1.14`](../tasks.md#phase-1--theme-landing-page-workspace-shell)
- **ADRs in force:** [0001](../adr/0001-schemas-before-ui.md) (schemas before
  UI, satisfied by 2a), [0008](../adr/0008-playable-interview-build.md)
  (eight-beat script, cut list: no theme switcher, no `data-ui-theme`),
  [0010](../adr/0010-rules-depth.md) (six attributes only),
  [0011](../adr/0011-content-arc.md) (one arc, three scene states — the seed is
  the **threshold** state), [0013](../adr/0013-visual-register.md) (pixel chrome
  register), [0014](../adr/0014-public-read-table.md) (public-read preview,
  fixture fallback only when the seed is absent)
- **Depends on:** Phase 2a outcome — six registered collections, exact column
  names, `DEFAULT_CAMPAIGN_ID`/`DEFAULT_CAMPAIGN_PRESENCE_SCOPE` in
  `src/constants.ts`. Phase 0 for the Playwright suites only.
- **Unblocks:** Phase 2 (`P2.5` mounts its action in this shell), Phase 3
  (sheet/inventory panels exist and take records as props), Phase 4
  (`PartyPresenceBar` wraps this roster; roll banner slots into this feed),
  Phase 5 (`GmConsolePanel` container exists in the center column), Phase 6
  (`P6.3` asserts the `/home` H1 and `workspace-shell`/`preview-table` test ids
  fixed here).

## Goal

The app stops looking like scaffolding. A visitor lands on one screen that reads
as a gothic pixel-ward tabletop product, clicks **Enter the table**, and gets a
populated three-column VTT workspace — scene banner, party roster, dice/action
feed, AI GM stream, character sheet, inventory — signed out as a live preview and
signed in as the same table. Everything is theme-token driven, prop-driven, and
deterministic, so Phases 3–5 swap sample data for queries without rewriting
markup.

## Definition of done

- [ ] `npm run validate` (`tsc --noEmit` + Vitest) and `npm run lint` pass.
- [ ] `npm run build` passes: the landing page still prerenders (head stamps
      exactly one `<title>`/description/canonical, body has an `<h1>`, root
      placeholder intact).
- [ ] All `P1.12` grep gates green; `grep -rn 818cf8 src/` → 0 hits (no indigo
      leak out of any unthemed token).
- [ ] `[data-theme="obsidian"]` in `src/themes.css` overrides all **21** tokens
      (19 colors + `--color-shell` + `--color-shell-panel`) and sets
      `--radius: 0`; `THEMES` contains only `obsidian`.
- [ ] `/` is one screen: Design Direction block first in file, split hero with a
      hand-authored inline-SVG d20, zero raster files, zero hardcoded colors in
      JSX, CTA copy **Enter the table** → `/home`, `data-testid="static-landing"`
      and `<Seo>` intact.
- [ ] `/home` renders the same 3-column shell signed out and signed in, from
      live campaign rows when the `default-campaign` row exists and from
      `src/lib/preview-data.ts` otherwise; the signed-out banner owns its
      `AuthOverlay` and party members never carry `nav-user-name`.
- [ ] Nav test ids still pass `smoke` + `collab`: `app-navigation`,
      `nav-sign-in-button`, `nav-user-name`, `nav-user-email`; `signOut()`
      reachable from the account menu.
- [ ] `npm test` (smoke + api) green and `npx deepspace test run
      tests/collab.spec.ts` 3/3.
- [ ] `README.md` is a real front door skeleton, with the live URL and
      screenshot marked as P6.7's job.

## Scope

**In scope**

- `src/themes.css`, `src/styles.css`, `src/main.tsx` — obsidian tokens, pixel
  chrome utilities, Silkscreen ([`P1.1`](../tasks.md), [`P1.13`](../tasks.md))
- `package.json` — `@fontsource/silkscreen` dependency (self-hosted font)
- `src/themes.ts`, `index.html`, `src/seo.ts`, `src/constants.ts` (`APP_DISPLAY_NAME`),
  `src/pages/(app)/_layout.tsx` (one-line `<title>`)
  ([`P1.2`](../tasks.md), [`P1.3`](../tasks.md), [`P1.4`](../tasks.md))
- `src/pages/index.tsx` — Design Direction block + split hero
  ([`P1.5`](../tasks.md), [`P1.6`](../tasks.md))
- `src/lib/preview-data.ts` — schema-exact fixture ([`P1.9`](../tasks.md))
- `src/components/vtt/*` — `SceneBanner`, `PartyRoster`, `ActionFeed`,
  `SignInBanner`; `src/components/CharacterSheetPanel.tsx`,
  `src/components/InventoryPanel.tsx`, `src/components/GmConsolePanel.tsx`
  ([`P1.8`](../tasks.md), [`P1.10`](../tasks.md))
- `src/pages/(app)/home.tsx` — the shell ([`P1.7`](../tasks.md),
  [`P1.8`](../tasks.md), [`P1.9`](../tasks.md), [`P1.11`](../tasks.md))
- `README.md` ([`P1.14`](../tasks.md))
- `docs/tasks.md` ticks, phase board, this plan's Outcome

**Out of scope (explicit non-goals)** — a reader might expect these here; they
live elsewhere:

- Any `useQuery` on `characters`/`inventory`/`roll-logs`, and any write. Phase 3
  (`P3.3`, `P3.6`) and Phase 4 (`P4.3`, `P4.4`) own those; the panels here take
  records as props.
- Presence, online dots from a real room, roll broadcasting → Phase 4 (`P4.1`).
  The roster here is `PartyRoster` with a static `online` flag; `P4.1`'s
  `PartyPresenceBar` wraps it.
- `ensureDefaultCampaign`, `applyGmMutation`, the seeding skeleton → Phase 2
  (`P2.3`–`P2.5`). This phase renders the fixture when the row is absent.
- Forge / stat allocation / HP controls / inventory Use-Discard → Phase 3. The
  sheet and inventory panels are presentational only.
- `ChatPanel`, `/api/ai/chat`, GM tools, quick chips → Phase 5 (`P5.1`–`P5.7`).
  `GmConsolePanel` is a static container with a `messages` prop.
- Theme switcher, `data-ui-theme`, a second light theme → cut by
  [ADR 0008](../adr/0008-playable-interview-build.md). `paper` is deleted.
- Screenshots, live URL, final README copy → Phase 6 (`P6.7`).
- Deploy. Nothing is deployed in this phase (`P3.8` is Deploy #1).

## Entry state (verified)

| Thing | State | Where |
| --- | --- | --- |
| `src/themes.css` | one `[data-theme="paper"]` block only; 19 colors + 2 shadows + 2 shell tokens | `src/themes.css:24-46` |
| `src/styles.css` `@theme` | **all 21** tokens present; `--color-primary`/`--color-ring` = indigo `#818cf8`; `--radius: 0.5rem` + 5 derived radius tokens; status colors intentionally unthemed | `src/styles.css:19-96` |
| `src/styles.css` utilities | only shadcn `animate-in`/`animate-out`/`fade`/`slide`; **no** pixel chrome | `src/styles.css:112-145` |
| Fonts | no `@font-face`, no `@fontsource/*`; body stack `'SF Pro Text', -apple-system…` at 14px; no pixel font anywhere | `src/styles.css:163-171`, `package.json` |
| `src/themes.ts` | `THEMES` = `[slate, paper]`; `getActiveTheme()` falls back to `'slate'` twice; `getTheme()` falls back to `THEMES[0]` | `src/themes.ts:19-44` |
| `index.html` | `lang="en" data-theme="slate"`, `<title>lorespace</title>`, first-paint `html { background-color: #0a0a0a }` + a `paper` line | `index.html:7-24` |
| `src/seo.ts` | `title: APP_NAME` (`'lorespace'`), generic description | `src/seo.ts:23-34` |
| `src/pages/index.tsx` | scaffold hero, `static-landing`, CTA "Enter the app", no Direction block | `src/pages/index.tsx:26-46` |
| `src/pages/(app)/home.tsx` | 28-line placeholder, `useAuthProfileReady({ requireUser: true })`, no test ids | `src/pages/(app)/home.tsx` |
| `(app)/_layout.tsx` | `h-screen … overflow-hidden` flex column, `<main className="flex-1 overflow-y-auto min-h-0">` is the only scroll container; `<title>{APP_NAME}</title>` | `src/pages/(app)/_layout.tsx:32-41` |
| Navigation | `app-navigation:72`, `nav-user-name:104` (`hidden sm:inline`), `nav-user-email:122` (inside the account menu), `nav-sign-in-button:137`; `signOut()` at `:129`; owns `AuthOverlay` | `src/components/Navigation.tsx` |
| UI kit | `Button` (+`loading`), `Badge`, `Avatar`, `EmptyState` (`icon/title/description/action/secondaryAction`), `useToast`, `ConfirmModal`; **no** `Card`, `Progress`, `Skeleton`, `Separator`; `AuthOverlay` comes from `deepspace` (props `onClose?, providers?, title?, description?, logo?`), not from the kit | `src/components/ui/index.ts`, `deepspace/dist/index.d.ts:2120-2132` |
| Data components / fixtures | none — no `.tsx` under `src/` mentions campaign/character/inventory; no fixture files | verified by grep |
| `src/constants.ts` | `APP_NAME='lorespace'`, `APP_ID`, `SCOPE_ID`, `DEFAULT_CAMPAIGN_ID`, `DEFAULT_CAMPAIGN_PRESENCE_SCOPE` | `src/constants.ts` |
| Prerender | `PRERENDER_ROUTES = ['/']`; requires literal `<div id="root"></div>`, a `<div data-testid="app-root"` anchor, a head with exactly one title/description/canonical/og set, and `<h`/`<p>` in the body; SSR pass has `react()` only — any `window`/`document`/nondeterminism breaks it | `prerender.ts:40,119-167`, `src/prerender-entry.tsx:28-32` |
| Smoke assertions | `/`: `static-landing` visible, **zero** console errors, static contract (no `/api/auth/`, no `/ws/`), exactly 1 description + 1 canonical. `/home`: `app-navigation` + `nav-sign-in-button` visible, `nav-user-name` count **0** unsigned-out | `tests/smoke.spec.ts:17-69` |
| Collab assertions | signed in: `app-navigation` visible, `nav-user-name` has text, account menu → `nav-user-email` equals the address | `tests/collab.spec.ts:50-61` |
| Gates today | all four `P1.12` gates FAIL (slate in `index.html`, "placeholder page" in `home.tsx`, no `home pattern:`, no obsidian block) | verified by grep |
| Build | `npm run build` = `vite build` (prerender + checker). It is the only proof the landing still SSGs | `package.json`, `vite.config.ts` |

## Contracts

### Theme and design tokens

`[data-theme="obsidian"]` in `src/themes.css` overrides **all 21** tokens. Exact
values (the six fixed by `P1.1` are marked •; the rest are derived from them and
must not reintroduce indigo):

| Token | Value | |
| --- | --- | --- |
| `--color-background` | `#09090b` | • |
| `--color-foreground` | `#f4f4f5` | • |
| `--color-card` | `#121216` | • |
| `--color-card-foreground` | `#f4f4f5` | |
| `--color-popover` | `#121216` | |
| `--color-popover-foreground` | `#f4f4f5` | |
| `--color-primary` | `#d97706` | • |
| `--color-primary-foreground` | `#09090b` | |
| `--color-secondary` | `#1b1b20` | |
| `--color-secondary-foreground` | `#f4f4f5` | |
| `--color-muted` | `#17171b` | |
| `--color-muted-foreground` | `#a1a1aa` | |
| `--color-accent` | `#1f1f24` | |
| `--color-accent-foreground` | `#f4f4f5` | |
| `--color-destructive` | `#dc2626` | • |
| `--color-destructive-foreground` | `#f4f4f5` | |
| `--color-border` | `#27272a` | • |
| `--color-input` | `#3f3f46` | |
| `--color-ring` | `#d97706` | |
| `--color-shell` | `#09090b` | |
| `--color-shell-panel` | `#121216` | |

Plus, in the same block: `color-scheme: dark`, `--radius: 0` **and**
`--radius-sm/md/lg/xl/2xl: 0` (the `@theme` derived values are
`calc(var(--radius) ± n)` and would compute negative at runtime), and hard pixel
shadows `--shadow-card: 2px 2px 0 0 #000` / `--shadow-card-hover: 3px 3px 0 0 #000`.

`@theme` in `src/styles.css` is **re-based to the obsidian values** (not left on
slate) so no indigo survives in the compiled default; the `[data-theme]` block
then restates all 21 so the contract holds if the default ever changes. Status
colors (`--color-success|warning|info`) stay untouched by design.

### Shared chrome classes (`src/styles.css`)

Consumed by every component; no per-component pixel art (ADR 0013). Names are
contract, styling may evolve:

| Class / utility | Rule | Used by |
| --- | --- | --- |
| `font-pixel` | Tailwind utility from `--font-pixel: 'Silkscreen', ui-monospace, SFMono-Regular, Menlo, monospace` | labels, badges, numerals |
| `.pixel-numeral` | `font-family: var(--font-pixel)` + `font-variant-numeric: tabular-nums` + `letter-spacing: .04em` | every number in the shell |
| `.pixel-frame` | stepped 2px border: `border: 2px solid var(--color-border)` + hard offset `box-shadow: 4px 4px 0 0 color-mix(in srgb, #000 55%, transparent)` | panels, banner, cards |
| `.pixel-dither` | `repeating-linear-gradient(45deg, … 0 2px, transparent 2px 4px)` over `--color-card` | banner + hero glow |
| `.pixel-rule` | 2px ornamental divider: `repeating-linear-gradient(90deg, var(--color-border) 0 6px, transparent 6px 10px)` | section separators |
| `.hp-segment` | inset 1px `--color-background` bevel for one HP block | segmented HP bar (sheet + enemy) |
| `.pixel-strip` | `repeating-linear-gradient` scanline overlay, `opacity: .06`, `pointer-events: none` | scene banner only |

Keyframes live beside them and are wrapped in
`@media (prefers-reduced-motion: no-preference)`: `d20-trace` (stroke-dashoffset
0), `roll-tick` (banner stamp-in), `hp-fill` (segment width). Reduced motion gets
the final state, not a blank element.

### Font

`@fontsource/silkscreen` (self-hosted woff2, no runtime network), imported once
in `src/main.tsx`. Fallback stack `ui-monospace, SFMono-Regular, Menlo,
monospace` so Silkscreen's absence shifts little. Silkscreen is **labels,
badges and numerals only**; prose and headings stay in the sans stack (ADR 0013,
and the platform rule against a novelty face carrying body copy).

### Constants (`src/constants.ts`)

```ts
/** Product name for page titles and chrome; APP_NAME stays the app slug. */
export const APP_DISPLAY_NAME = 'LoreSpace'
```

Consumers: `src/seo.ts`, `src/pages/index.tsx`, `src/pages/(app)/home.tsx`,
`src/pages/(app)/_layout.tsx` (`<title>` only). `APP_NAME` is untouched, so the
scaffold's identifiers and `SCOPE_ID` derivation do not move.

### Theme catalog (`src/themes.ts`)

`THEMES` = one entry: `{ id: 'obsidian', label: 'Obsidian', description:
'Near-black stone, amber signal, zero radius.' }`. `ThemeId` becomes
`'obsidian'`. `getActiveTheme()` falls back to `'obsidian'` (both branches) and
`getTheme()` to `THEMES[0]`. `paper` and `slate` are deleted from the catalog and
from `themes.css` (theme switching is cut by ADR 0008; a light block that
half-overrides a dark baseline is a trap).

### Fixture (`src/lib/preview-data.ts`)

Schema-exact rows — no invented fields (ADR 0014). Each array is
`RecordData<T>[]` (the type `useQuery` returns), so Phase 3's swap is
`records` in place of `preview`:

```ts
import type { RecordData } from 'deepspace'

export interface CampaignRow { title; locationName; atmosphereTag; sceneSummary;
  activeThreatDc; enemyName; enemyHp; enemyMaxHp }               // 8 columns
export interface CharacterRow { userId; campaignId; name; archetype; hp; maxHp;
  ac; str; dex; con; int; wis; cha }                              // 13 columns
export interface InventoryRow { characterId; campaignId; itemName; category;
  description; quantity }                                         // 6 columns
export interface RollLogRow { userId; campaignId; characterName; entryType; statName;
  rawRoll; modifier; total; targetDc; outcome; summary; rolledAt } // 12 columns

export const PREVIEW_CAMPAIGN: RecordData<CampaignRow>        // recordId = DEFAULT_CAMPAIGN_ID
export const PREVIEW_CHARACTERS: RecordData<CharacterRow>[]   // recordIds 'char-kaelen', 'char-vesper'
export const PREVIEW_INVENTORY: RecordData<InventoryRow>[]    // characterId = a character **recordId**
export const PREVIEW_ROLLS: RecordData<RollLogRow>[]
```

`createdBy` is `'preview'` and `createdAt`/`updatedAt` are fixed ISO strings —
they are `RecordData` envelope fields, not schema columns (§ Verified client
types). `inventory.characterId` stores the character's **recordId**
(`'char-kaelen'`), which is what `P3.6` will put in `where: { characterId }`;
the panel only ever sees the bare row.

`PREVIEW_CAMPAIGN` is the **threshold** state of ADR 0011's arc — the same row
`P2.3` must seed (this is the drift guard; Phase 2 copies these values):

| Field | Value |
| --- | --- |
| `id` (record id) | `DEFAULT_CAMPAIGN_ID` |
| `title` | `Chronicles of the Obsidian Vault` |
| `locationName` | `The Ashen Threshold` |
| `atmosphereTag` | `exploration` |
| `sceneSummary` | `Ash drifts across a broken causeway. Runic fire burns green in the braziers, and a sealed door waits beyond them.` |
| `activeThreatDc` | `12` |
| `enemyName` / `enemyHp` / `enemyMaxHp` | `''` / `0` / `0` (no enemy until the GM moves to the brazier fight) |

`PREVIEW_CHARACTERS` (2): `Kaelen` (Vanguard, HP 22/24, AC 16, STR 16 DEX 12 CON
14 INT 8 WIS 10 CHA 11) and `Vesper` (Shadowblade, HP 17/17, AC 14, STR 10 DEX 17
CON 12 INT 12 WIS 10 CHA 14). `userId` values are stable strings (`'preview-kaelen'`,
`'preview-vesper'`) because their only role is React keys and ownership display —
nothing writes them. `PREVIEW_INVENTORY` (3 rows for Kaelen: `Ashen Longsword`
weapon, `Cracked Buckler` armor, `Sunfire Vial` consumable). `PREVIEW_ROLLS` (4
rows): one `roll` with `rawRoll 14, modifier 3, total 17, targetDc 12, outcome
'success'`; one `roll` nat-1 `critical_failure`; one `gm_event`; one `combat`.
`rolledAt` values are fixed epoch ms (deterministic — no `Date.now()`).

### Components (props are the data boundary — `P1.10`)

| File | Export + props | Notes |
| --- | --- | --- |
| `src/components/vtt/SceneBanner.tsx` | `SceneBanner({ campaign }: { campaign: CampaignRow })` | renders the page `<h1>` (campaign `title`, so `/home` has exactly one), location, atmosphere `Badge`, `DC {activeThreatDc}` in Silkscreen, enemy block **only when `enemyMaxHp > 0`** (segmented HP from `enemyHp/enemyMaxHp`), `sceneSummary`. `data-testid="scene-banner"` |
| `src/components/vtt/PartyRoster.tsx` | `PartyRoster({ members }: { members: RosterMember[] })` where `RosterMember = { id: string; name: string; archetype: string; hp: number; maxHp: number; online?: boolean }` | `Avatar` initials, name, archetype badge, HP numeral, online dot. **No** `nav-user-name`. `data-testid="party-roster"`. `P4.3` feeds it presence×characters |
| `src/components/vtt/ActionFeed.tsx` | `ActionFeed({ entries }: { entries: RollLogRow[] })` | newest first; roll rows show `d20(raw) + mod = total vs DC` in `pixel-numeral`, outcome `Badge`: `success`/`critical_success` → green (`success`), `failure` → amber (`warning`), `critical_failure` → crimson (`destructive`), `info` → muted (`secondary`). Green success vs amber failure keeps the two readable at a glance; crimson stays reserved for the critical failure that costs HP (ADR 0013). `gm_event`/`combat` rows are prose. `data-testid="action-feed"` |
| `src/components/vtt/SignInBanner.tsx` | `SignInBanner()` | own `useState` + `<AuthOverlay onClose>`; copy names the table, `Button` "Sign in". No nav test ids. `data-testid="signed-out-banner"` |
| `src/components/CharacterSheetPanel.tsx` | `CharacterSheetPanel({ character, inventory }: { character: CharacterRow | null; inventory: InventoryRow[] })` | `P3.3`'s file: 6 attribute cards (`font-mono tabular-nums` today, Silkscreen numerals later if it reads), AC, segmented HP; `character === null` → `EmptyState` (`Shield` icon, title "No character at this table", description "Your sheet appears here once an adventurer is forged.") with **no action** — `P3.4` adds Forge. `data-testid="character-sheet"` |
| `src/components/InventoryPanel.tsx` | `InventoryPanel({ items }: { items: InventoryRow[] })` | `P3.6`'s file: list with category badge + quantity; empty → local `EmptyState` (`Backpack` icon). Read-only: no Use/Discard (`P3.6` adds them). `data-testid="inventory-panel"` |
| `src/components/GmConsolePanel.tsx` | `GmConsolePanel({ messages }: { messages: Array<{ id: string; role: 'gm' \| 'player'; text: string }> })` | `P5.7`'s container: header "Game Master", static stream, disabled-looking input row (a real `<input>` is Phase 5's). `data-testid="gm-stream"` |

All take data as props; none imports `useQuery`, `usePresenceRoom`, or mutations.

### Routes / pages

- `/` (`src/pages/index.tsx`) — static, prerendered. Design Direction block is
  the first thing in the file (exact template below), then imports.
  `data-testid="static-landing"` wraps the page; `<Seo {...seo} path="/" />` is
  the first child. Headline 3–8 words, ≤150 words of body copy, one commanding
  visual, CTA **Enter the table** → `/home`. Deterministic: no `window`,
  `document`, `Math.random`, `Date.now`; motion is CSS keyframes only, wrapped in
  `prefers-reduced-motion: no-preference`; the d20 is one hand-authored inline
  SVG using `currentColor`/`var(--color-*)`, never hex in JSX.
- `/home` (`src/pages/(app)/home.tsx`) — first line is exactly the `P1.7`
  comment. Container: `const { isSignedIn } = useAuth()`;
  `useQuery<CampaignRow>('campaigns')` →
  `campaign = rows.find(r => r.recordId === DEFAULT_CAMPAIGN_ID)?.data ?? PREVIEW_CAMPAIGN`
  (fixture until live rows arrive; no skeleton in this phase). Shell:
  `data-testid="workspace-shell"` (`+ data-testid="preview-table"` when signed
  out), `flex h-full min-h-0 flex-col bg-shell`, banner row `shrink-0`, then
  `grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_340px]`,
  each column `min-h-0 overflow-y-auto bg-shell-panel`. Composition:
  banner spans the top; **left** `PartyRoster`, **center** `ActionFeed` +
  `GmConsolePanel`, **right** `CharacterSheetPanel` + `InventoryPanel`;
  `SignInBanner` sits under the banner row when signed out. H1 comes from
  `SceneBanner` (campaign `title`; P6.3 asserts an H1 exists).

### Verified client types (0.44.2, read from `dist/index.d.ts`)

```ts
useAuth(): { isLoaded: boolean; isSignedIn: boolean; userId: string | null; sessionId: string | null }
useQuery<T>(collection: string, options?: { where?; orderBy?; orderDir?; limit? }):
  { records: RecordData<T>[]; status: 'loading' | 'ready' | 'error'; error?: string }
RecordData<T> = { recordId: string; data: T; createdBy: string; createdAt: string; updatedAt: string }
```

So the campaign lookup keys on **`record.recordId`**, not `record.id` — `tasks.md`
phase 2a calls it "record id", and this is the exact field. Panels take the bare
`data` row, not `RecordData`.

### Test ids

Existing, unchanged: `app-navigation`, `nav-sign-in-button`, `nav-user-name`,
`nav-user-email`, `app-root`, `static-landing`. New, for `P6.3`:
`workspace-shell`, `preview-table`, `scene-banner`, `party-roster`, `action-feed`,
`gm-stream`, `character-sheet`, `inventory-panel`, `signed-out-banner`.

### Design Direction block (exact template, from the platform docs)

```tsx
/**
 * Design Direction
 *
 * Product: ...
 * Emotion: ...
 * Metaphor: ...
 * References: ...
 * Signature: ...
 * Hero: ...
 *
 * Style Tile
 * - Color: ...
 * - Type: ...
 * - Theme: ...
 * - Art direction: ...
 * - Motion: ...
 * - Voice: ...
 */
```

## Steps

### Step 1 — Font, obsidian tokens, chrome utilities (`P1.1`, `P1.13`)

- Files: `package.json` (+ `package-lock.json`), `src/main.tsx`,
  `src/themes.css`, `src/styles.css`
- Change: add `@fontsource/silkscreen`, import `@fontsource/silkscreen/400.css`
  in `src/main.tsx`; add `--font-pixel` to `@theme`; re-base the `@theme` colors
  to obsidian; add the `[data-theme="obsidian"]` block with all 21 tokens,
  `color-scheme: dark`, `--radius: 0` + the five derived radius tokens, hard
  shadows; delete `[data-theme="paper"]`; add the § Contracts chrome classes and
  keyframes (all motion inside `@media (prefers-reduced-motion: no-preference)`).
- Watch out: a missed token leaks `#818cf8` — the 21 are exactly the
  `@theme` color block (`styles.css:21-39`, `:91-92`), and status colors are
  **not** part of them. `--radius-sm` etc. must be zeroed explicitly. Keep
  `@source` lines and the existing `@layer base` (`color-scheme: dark` stays).
  Do not add `@font-face` by hand — fontsource ships it, and a hand-rolled
  `public/fonts` copy would be a raster-era trap.
- Proof: `grep -c -- '--color-' src/themes.css` ≥ 21 inside the block;
  `grep -n 'data-theme="obsidian"' src/themes.css`; `grep -rn 818cf8 src/` → 0;
  `npm run type-check`; `npm run build` still succeeds (CSS compiles).

### Step 2 — Theme catalog, first paint, SEO, display name (`P1.2`, `P1.3`, `P1.4`)

- Files: `src/themes.ts`, `index.html`, `src/seo.ts`, `src/constants.ts`,
  `src/pages/(app)/_layout.tsx`
- Change: `THEMES` = `[obsidian]`; both `getActiveTheme()` fallbacks and
  `getTheme()` fallback → obsidian. `index.html`: `data-theme="obsidian"`,
  `<title>LoreSpace — Multiplayer AI Tabletop RPG</title>`, first-paint
  `html { background-color: #09090b; color-scheme: dark; }` plus
  `html[data-theme="obsidian"] { background-color: #09090b; color-scheme: dark; }`,
  delete the `paper` line and the slate reference. `seo.ts`: title
  `LoreSpace — Multiplayer AI Tabletop RPG`, description one plain sentence
  (~150 chars) naming the product as a multiplayer AI tabletop with a live dice
  table. `constants.ts`: `APP_DISPLAY_NAME`. `_layout.tsx`: `<title>` uses
  `APP_DISPLAY_NAME`.
- Watch out: `prerender.ts` `stampHead` throws if the head keeps a second
  `<title>`/description/canonical or any `og:` — change the title **text** only;
  keep `<div id="root"></div>` and the `<style>` block's shape. `html` must keep
  `lang="en"`.
- Proof: `grep -rn 'data-theme="slate"' index.html` → 0;
  `grep -rn 'data-theme="obsidian"' index.html src/themes.css` → 2 files;
  `grep -n APP_DISPLAY_NAME src/constants.ts`; `npm run build` passes (prerender
  head stamps) and `npx deepspace test run smoke` title assertion
  (`toHaveTitle(/\S/)`) still green.

### Step 3 — Landing page (`P1.5`, `P1.6`)

- Files: `src/pages/index.tsx`; optional `src/components/landing/*.tsx` (presentational, props-free)
- Change: Design Direction block first (§ exact template), filled with the ADR
  0013 register and the ADR 0008 beat-1 voice; split hero: verb-first copy left
  (headline 3–8 words, ≤150 words total for the page), right a live-rendered,
  deterministic d20 skill-check + character-sheet mockup (one inline SVG d20
  that draws itself with `d20-trace`, styled divs for the sheet stamp); CTA
  **Enter the table** → `/home`. Keep `<Seo>` first and
  `data-testid="static-landing"` on the wrapper.
- Watch out: the platform anti-AI gate runs on these files — no hex/rgba/`*-500`
  color classes, no `text-foreground/60`, no `foreground/[0.6]`, no emoji
  (U+1F000–1FFFF), no "streamline/transform/cutting-edge" copy, no `TODO`, no
  `Math.random`/`Date.now`/`window`/`document`, no raster import. The SVG must
  spend `currentColor`/`var(--color-*)`. Headline ≥3× body size (14px body →
  ≥42px), one commanding visual, one CTA.
- Proof: `npm run build` (prerender renders the page in an SSR pass with no
  browser); `npx deepspace test run smoke` → `/` tests green with **zero console
  errors**; the § Verification anti-AI greps → 0 hits; `grep -n 'static-landing'
  'src/pages/index.tsx'`; `grep -c '<svg' 'src/pages/index.tsx'` ≥ 1.

### Step 4 — Preview fixture and presentational panels (`P1.9` fixture, `P1.10`)

- Files: `src/lib/preview-data.ts` (new), `src/components/vtt/SceneBanner.tsx`,
  `PartyRoster.tsx`, `ActionFeed.tsx`, `SignInBanner.tsx`,
  `src/components/CharacterSheetPanel.tsx`, `src/components/InventoryPanel.tsx`,
  `src/components/GmConsolePanel.tsx` (all new)
- Change: exactly the § Contracts shapes. Fixture values pinned to the `P2.3`
  seed (threshold state). Panels render from props only, consume `pixel-frame` /
  `pixel-numeral` / `hp-segment`, use local kit primitives (`Badge`, `Avatar`,
  `EmptyState`, `Button`) and `lucide-react` icons; no hex, no native
  `<select>`/`confirm`/`alert`/`prompt`.
- Watch out: `characterId` is inventory's join key (metadata only, no FK) — the
  sheet's `inventory` prop is filtered by the holder in `home.tsx`, not inside
  the panel. Segmented HP must clamp (`0..maxHp`) and degrade at `maxHp = 0`
  (render nothing, never `NaN`). Do not import `useQuery` anywhere here.
- Proof: `npm run type-check` + `npm run lint`; `grep -rn "useQuery\|useMutation\|usePresenceRoom" src/components/CharacterSheetPanel.tsx src/components/InventoryPanel.tsx src/components/vtt/ src/components/GmConsolePanel.tsx` → 0; `grep -rnE "#[0-9a-fA-F]{6}" src/components src/lib` → 0.

### Step 5 — Workspace shell and signed-out branch (`P1.7`, `P1.8`, `P1.9`, `P1.11`)

- Files: `src/pages/(app)/home.tsx`
- Change: line 1 exactly
  `/* home pattern: product-preview-first — live multiplayer VTT campaign table, dice log, and character sheet */`.
  `useAuth().isSignedIn` for the branch (not `useAuthProfileReady`); one
  `useQuery('campaigns')` with the fixture fallback; compose banner → 3 columns
  as in § Routes; pass `PREVIEW_CHARACTERS`/`PREVIEW_INVENTORY`/`PREVIEW_ROLLS`
  and a static GM message list; `SignInBanner` when signed out; `character ===
  null` only when signed in and no row resolves (Phase 3 fills that).
- Watch out: `_layout` already supplies `h-screen` + the only scroll container —
  the shell must be `h-full min-h-0` and scroll **inside** columns, or `/home`
  grows a second scrollbar. `nav-user-name` must not appear anywhere in the
  shell (smoke asserts count 0 signed out). `AuthOverlay` is imported from
  `deepspace`, not from `@/components/ui`. Do not gate on `user` truthiness.
- Proof: `head -1 'src/pages/(app)/home.tsx'` is the exact comment;
  `npx deepspace test run smoke` green (nav ids, `nav-user-name` count 0, no
  console errors); `npx deepspace test run tests/collab.spec.ts` 3/3 (account
  menu + email); manual signed-out `/home`: 3 columns, populated fixture, banner.
  `grep -n "placeholder page" src/` → 0.

### Step 6 — README front door skeleton (`P1.14`)

- Files: `README.md`
- Change: what LoreSpace is (3 sentences, ADR 0008's beat-1 framing), the live
  URL as an explicit `P6.7` placeholder line, one screenshot slot (path +
  caption; the file lands in `P6.7`), local run (`npx deepspace dev start`) and
  the two verification commands, and a pointer to `docs/adr/`.
- Watch out: do not invent a deployed URL or a screenshot that does not exist.
  Marking them as pending is honest; a dead link is not.
- Proof: `grep -n "app.space\|screenshot\|deepspace dev start" README.md`.

### Step 7 — Gates, ticks, verification, commit (`P1.12`)

- Files: `docs/tasks.md`, this plan
- Change: tick `P1.1`–`P1.14` with `— 2026-11-18 phase 1`; phase board row 1 →
  `done`, row 2 → `next`; fill § Outcome (shipped / slipped / deviations /
  inherited / Next).
- Proof: the whole § Verification block below, plus `git status` clean after
  `git commit -m "phase 1: obsidian theme, landing page, workspace shell"`.

## Verification

```sh
# gates
npm run type-check
npm run lint
npm run test:unit
npm run validate
npm run build            # prerender + head stamp + CSS compile — the SSG proof

# Phase 1 grep gates (P1.12 + platform Product Polish / anti-AI)
grep -rn 'data-theme="slate"' index.html                 # 0
grep -rn "placeholder page\|Your app goes here" src/     # 0
grep "home pattern:" 'src/pages/(app)/home.tsx'          # the exact first line
grep 'data-theme="obsidian"' src/themes.css              # 1
grep -rn 818cf8 src/                                     # 0 (no indigo anywhere)
grep -rnE "#[0-9a-fA-F]{6}|rgba?\([0-9]" --include="*.tsx" src/pages/index.tsx 'src/components/landing/'  # 0
grep -rnE "(bg|text|border)-foreground/(\[|[0-9])" --include="*.tsx" src/pages/index.tsx src/components/landing/  # 0
grep -rnP "[\x{1F000}-\x{1FFFF}]" --include="*.tsx" src/  # 0
grep -rn "TODO[: ]" --include="*.tsx" src/pages/index.tsx src/components/landing/  # 0

# browser suites (dev server + Chromium are warm from P0)
npx deepspace test run smoke     # 6 tests, zero console errors on /
npx deepspace test run api
npx deepspace test run tests/collab.spec.ts   # 3/3, account menu intact
```

Manual, signed out and signed in:

1. `/` — one screen, gothic pixel hero, headline ≥3× body, CTA **Enter the
   table**; no indigo anywhere; the d20 draws itself once and stops.
2. `Enter the table` → `/home` — scene banner (Ashen Threshold, exploration,
   DC 12), roster of 2, feed with a success and a crit-failure row, GM stream,
   sheet with 6 stats + segmented HP, 3 inventory items, sign-in banner.
3. Scroll inside each column only; the page itself does not grow a scrollbar.
4. Sign in → same table, no sign-in banner; account menu still shows the email
   and sign-out works; `nav-user-name` appears only in the nav.
5. Reduce motion in the OS → the d20 shows its final frame, nothing animates.

Gates that must be green this phase: the four `P1.12` greps, the platform
Product Polish half-absence/half-presence pair, and the landing anti-AI set.

## Risks

| Risk | Trigger | Mitigation |
| --- | --- | --- |
| `npm i @fontsource/silkscreen` unavailable (offline / registry) | install fails | Fall back to a hand-downloaded `public/fonts/silkscreen-400.woff2` + `@font-face`; if neither works, numerals stay `font-mono` and the deviation is recorded in § Outcome (no ADR: the register is ADR 0013's, delivery is implementation) |
| Prerender breaks | head restructured, `window` at render, nondeterministic hero, missing root placeholder | `npm run build` after every step that touches `index.tsx` or `index.html`; the SSR pass has no browser, so any API use throws |
| A smoke test fails on a console error from `/` | font 404, hydration mismatch, SVG animation warning | Deterministic hero, self-hosted font (no 404), no JS-driven initial states; run `smoke` at Steps 2 and 3, not only at the end |
| One of the 21 tokens missing → indigo leak | copying `paper` and skipping `--color-ring`/`--color-shell*` | `grep -rn 818cf8 src/` must be 0; the plan's token table is the checklist |
| Second scrollbar / clipped columns | `h-full` inside `<main class="flex-1 overflow-y-auto">` without `min-h-0` | `min-h-0` on the shell and on every scroll column; manual step 3 |
| Roster/sheet scope creeps into Phase 3/4 | adding `useQuery`, Forge, presence, or Use/Discard here | § Contracts + the Step 4 grep proving no hook imports; those tasks keep their ids |
| Fixture drifts from the P2.3 seed | Phase 2 seeds different copy/DC | `PREVIEW_CAMPAIGN` is pinned in § Contracts as the seed; `P2.3` copies it |
| `--radius: 0` breaks a kit primitive's shape assumptions | `Avatar`/`Badge`/`Button` use `rounded-lg`/`rounded-full` | `rounded-full` is not token-driven and stays a circle; verify buttons/badges visually in manual step 2 |
| Nav regression (test ids / `signOut`) | rewriting `Navigation` while theming | `Navigation.tsx` is **not** edited this phase; `collab` run at Step 5 and Step 7 |
| Silkscreen at 14px hurts readability | using it for prose | ADR 0013 rule: prose sans, Silkscreen for labels/badges/numerals; review each panel |

## Open questions

- [x] Where does the Design Direction block go, and in what exact shape? →
      top of `src/pages/index.tsx`, platform template (verified from
      `docs.deep.space/design/overview.md`): six prompts + six-token Style Tile.
- [x] Silkscreen delivery: CDN `<link>`, `@import`, or `@fontsource`? → self-host
      via `@fontsource/silkscreen` (no runtime network, prerender-safe). No
      platform rule exists; ADR 0013 already chose the face, so this is delivery,
      not direction.
- [x] Keep `paper`/`slate` as "examples"? → no. The theme switcher is cut
      (ADR 0008); `@theme` re-bases to obsidian and both placeholder themes go.
- [x] Does the fixture show the enemy HP tracker? → no. ADR 0011 fixes the seed
      as the **threshold** state (DC 12, no enemy); the brazier fight is beat 5's
      GM move. `SceneBanner` implements the branch and renders it when
      `enemyMaxHp > 0`.
- [x] Is `APP_NAME` renamed? → no. `APP_DISPLAY_NAME = 'LoreSpace'` is added for
      titles/chrome; the slug and `SCOPE_ID` derivation stay put.
- [x] New `P1.*` tasks needed? → none. `P1.1`–`P1.14` cover every step; the
      fixture is `P1.9`'s, the panel split is `P1.10`'s, the font is inside
      `P1.1`'s "Silkscreen for labels/numerals".

## Outcome

Filled in at the end of the phase, never rewritten afterwards.

- **Shipped:**
  - **Theme** — `[data-theme="obsidian"]` with all 21 tokens, `--radius: 0` and
    the five derived radii zeroed, hard pixel shadows; `@theme` re-based off
    slate so no `#818cf8` survives anywhere (`grep -rn 818cf8 src/` → 0);
    `THEMES` reduced to the single `obsidian` entry with both `getActiveTheme()`
    fallbacks and `getTheme()` fixed; `index.html` first paint `#09090b` with an
    `html[data-theme="obsidian"]` line; `seo.ts` title/description;
    `APP_DISPLAY_NAME`.
  - **Silkscreen** — `@fontsource/silkscreen` (`latin-400.css`), self-hosted,
    imported in `src/main.tsx`; `--font-pixel` + `.pixel-numeral`; labels,
    badges and numerals only, prose stays sans.
  - **Chrome utilities** — `.pixel-frame`, `.pixel-dither`, `.pixel-rule`,
    `.pixel-numeral`, `.hp-segment`, `.pixel-strip`, plus `d20-trace`,
    `roll-tick`, `hp-fill` keyframes that only run under
    `@media (prefers-reduced-motion: no-preference)` (reduced motion gets the
    final frame, never a blank path).
  - **Landing** — `src/pages/index.tsx` (182 lines): the platform's exact Design
    Direction block, split hero, one hand-authored inline-SVG icosahedron that
    draws itself once, check panel with `14 + 3 = 17` and a segmented HP row,
    CTA **Enter the table** → `/home`. Deterministic: no `Math.random`,
    `Date.now`, `window`; CSS keyframes only. Prerenders with exactly one
    title/description/canonical and one `<h1>` (measured 60px vs 14px body;
    one screen at 1440×900 and 390×844, no horizontal scroll).
  - **Workspace shell** — `home.tsx` (105 lines) with the exact `home pattern:`
    line 1; `SceneBanner` (H1, location, atmosphere, DC, conditional enemy HP),
    `PartyRoster`, `ActionFeed`, `GmConsolePanel`, `CharacterSheetPanel`,
    `InventoryPanel`, `SignInBanner`. Three columns on `lg` with internal
    scroll (measured: `documentElement.scrollHeight === clientHeight`, center
    column `scrollHeight 554 / clientHeight 437`), stacked below `lg` in
    roster → feed/GM → sheet/inventory order.
  - **Data boundary** — `src/lib/preview-data.ts`: `RecordData<T>` fixture for
    all four collections, schema-exact (8/13/6/12 columns), threshold-state
    campaign, two characters, three items, four feed rows, three GM messages.
    `home.tsx` resolves the campaign from `useQuery<CampaignRow>('campaigns')`
    by `recordId === DEFAULT_CAMPAIGN_ID` and falls back to the fixture.
  - **Signed-out preview** — live rows when seeded, fixture when not; inline
    banner owns its `AuthOverlay`; `nav-user-name` never rendered in the shell
    (signed-out count 0).
  - **README** — front door with the pending-URL line, local run, verification,
    the two real screenshots in `docs/assets/`, and the status paragraph.
  - **Evidence** — `npm run validate` 3 files / 17 tests, `npm run lint` clean,
    `npm run build` prerenders `/`, `smoke` 6/6, `api` 2/2, `collab` 3/3, every
    `P1.12` gate and the platform anti-AI set at 0 hits, emoji 0 (Python scan),
    native dialogs 0.
- **Slipped:** nothing. `P1.1`–`P1.14` all ticked. One limitation worth naming:
  the fixture is ADR 0011's **threshold** state, so `SceneBanner`'s enemy-HP
  branch is implemented and type-checked but not exercised by the preview — it
  first renders when the GM puts an enemy on the table (Phase 5, beat 5).
- **Deviations:** no ADR needed — none changes a decision, a contract another
  phase depends on, or a route. Recorded here instead:
  1. **`@fontsource/silkscreen` is a new dependency** (self-hosted woff2, no
     runtime network). ADR 0013 chose the face; delivery was open, and the
     platform docs give no font guidance at all.
  2. **`paper` and `slate` are deleted** from `THEMES` and `themes.css`, and
     `@theme` holds the obsidian values. ADR 0008 cuts the theme switcher; a
     light block that half-overrides a dark baseline is a trap.
  3. **`APP_DISPLAY_NAME = 'LoreSpace'`** added; `APP_NAME` stays the slug.
     `(app)/_layout.tsx`'s `<title>` and the nav brand now use the display name
     (the nav brand was still lowercase `lorespace` in the first screenshot).
  4. **`Badge` base class `rounded-full` → `rounded-none`** so pills stop
     fighting `--radius: 0` (ADR 0013). `Avatar` stays circular on purpose.
  5. **Outcome badge mapping clarified:** success/critical-success green,
     failure amber, critical-failure crimson, info muted. The first pass used
     amber for both success and failure, which made the feed unreadable at a
     glance; the contract table now states the green/amber split.
  6. **Fixture corrections after review:** `RollLogRow` has 12 fields including
     `userId` (the plan's list said 12 but enumerated 11), and Vesper's DEX roll
     is `1 + 3 = 4` (DEX 17 is +3, not +4).
  7. **Test-id split:** `workspace-shell` is on the shell root and
     `preview-table` on the grid wrapper (one element cannot carry two
     `data-testid` attributes); the grid also got
     `lg:grid-rows-[minmax(0,1fr)]` — without it the implicit row is
     content-sized, columns clip instead of scroll.
  8. **`GmConsolePanel`'s input row is a native disabled `<input>`**, not the kit
     `Input`; Phase 5 replaces the whole row with `ChatPanel`.
- **Inherited by the next phase:**
  - **The seed contract:** `PREVIEW_CAMPAIGN` *is* the row `P2.3` must seed
    (`default-campaign`, `Chronicles of the Obsidian Vault`, `The Ashen
    Threshold`, exploration, DC 12, empty enemy fields). Seed that, and the
    signed-out preview and the signed-in table never disagree (ADR 0014).
  - **Component props are the data boundary** — `CharacterSheetPanel({character,
    inventory})`, `InventoryPanel({items})`, `PartyRoster({members})` with
    `RosterMember`, `ActionFeed({entries})` (newest first), `SceneBanner({campaign})`,
    `GmConsolePanel({messages})`. `P3.3`/`P3.6` swap `PREVIEW_*` for `useQuery`
    in `home.tsx` and keep the panels; `P4.1` wraps `PartyRoster` in
    `PartyPresenceBar`; `P5.7` replaces `GmConsolePanel`'s internals and keeps
    the props.
  - **Row types** live in `src/lib/preview-data.ts` (`CampaignRow`,
    `CharacterRow`, `InventoryRow`, `RollLogRow`) and mirror the schemas. If a
    schema column is renamed, this file is the type error that catches it.
  - **`inventory.characterId` holds a character `recordId`** (`'char-kaelen'`),
    not a display name — `P3.6`'s `where: { characterId }` must pass
    `record.recordId`.
  - **Fixture vs. empty-state:** signed-in with no character renders
    `CharacterSheetPanel`'s EmptyState ("No character at this table"). `P3.4`
    adds the Forge action to that state; do not invent a second empty state.
  - **Test ids for `P6.3`:** `workspace-shell`, `preview-table`, `scene-banner`,
    `party-roster`, `action-feed`, `gm-stream`, `character-sheet`,
    `inventory-panel`, `signed-out-banner`; `/home` has exactly one `<h1>` (the
    campaign title).
  - **Nav is untouched** apart from the brand string: `app-navigation`,
    `nav-sign-in-button`, `nav-user-name`, `nav-user-email`, `signOut()` all
    still work (`collab` 3/3 proves it).
  - **P2.5's skeleton** replaces only the fixture fallback for a signed-in user
    with an empty `campaigns` query; the signed-out path keeps the fixture
    forever (ADR 0014).
- **Next:** `/phase 2` — ready. Phase 2 (`P2.3`–`P2.5`) seeds
  `default-campaign`, adds `applyGmMutation`, and mounts the seeding trigger in
  the shell built here. Phase 3 stays sequenced behind it (its Deploy #1 wants
  the seed and actions live); nothing in Phase 3 is blocked by a task id.
