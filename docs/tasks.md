# LoreSpace — Task Board

Living document. Every agent that works on the app **must** update this file:
tick completed tasks, add newly discovered ones, and leave the phase board
honest. It is the only cross-session memory of what is done and what is next.

- Plan of record: [`high-level-plan.md`](./high-level-plan.md)
- Decisions and their rationale: [`adr/`](./adr/README.md). Read the relevant
  ADR before re-litigating a choice; a decision that changes direction becomes
  a new ADR, not a comment here.
- Per-phase implementation plans: [`plans/`](./plans/README.md) — each phase
  session writes `phase-N-plan.md` from its template before coding.
- Build budget: **96 hours** — ~10 focused hours/day for three days, day four as
  contingency ([ADR 0008](./adr/0008-playable-interview-build.md)). Plan every
  phase in hours; § Build budget is binding.
- One Pi session per phase. This file is the handoff between them.
- Opening a phase session: run `/phase <n>` (e.g. `/phase 2a`, `/phase 1`) —
  `.pi/prompts/phase.md` carries the orchestrator directive and the doc order.
- Checkboxes: `- [ ]` todo, `- [x]` done. Append `— <date> <who>` when you tick.
- Never delete a task. If it becomes wrong, tick it and add the replacement.
- New work goes under the phase it belongs to as `P<n>.<m>`; the next free
  number in that phase is `max + 1`.

**First action of any phase session:** draft `docs/plans/phase-N-plan.md` from
[`plans/template.md`](./plans/template.md). That file is the phase's working
document; this file stays the cross-phase index of what is done.

## Rules that apply to every phase

1. **Sequence: schemas first.** Data model and RBAC land before UI that reads
   them (see `P2a`). Never wire a `useQuery` to a collection that
   `src/schemas.ts` does not register.
2. **Verified against the installed SDK (0.44.2), not the plan's 0.43.0.**
   See [§ Verified SDK facts](#verified-sdk-facts-0442) and
   [ADR 0002](./adr/0002-installed-sdk-is-authority.md). Re-read the `.d.ts`
   before trusting any plan claim about an API.
3. **Import boundaries** (plan §Architectural Guardrails): `deepspace/schema`
   for schemas, `deepspace` for browser hooks, `deepspace/worker` for worker
   classes, `@/components/ui` for primitives. Never native `<select>`,
   `window.confirm|alert|prompt`.
4. **Writes** use awaited `*Confirmed` mutations + `<Button loading>` + a
   `useToast()` outcome. Gate auth on `useAuth().isSignedIn`, never on
   `user` truthiness.
5. **Verify before reporting done:** `npm run validate && npm run lint`, plus
   the phase's own gates (unit tests for pure logic, `npm test` for pages).
6. **Commit per phase** (or per coherent slice) with a `phase N:` prefix. The
   repo is the deliverable *and* the app's source: the **first** `deploy` claims
   GitHub (`surajt02/lorespace`) permanently, after which deploys ship the
   checkout including dirty bytes and record no commit lineage. Commit anyway —
   the interview reads the history.
7. **No emoji in UI chrome, no purple/indigo gradients, no placeholder copy.**
   Icons come from `lucide-react`.
8. **Any change of direction gets an ADR** in `docs/adr/` (copy
   `template.md`, next free number, link it here). Supersede, never rewrite.
9. **A phase that finishes leaves an Outcome section** in its
   `plans/phase-N-plan.md`: shipped, slipped, deviations, inherited assumptions,
   the **feature inventory** (shipped by feature / not real yet / persistence
   check / pending by phase / worth your eyes), and the **Next** line. The
   closing report ends by naming the next phase, its status (ready, or blocked on
   a named task), and the command to start it. Sections 1-5 of that report are
   pasted into the Outcome verbatim; fixtures and half-built things belong in
   "not real yet", never in "shipped".
10. **Approval is exception-gated.** Post the phase plan, then proceed. Wait for
    the user only when a *crucial* decision is open: it changes a contract
    another phase depends on, supersedes an accepted ADR, is hard to reverse
    (schema, route, deploy), is a product/taste call, or needs something only
    the user can supply. Settled by the plan, this file, or an ADR is not a
    decision.

## Current state

As of 2026-11-19 (after phase 5 + its campaign revision): a signed-in player
starts a **new game** from the banner (scene, HP, packs and the roll log reset
under one marker row), forges an adventurer, and plays a **five-scene arc** whose
scene the **streamed AI Game Master** opens, narrates and never jumps — the
engine decides when a scene is over. Rolls are server-computed; combat is
narration → GM-set DC → check → engine-clamped consequence, with every change
leaving a `combat` or `gm_event` row. Presence is membership-gated and carries a
typing flag. The console defaults to Claude Haiku 5.5 (Opus is plan-blocked).
The GM console now renders the **shared table thread** (`gm-messages`, readable
signed out) rather than a private per-player chat, the scene banner carries the
pending check's DC (pulsing) in place of a scene-global one, and stat cards are
inert until the GM requests a specific roll. Phase 6 is done: the mechanical
gates are clean, `tests/**` is type-checked, the e2e suite proves the two-window
character/roster/requested-roll contract deterministically, release #10 is live,
and the README carries the live URL, three screenshots and the sync story.

| Thing | State |
| --- | --- |
| Theme | `obsidian` — 21 tokens, `--radius: 0`, amber `#d97706`, Silkscreen labels; no indigo anywhere |
| `src/pages/index.tsx` | Split-hero landing, Design Direction block, inline-SVG d20 (`D20Mark`, shared with the roll banner), CTA `Enter the table` |
| `src/pages/(app)/home.tsx` | 3-column shell; campaign banner, sheet, pack, **roster**, **feed** and the shared **GM thread** read live rows (seed skeleton + read-failure notices). Signed out, one `previewFromLiveRows` flag switches sheet/pack/roster/feed to live rows as soon as any character exists; `src/lib/preview-data.ts` is the designed empty-table fallback ([ADR 0014](./adr/0014-public-read-table.md)) |
| Presence | `src/components/PartyPresenceBar.tsx` — one `usePresenceRoom(DEFAULT_CAMPAIGN_PRESENCE_SCOPE)` socket, broadcasts identity only (`characterId`, `characterName`, `archetype`), roster join in `src/lib/party-presence.ts` |
| `src/server/realtime-routes.ts` | `/ws/presence/:scopeId` is **gated** (401 anonymous/bad token, 503 unverifiable, 403 non-member) with `campaign:preview` the one anonymous scope; hand-written instead of `wsRoute(extraIdentity)` |
| `src/pages/(app)/(protected)/settings.tsx` | Account card + a **Characters** card: the caller's character with `Delete <name>` → confirm → `deleteCharacter` (items first); `/home` then shows Forge |
| `src/schemas.ts` | `users` + `settings` + `campaigns` + `characters` + `inventory` + `roll-logs` + `gm-messages` + `ai-chats` + `ai-messages` (nine, `lintSchema`/`lintSchemas` clean; the two AI collections are SDK-owned and turn `/api/ai/chat` on) |
| `src/actions/index.ts` | Seven actions: `ensureDefaultCampaign`, `applyGmMutation`, `forgeCharacter`, `useItem`, `deleteCharacter`, **`rollSkillCheck`**, `startCampaign`; all over `POST /api/actions/:name` (bearer). No player HP action (ADR 0020) |
| `src/lib/campaign-seed.ts` | `DEFAULT_CAMPAIGN_SEED` — the seed row and `PREVIEW_CAMPAIGN.data` are the same object |
| `src/lib/d20.ts` | `getModifier`, `formatModifier`, `calculateArmorClass`, `classifyRoll`, `ARCHETYPE_PRESETS`, `ARCHETYPE_ORDER`, `ABILITY_SCORES`, `CONSUMABLE_EFFECTS`; zero imports, no randomness. Entropy lives in `src/lib/rng.ts` (rejection-sampled d20 from bytes) |
| `src/components/CharacterSheetPanel.tsx` | Live `characters` record → Forge (`forgeCharacter`), 6 stat cards that **roll** (click → `rollSkillCheck` → toast + banner), AC, segmented HP bar (read-only — no HP controls, ADR 0020); preview cards stay inert |
| `src/components/InventoryPanel.tsx` | Live `inventory` rows → Use (`useItem` action, heals) / Discard (owner-scoped `removeConfirmed` behind `ConfirmModal`), no add/edit |
| `src/components/vtt/ActionFeed.tsx` | Live `roll-logs` rows (every row read), 5 shown with an `All N` toggle, scrolls inside its frame; minimised it shares the column with the GM console, which takes the rest; skeleton/read-error/empty states |
| `src/components/vtt/RollBanner.tsx` | One fixed strip, d20 sprite, `d20(n) ± m = t vs DC n`, outcome badge, 6 s auto-dismiss; fed by `RollBannerLayer` from the newest `roll-logs` row, so signed-in and signed-out windows see the same roll (ADR 0021) |
| `src/ai/tools.ts` | Seven record tools (no `records.delete`) + six GM tools (`get_campaign_snapshot`, `modify_character_hp`, `grant_character_loot`, `update_campaign_scene`, `damage_enemy`, `request_check`) and the GM brief; writes run as the owner through `applyGmMutation` and refuse outside `/api/gm/chat` (ADR 0022) |
| `ai-chat` feature | Installed: `ChatPanel` (+messages/stream), `ai-chat-schema.ts`, `pages/(app)/(protected)/assistant.tsx` (unlinked, unstyled, `P5.8`); `/api/ai/chat*` registered because `AI_CHATS_SCHEMA` is in `schemas`; billed to `APP_OWNER_JWT` |
| GM console | `src/components/GmConsolePanel.tsx` — signed in it is `ChatPanel` + four chips + one auto turn per resolved roll; signed out it is `PREVIEW_GM_MESSAGES` in the same frame |
| GM tools' evidence | `applyGmMutation` writes one `roll-logs` row per mutation (`combat` / `gm_event`), so the feed shows the GM's writes |
| `src/constants.ts` | `DEFAULT_CAMPAIGN_ID`, `DEFAULT_CAMPAIGN_PRESENCE_SCOPE` (2a), `PREVIEW_PRESENCE_SCOPE` (4) |
| Tests | `test:unit` = 20 files / 356 tests; e2e 14/14 and serial (`workers: 1`): `smoke` 7, `api` 2, `presence` 3, `collab` 2. `tests/**` is inside `tsconfig`; the check gate is driven by an owner token minted from the CLI session; 2 `lorespace-*@deepspace.test` accounts |
| Git | scaffold + phases 0-6 committed; `src/router.ts`, `modals.tsx` are gitignored (regenerated) |
| Deploy | release **#10** live at <https://lorespace.app.space> (2026-11-21); **GitHub source claimed permanently** by `P3.8` — deploys ship the checkout, no commit lineage; the live page serves `assets/index-bq2SgAXw.js`, the same build as `dist/` |
| Read policy | `viewer` (anonymous) reads the nine collections' public rows by design ([ADR 0014](./adr/0014-public-read-table.md)); `/home` renders live rows when they exist and `src/lib/preview-data.ts` when the table has no characters |
| Write policy | members **cannot write `characters`, `inventory` or `roll-logs`** directly: Forge/Use/delete/roll are server actions (ADR 0015/0020/0005), Discard is an owner-scoped delete, and `applyGmMutation` (owner credential, no caller until `P5.3`) is the only HP writer. `/home` seeds `campaigns/default-campaign` |
| README | front door: live URL, three live screenshots, three-sentence what, the sync story (RecordRoom, presence gate, GM write path), ADR 0005/0009/0014 links, nine collections, current verify commands |

## Architecture map

Where things live, so a new session can orient without re-scouting.

```
worker.ts                     Hono assembly; DO manifest; registration order matters
src/server/http-routes.ts     /api/auth/*, debug, integration, platform proxy, SPA shell
src/server/realtime-routes.ts /ws/:roomId | /ws/presence/:scopeId | /ws/yjs | /ws/canvas
src/server/action-routes.ts   POST /api/actions/:name (bearer required)
src/actions/index.ts          privileged server actions (RBAC off inside)
src/schemas.ts                registered collections — single source for both sides
src/schemas/*.ts              one file per collection
src/ai/tools.ts               buildTools + buildSystemPrompt (HTTP, MCP, browser tools)
src/ai/agent.ts               registerAgent → in-app chat routes + agent/MCP routes
src/ai/chat-routes.ts         /api/ai/chat streaming, summarizer, billing
src/pages/_app.tsx            ToastProvider → TooltipProvider → app-root (no network)
src/pages/index.tsx           static, prerendered tier
src/pages/(app)/_layout.tsx   auth → RecordProvider(allowAnonymous) → RecordScope → nav
src/pages/(app)/home.tsx      VTT workspace (tier 2: signed-out preview lives here)
src/pages/(app)/(protected)/  AuthGate tier — settings, api-status
src/components/ui/            20 Base UI primitives incl. ConfirmModal, useToast
src/themes.css  styles.css    [data-theme] overrides / @theme defaults
tests/*.spec.ts               smoke, api, collab (deepspace/testing)
```

## Phase board

| Phase | Scope | Hours | Status |
| --- | --- | --- | --- |
| 0 | Session prerequisites: two test accounts + warmed browser | — | **done 2026-11-18** — 2 accounts, `collab` 3/3, cache warm; no plan file |
| 2a | Data model prelude: 4 schemas + registration + default campaign | — | **done 2026-11-18** — 6 registered, lint clean, 17 unit tests |
| 1 | Pixel theme, landing page, 3-column workspace shell | 10 | **done 2026-11-18** — obsidian 21 tokens + chrome utilities, split-hero landing, 3-col shell signed in/out |
| 2 | `ensureDefaultCampaign`, `applyGmMutation` | 4 | **done 2026-11-18** — seed action + GM write path, 32 unit tests, seeded once in a live browser run |
| 3 | d20 math, character sheet, inventory (read + use) | 7 | **done 2026-11-18** — d20, server-authored Forge/Use/delete, no player HP path, owner-scoped inventory, Marksman; live |
| 4 | Presence roster, server-computed roll, roll banner | 5 | **done 2026-11-19** — gated presence, `rollSkillCheck`, two-window banner + live feed, 134 unit + presence 2/2, deployed |
| 5 | AI GM: install ai-chat, GM tools, owner billing, console | 6 | **done 2026-11-19** — `ai-chat` live, five GM tools, owner billing, chrome console + chips + auto-resolve, typing presence; campaign revision: five-scene arc, new-game reset, engine-gated advance, narrative combat; live turn + loot + enemy damage proven, 240 unit tests |
| 6 | Gates, unit + smoke + one sync spec, deploy, README | 7 | **done 2026-11-21** — gates clean, 356 unit / 14 e2e (serial, deterministic owner-gated check), release #10 live, live smoke with a real `combat` write, README + 3 screenshots, three timed rehearsals |
| | **Planned total** | **39** | of ~40 available (30 planned + day-4 contingency) |

## Build budget (96 hours)

96 hours wall-clock, for an interview, delivered as a GitHub link. The README of
that repo is the front door (live URL, screenshots, architecture, notable ADRs).
~10 focused hours/day for three days, day four held as contingency
([ADR 0008](./adr/0008-playable-interview-build.md)). If the window becomes 96
**working** hours, restore inventory CRUD and the creation modal first.

The spec is ADR 0008's eight-beat demo script; anything that does not serve a
beat is a cut.

### Day 1 — identity and shell (10h) · Phase 1

| h | Work |
| --- | --- |
| 1.5 | `obsidian` tokens (21: 19 colors + `--color-shell*`), pixel chrome utilities, Silkscreen, first-paint, `THEMES`, delete `slate` |
| 1.5 | Landing: Design Direction block, split hero with the SVG d20, CTA — one screen |
| 5 | Workspace shell: three columns, scene banner, roster, feed, sheet, GM panel (static data) |
| 1.5 | Signed-out preview + `AuthOverlay` state + prop-driven data boundary |
| 0.5 | README front door skeleton |

**Risk:** the shell is the largest single chunk and everything plugs into it. An
overrun eats day 2's buffer, not day 3's.

### Day 2 — data and character (10h) · Phases 2 + 3

| h | Work |
| --- | --- |
| 1.5 | `ensureDefaultCampaign` + `applyGmMutation` (HP, loot, scene only) |
| 1.5 | `src/lib/d20.ts` + unit tests |
| 4 | Live character sheet: Forge from presets, six stats + modifiers, AC, HP controls |
| 1.5 | Inventory: read + Use/Discard only |
| 1.5 | **Deploy #1** — latches GitHub, proves the shell serves |

### Day 3 — sync and the GM (10h) · Phase 4, start Phase 5

| h | Work |
| --- | --- |
| 1.5 | `rollSkillCheck` action with ownership check (ADR 0005) |
| 1 | Presence membership gate (ADR 0006) |
| 2.5 | `PartyPresenceBar`, `DiceRoller`, roll banner (signature), feed rows |
| 1 | **Deploy #2 + two-window sync proof** — the wedge, demonstrated |
| 2.5 | `ai-chat` install, owner billing, four GM tools, GM prompt |
| 1.5 | `GmConsolePanel`, quick chips, auto-resolve on roll |

**Milestone:** if two windows do not sync the roll by end of day 3, the
interview rests on the AI instead of the architecture — and the AI is the part
every competitor has.

### Day 4 — rehearsal and gates (10h) · finish 5, Phase 6

| h | Work |
| --- | --- |
| 2 | Golden-path rehearsal ×3 against the eight beats, fix breaks |
| 1 | Streaming/latency: two-phase indicator, first token inside ~3s |
| 1.5 | `collab` sync spec + smoke additions |
| 1 | Grep/emoji gates, visual polish |
| 1 | Final deploy + live smoke on both accounts |
| 1 | README final: live URL, screenshots, architecture, ADRs |
| 2.5 | Spare |

### Cut (binding)

Multiple campaigns and any campaign browser · custom creation, stat allocation,
archetype editing · inventory add/edit CRUD · messaging schemas · `assistant`
page and chat-history UI · theme switcher and `data-ui-theme` · maps/canvas,
conditions, initiative, XP, spells · SEO/sitemap depth · `applyGmMutation` beyond
HP/loot/scene · test breadth beyond unit + smoke + one sync spec · any
pre-recorded demo.

---

## Phase 0 — Session prerequisites

Three short tasks, once per machine. No plan file: nothing here is design, and
`docs/plans/` would be ceremony. Do it before Phase 2a.

Why it is hoisted: `tests/collab.spec.ts:32-41` skips its **entire** file while
fewer than two usable accounts exist — including the two `/api-status` tests,
which have nothing to do with a pool. So today the multi-user surface is
silently untested, and Phase 4 (a server action plus a gated realtime route,
neither reachable from the browser smoke test) would have no way to verify
itself until Phase 6. `loadAllTestAccounts()` reads the local registry, so an
account only counts on the machine that created it — another reason to do this
early and once.

- [x] `P0.1` Create two accounts. Email must end with `@deepspace.test`; a
      password must be at least 8 characters and is better piped than passed on
      argv, where it lands in `ps` and shell history.
      **Deviation (2026-11-18, phase 0 session):** `alice@`/`bob@deepspace.test`
      are already held by *other developers* — the domain is global, not
      per-developer, and `recover --all` found no pool account of ours. Created
      `lorespace-alice@deepspace.test` (selector `Alice`) and
      `lorespace-bob@deepspace.test` (selector `Bob`) instead. Names are
      unchanged, so `users(['Alice', 'Bob'])` still works; **specs must select
      accounts by name, never by email**.
      ```sh
      openssl rand -base64 18 | npx deepspace test accounts create \
        --email lorespace-alice@deepspace.test --name Alice --label lorespace --password-stdin
      openssl rand -base64 18 | npx deepspace test accounts create \
        --email lorespace-bob@deepspace.test --name Bob --label lorespace --password-stdin
      npx deepspace test accounts list   # expect 2 rows
      ```
      Credentials land in `~/.deepspace/test-accounts.json`, outside the repo —
      never commit them. Recovery on another machine is
      `npx deepspace test accounts recover --all`, and never invent a password
      to match a spec.
- [x] `P0.2` Prove the gate opened and warm the browser cache (the first run
      downloads Chromium and boots vite + workerd, so allow minutes):
      ```sh
      npx deepspace test run tests/collab.spec.ts
      ```
      Expect **3 passing**: the identity test plus both `/api-status` tests. They
      intercept `**/api/integrations`, so they need no real integration. If the
      identity test fails, the fixture or sign-in is broken — fix it here, not in
      Phase 6.
- [x] `P0.3` Note the outcome on the phase board: 2 accounts, `collab` green,
      and the `~/.deepspace/playwright-states/` cache warm. Phase 4 and `P6.2`
      both depend on this line being true.
      **Done 2026-11-18, phase 0 session:** `test accounts list` shows 2/10;
      `npx deepspace test run tests/collab.spec.ts` → **3 passed (12.6s)**, none
      skipped; Chromium 1255 + headless shell cached in
      `~/Library/Caches/ms-playwright`, sign-in states in
      `~/.deepspace/playwright-states/` (2 files).

## Phase 2a — Data model prelude (schemas only)

Sequencing decision: schemas land before the UI that reads them, so the
workspace is built data-driven once instead of rewritten
([ADR 0001](./adr/0001-schemas-before-ui.md)). This is the schema half of
Phase 2; RBAC hardening and the GM actions stay in Phase 2.

- [x] `P2a.1` `src/schemas/campaigns-schema.ts` — 8 columns per plan; `'*'`/`viewer`
      read-only, `member` create+update, `admin` all. — 2026-11-18 phase 2a
- [x] `P2a.2` `src/schemas/characters-schema.ts` — 6 attributes + hp/maxHp/ac;
      `ownerField: 'userId'`, `userBound: true` on `userId`,
      `uniqueOn: ['userId', 'campaignId']`, `member` create + `'own'` update/delete.
      — 2026-11-18 phase 2a
- [x] `P2a.3` `src/schemas/inventory-schema.ts` — `characterId` as
      `reference{targetTable:'characters',displayColumn:'name'}` (metadata only,
      no FK — join client-side). — 2026-11-18 phase 2a
- [x] `P2a.4` `src/schemas/roll-logs-schema.ts` — roll columns + `ownerField:'userId'`.
      **Deviation:** use `rolledAt` with `timestampTrigger: { field: 'summary' }`
      instead of `createdAt` ([ADR 0003](./adr/0003-roll-log-timestamp-column.md)) —
      the SDK resolves `orderBy: 'createdAt'` to the system `_created_at`, so a
      custom column named `createdAt` is unsortable and redundant.
      — 2026-11-18 phase 2a
- [x] `P2a.5` Register the four domain schemas in `src/schemas.ts`. **Do not**
      register the messaging drop-ins (`CHANNELS_SCHEMA`, `MESSAGES_SCHEMA`,
      `REACTIONS_SCHEMA`, `CHANNEL_MEMBERS_SCHEMA`, `READ_RECEIPTS_SCHEMA`):
      nothing reads them and they would widen RBAC plus AI/MCP reach for no
      product benefit (`D2`, resolved). Deferring is free — 0.44.2 creates
      tables on DO init, so adding them later is a one-line registry change.
      — 2026-11-18 phase 2a: registered six, asserted by name in the unit test
- [x] `P2a.6` `lintSchema` clean for every schema (unit test in `P2a.7`).
      — 2026-11-18 phase 2a: `[]` per schema and `lintSchemas(schemas)` `[]`
- [x] `P2a.7` `src/schemas/__tests__/schemas.test.ts` asserting
      `lintSchema(schema)` is `[]` for each. Runs under Vitest (node env).
      — 2026-11-18 phase 2a: also pins registration, both constants, and the
      load-bearing columns/`uniqueOn` that later phases write by name; the
      permission matrices stay with the `P2.1` audit
- [x] `P2a.8` `default-campaign` record id becomes a shared constant in
      `src/constants.ts` — Phase 4 hardcodes the presence scope
      `campaign:default-campaign` and must agree with the action.
      — 2026-11-18 phase 2a: `DEFAULT_CAMPAIGN_ID` plus derived
      `DEFAULT_CAMPAIGN_PRESENCE_SCOPE`, so the room and the record cannot drift

## Phase 1 — Theme, landing page, workspace shell

- [x] `P1.1` `[data-theme="obsidian"]` in `src/themes.css` overriding **all 21**
      tokens — 19 colors plus `--color-shell` and `--color-shell-panel`
      (`styles.css:19-96` is the slate default; a missed token leaks indigo
      `#818cf8`, which the anti-AI gate forbids). Palette: `#09090b` bg, `#121216`
      card, `#27272a` border, `#f4f4f5` fg, `#d97706` primary, `#dc2626`
      destructive. **`--radius: 0`** and the pixel register per
      [ADR 0013](./adr/0013-visual-register.md): stepped borders, dithered
      gradients, Silkscreen for labels/numerals, sans for prose. — 2026-11-18 phase 1
- [x] `P1.2` `'obsidian'` in `THEMES` (`src/themes.ts`); fix `getActiveTheme()`
      fallback (hardcodes `'slate'` at lines 36-38) and `getTheme()` first-entry
      fallback. — 2026-11-18 phase 1
- [x] `P1.3` `index.html`: `lang="en" data-theme="obsidian"`, remove
      `data-theme="slate"` (grep gate), `<title>LoreSpace — Multiplayer AI
      Tabletop RPG</title>`, and an `html[data-theme="obsidian"]` first-paint
      line matching `#09090b` (today `#0a0a0a`). — 2026-11-18 phase 1
- [x] `P1.4` `src/seo.ts` title/description for LoreSpace (single source for the
      prerendered head). — 2026-11-18 phase 1
- [x] `P1.5` Design Direction comment block at the top of `src/pages/index.tsx`
      (6-prompt brief + 6-token Style Tile). — 2026-11-18 phase 1
- [x] `P1.6` Split-hero landing: verb-first copy left, live-rendered animated
      d20 skill-check + character-sheet mockup right — **one hand-authored inline
      SVG** plus styled divs, zero raster files, **deterministic** (no
      `Math.random`/`Date.now`/`window`; CSS keyframes only). CTA → `/home`. Keep
      `data-testid="static-landing"` and `<Seo>` first. — 2026-11-18 phase 1
- [x] `P1.7` Line 1 of `src/pages/(app)/home.tsx` is exactly:
      `/* home pattern: product-preview-first — live multiplayer VTT campaign table, dice log, and character sheet */`
      (grep gate). — 2026-11-18 phase 1
- [x] `P1.8` 3-column workspace shell in `home.tsx`: scene banner (location,
      atmosphere, active DC, enemy HP) + party roster; center = action/dice feed
      + AI GM stream; right = character sheet + inventory. Use `bg-shell` /
      `bg-shell-panel`. `h-full` + internal scroll (layout is
      `h-screen overflow-hidden`). — 2026-11-18 phase 1
- [x] `P1.9` Signed-out branch: same 3 columns, rendered from **live campaign
      rows when the seed exists** and from a bundled fixture when `campaigns` is
      empty ([ADR 0014](./adr/0014-public-read-table.md)) — nobody has signed in
      yet, so `ensureDefaultCampaign` has not run. The fixture must match the
      schema, never invent fields. Inline sign-in banner owns its own
      `<AuthOverlay>` state (home is tier 2, so there is no `AuthGate`). Gate on
      `useAuth().isSignedIn`, not `useAuthProfileReady({requireUser:true})`
      (today's `home.tsx:13`). Party members must **not** use
      `data-testid="nav-user-name"` (`smoke.spec.ts:60-64` asserts count 0 signed
      out). — 2026-11-18 phase 1
- [x] `P1.10` Data boundary: components take their data as props so Phase 3/4
      swap sample data for `useQuery` without rewriting markup. — 2026-11-18 phase 1
- [x] `P1.11` Keep nav test IDs intact (`app-navigation`, `nav-sign-in-button`,
      `nav-user-name`, `nav-user-email`) and `signOut()` reachable
      (`collab.spec.ts` depends on the account menu). — 2026-11-18 phase 1
- [x] `P1.12` Grep gates that this phase must turn green: no
      `data-theme="slate"` in `index.html`; no `placeholder page` in `src/`;
      `home pattern:` present; `data-theme="obsidian"` present in `themes.css`. — 2026-11-18 phase 1
- [x] `P1.13` Pixel chrome as **shared utilities** in `src/styles.css`
      ([ADR 0013](./adr/0013-visual-register.md)): stepped 2px border,
      dithered gradient, ornamental divider, segmented HP bar, pixel-numeral
      class. Components consume these; no per-component pixel art. — 2026-11-18 phase 1
- [x] `P1.14` README front door skeleton: what the app is, one screenshot, the
      live-URL placeholder, how to run it locally. Final copy on day 4. The repo
      is the deliverable, so this is not optional garnish. — 2026-11-18 phase 1

## Phase 2 — RBAC hardening, server actions

- [x] `P2.1` ~~Audit every schema's role matrix~~ **Resolved:** `viewer` (the
      anonymous role) keeps `read: true` on all four collections by design — the
      table is shareable by link, and the signed-out preview reads live rows
      ([ADR 0014](./adr/0014-public-read-table.md)). Writes stay member/admin. —
      2026-11-18 grill
- [x] `P2.2` ~~`inventory` `member: delete: true` asymmetry~~ **Resolved:
      accepted risk.** Any member can delete any inventory row because the
      collection has no `userId` column. Acceptable for a two-character demo
      dataset ([ADR 0014](./adr/0014-public-read-table.md)); a real product adds
      `userId` and scopes delete to `'own'`. — 2026-11-18 grill
      **Closed 2026-11-18 by `P3.13`:** inventory now has `userId`, and member
      update/delete are `'own'`.
- [x] `P2.3` `src/actions/index.ts` — `ensureDefaultCampaign`: `tools.query`
      then `tools.create(..., 'default-campaign')`. Known-id create is an
      **upsert**, so it is idempotent. Seed scene + enemy + DC per plan.
      — 2026-11-18 phase 2. **Deviation:** the seed values are the
      **threshold** state (`DEFAULT_CAMPAIGN_SEED` in `src/lib/campaign-seed.ts`
      — The Ashen Threshold, exploration, DC 12, no enemy), not the old plan
      prose's Sunken Reliquary/dungeon/DC 13, which matches none of
      [ADR 0011](./adr/0011-content-arc.md)'s three states. The fixture and the
      seed are now the same object, so they cannot drift. The existence check
      filters on `recordId`, not "any row".
- [x] `P2.4` `applyGmMutation` — privileged multi-collection HP/loot writes,
      **HP, loot and scene only** (no encounter model, no conditions).
      Remember `ctx.tools` runs with per-record RBAC **off**: check ownership
      yourself. There are **no transactions** — ordered best-effort only, and
      say so in the code comment instead of claiming atomicity.
      — 2026-11-18 phase 2. Authority is table membership (caller owns a
      character in the campaign), checked before any target read; the target
      must share the campaign. No caller until `P5.3`. `details.applied` is part
      of the wire shape but is always `[]` today, because every mutation kind
      performs exactly one write.
      **Superseded 2026-11-18 by `P3.10`/ADR 0017:** authority is the app-owner
      credential (`not_gm` otherwise), because table membership let any player
      set their own HP through this action. The membership query is gone; the
      target campaign check stays; loot is stamped with the target character's
      `userId`.
- [x] `P2.5` Wire `ensureDefaultCampaign` per
      [ADR 0007](./adr/0007-default-campaign-trigger.md): from the app tier on
      `/home` when `isSignedIn` && the `campaigns` query is empty && a `useRef`
      guard is unset. Render a skeleton while it runs, not a "no campaign"
      empty state; on failure toast and retry on the next mount.
      — 2026-11-18 phase 2, via `callAction` in `src/lib/actions.ts` (the app's
      first action caller). The gate is the seeded row's absence, not an empty
      collection, so a stray campaign row cannot leave the table unseeded; a
      `seed-failed` notice covers both a failed seed and a failed read, and
      after success the seed values render until the room subscription lands.
- [x] `P2.6` `src/actions/__tests__/actions.test.ts` — Vitest (node) with a fake
      `ActionTools`: seed is idempotent and its values equal the preview
      fixture; `applyGmMutation` refuses a caller with no character in the
      campaign, clamps HP to `0..maxHp`, pins `campaignId` on loot, applies only
      whitelisted scene columns, and reports a partial apply when a later write
      fails. The actions are privileged (RBAC off), so this test is the gate on
      the ownership check.
      — 2026-11-18 phase 2: 15 tests, suite 4 files / 32 tests, including the
      foreign-row seed case. **Deviation:** the promised "later write fails"
      partial-apply case cannot exist while each mutation kind writes one
      record; the test asserts `applied: []` on the single-write failure
      instead, and the field stays in the wire shape for a future multi-write
      kind.

## Phase 3 — Character sheet, d20 math, inventory

- [x] `P3.1` `src/lib/d20.ts` — `getModifier`, `formatModifier`,
      `calculateArmorClass`, `ARCHETYPE_PRESETS` (Vanguard/Shadowblade/
      Arcanist/Cleric), plus the roll classifier. Pure: no React, no DOM, no
      `Math.random` inside the classifier — worker code imports this module
      ([ADR 0005](./adr/0005-dice-roll-authority.md)), so keep it safe for both
      runtimes.
      **AC is per-archetype armor, not a flat bonus:** each preset carries
      `armorBonus` and `calculateArmorClass(dexScore, armorBonus)` is
      `10 + getModifier(dexScore) + armorBonus`. Values: Vanguard `5` (mail),
      Cleric `4` (scale), Arcanist `2` (warded robes), Shadowblade `1`
      (leathers) — chosen so the shipped fixture reproduces Kaelen `16`
      (DEX 12, +1, +5) and Vesper `14` (DEX 17, +3, +1), and so the tank is
      the hardest to hit rather than the easiest. **AC stays display-only:**
      nothing attacks it in this build (no enemy AC column, no attack roll —
      ADR 0010, ADR 0011), so do not invent an attack procedure here. A flat
      `bonus = 2` default is *not* the contract; the archetype supplies the
      number.
      — 2026-11-18 phase 3: exports `getModifier`, `formatModifier`,
      `calculateArmorClass`, `classifyRoll(rawRoll, total, targetDc)`,
      `ARCHETYPE_PRESETS`, `ARCHETYPE_ORDER`, `ABILITY_SCORES` + types.
      Zero imports, no randomness (grep gate). `classifyRoll` pins nat 20/nat 1
      as overrides of the total and returns the exact `roll-logs.outcome`
      select values, so `P4.4` writes them directly.
- [x] `P3.2` Unit tests for `src/lib/d20.ts` (Vitest node env; boundary cases
      at 1/10/11/20, AC clamping). Pin the AC contract too: every
      `ARCHETYPE_PRESETS` entry has an `armorBonus`, and the two fixture
      builds compute `16` (Vanguard, DEX 12) and `14` (Shadowblade, DEX 17).
      — 2026-11-18 phase 3: 20 tests in `src/lib/__tests__/d20.test.ts`
      (suite 5 files / 52 tests). **Deviation:** "AC clamping" is a no-clamp
      pin — `calculateArmorClass(1, 0) === 5`; the formula floors the DEX
      modifier but does not clamp the result (a 5e-shaped score of 9 is `-1`,
      not `0`). Also deep-equals every Vanguard/Shadowblade score, maxHp and AC
      against `PREVIEW_CHARACTERS`, and the Vanguard starter pair against the
      fixture items, so a preset edit cannot split the two tables.
- [x] `P3.3` `src/components/CharacterSheetPanel.tsx` — `useQuery('characters',
      { where: { campaignId } })`, match `record.data.userId === userId`,
      `animate-pulse` skeleton while `status === 'loading'`.
      — 2026-11-18 phase 3: **deviation — the query lives in `/home`,** which
      resolves `characters` (and `inventory`) once and hands the record to both
      panels. The `where` clause, the `userId` match and the skeleton are as
      written; the join sits with the other reads so the sheet and the pack
      cannot disagree about which character is yours. Panel props are now
      `{campaignId, mode, status, character, items}` with records, not data.
- [x] `P3.4` **Forge adventurer**: one-click preset from `ARCHETYPE_PRESETS`
      plus a name field, `createConfirmed` + seed 2 starter inventory items,
      toast on success. Write `ac` from
      `calculateArmorClass(preset.dex, preset.armorBonus)` — the column is
      required and stays the stored source of truth; it is never recomputed
      later because DEX does not change after Forge. **No creation modal, no
      stat allocation** — cut by
      [ADR 0008](./adr/0008-playable-interview-build.md).
      — 2026-11-18 phase 3: name `Input` + four preset buttons (AC/HP hint +
      blurb) in the existing empty state; `createConfirmed` writes all 13
      columns with `ac = calculateArmorClass(preset.scores.dex,
      preset.armorBonus)` and `hp = maxHp`, then two `inventory`
      `createConfirmed` rows. **Deviation:** no transaction exists, so a failed
      item write is named in an `error` toast ("Ash exists, but X did not
      save") — the character row still lands. Buttons gate on
      `characters.ready && inventory.ready && userId != null`.
      **Revised by `P3.11`:** Forge is now the `forgeCharacter` action; the client
      no longer creates the row or its items.
- [x] `P3.5` 6 attribute cards (`font-mono tabular-nums`), click → skill check;
      HP bar (no `Progress` primitive — compose div + `bg-success|warning|
      destructive` + inline width) and −5/−1/+1/+5/Short Rest, clamped
      `0..maxHp` via `putConfirmed`.
      — 2026-11-18 phase 3: cards and HP controls shipped; `-5/-1/+1/+5/Short
      Rest` write clamped `hp` via `putConfirmed`. **Deviations:** (1) the
      **click → skill check half moved to `P4.8`** — the browser may not roll
      (ADR 0005) and `rollSkillCheck` is `P4.4`, so the cards render
      display-only with no pointer affordance; (2) numerals use
      `pixel-numeral` (Silkscreen, `tabular-nums`) rather than `font-mono`,
      because ADR 0013 gives every numeral in the shell the pixel register.
      **Revised by `P3.10`:** HP buttons call `adjustCharacterHp` with a named
      step; the browser no longer writes `hp`.
- [x] `P3.6` `src/components/InventoryPanel.tsx` — list items, **Use/Discard
      only** (no add/edit form, cut by ADR 0008); discard via `ConfirmModal`
      naming the item.
      — 2026-11-18 phase 3: live reads, `Use` on consumables (`quantity - 1`,
      removes the last one) and `Discard` behind a `ConfirmModal` naming the
      item; one write at a time, per-row `loading`, awaited
      `putConfirmed`/`removeConfirmed` + toasts. **Deviation:** "Use" spends a
      charge and does nothing else — ADR 0010 has no item effects, so no
      healing was invented. No add/edit form (ADR 0008).
      **Revised by `P3.12`:** consumables heal through the `useItem` action and
      the categories are `weapon|armor|consumable|quest`.
- [x] `P3.7` Empty states via local `EmptyState`, icons from `lucide-react`.
      — 2026-11-18 phase 3: Forge replaces the sheet's EmptyState when signed in
      with no row; "Nothing carried" stays for an empty pack; skeletons
      (`character-sheet-skeleton`, `inventory-skeleton`) and read-failure
      notices (`sheet-read-error`, `inventory-read-error`) cover loading/error.
      No fixture is rendered on the live branch.
- [x] `P3.8` **Deploy #1** at the end of day 2: latches GitHub as the app source
      and proves the pages serve. Verify `/` and `/home` on the live URL before
      moving on — the deploy is both host and artifact.
      — 2026-11-18 phase 3: live at <https://lorespace.app.space>, release
      `rel_01M7RNC780XXGENCASX5XPH9AQ`, **GitHub source claimed permanently**
      (`surajt02/lorespace`, inferred from `origin`; DeepSpace source verbs now
      refuse). Shipped the clean tree of commit `6c7b293`; GitHub-source releases
      record no commit lineage. `/` and `/home` return 200 and render in
      Chromium (landing + preview table, zero console errors).
      **Redeployed 2026-11-18 after the revision** (`P3.10`-`P3.14`): release
      `rel_01M7RT6QQSW1VKDTTRE3WYQG3E`, clean tree, same GitHub source. Live
      check again: landing + preview table, new item copy, no write controls
      signed out, zero console errors.
      **Redeployed again** for `P3.15`/`P3.16`: release
      `rel_01M7RVAWPYQY5WJ12QQZ8V4AKA`, clean tree. Live: `/`, `/home`,
      `/settings` serve; signed out `/settings` gates instead of erroring; zero
      console errors.
      **Redeployed for `P3.17`**: release `rel_01M7RWGCYG4VH0ZP30RRB8CSHV`
      (first attempt failed with `deploy_request_failed: fetch failed`, retried
      clean). Live `/home`: preview table intact, **zero** `hp-controls` and
      zero HP buttons, HP text still renders, zero console errors.
- [x] `P3.9` Read failures on `characters`/`inventory` render a visible notice
      (skeleton while loading, never a silent fallback to `PREVIEW_*` while
      signed in). Extends `P3.3`/`P3.6`, matching `P2.5`'s seed-failure rule.
      — 2026-11-18 phase 3: `sheet-read-error` / `inventory-read-error`. A
      `characters` read error also puts the pack in its read-error state, because
      the pack cannot be filtered to a character that was not resolved.

- [x] `P3.10` **Server-authored HP**: `src/actions/index.ts` `adjustCharacterHp`,
      ownership by `characters.userId === ctx.userId`, clamp `0..maxHp`, returns
      the same `{before, after, maxHp, appliedDelta}` shape as `applyGmMutation`;
      sheet buttons call it instead of `putConfirmed`; `characters` member
      writes off ([ADR 0015](./adr/0015-server-authored-character-state.md)).
      — 2026-11-18 phase 3 revision: shipped as `{ characterId, step }` where
      `step` is `minus5|minus1|plus1|plus5|rest` — **no raw delta is accepted**,
      so a client cannot name an arbitrary HP. Error codes `not_owner`,
      `character_not_found`, `invalid_params`. Sheet calls `callAction`;
      `characters` member create/update/delete are all `false`, pinned by
      `schemas.test.ts`. **Review follow-up:** `applyGmMutation` is now
      owner-credential-only (`not_gm`), so a player cannot set HP around the
      five steps (ADR 0017). **Superseded by `P3.17`/ADR 0020:** the five-step
      action is deleted; players have no HP path at all.
- [x] `P3.11` **Server-side Forge**: `forgeCharacter({name, archetype})` writes
      `userId`, `hp = maxHp`, `ac` from the preset and the two starter items,
      refuses a second character, reports `itemsMissing` (no transactions).
      `characters`/`inventory` member create off.
      — 2026-11-18 phase 3 revision: server derives everything from the preset;
      the browser sends only a trimmed name (1-40) and the archetype. Duplicate
      forge → `already_forged`; a failed starter item returns success with
      `itemsMissing`; a concurrent double-forge still trips `uniqueOn` and
      reports `write_failed` (`create_character`).
- [x] `P3.12` **Item uses**: `useItem({itemId})` — owner check, consumable only,
      heal from `CONSUMABLE_EFFECTS` capped at `maxHp`, refuses at full HP,
      decrements/removes; categories become `weapon|armor|consumable|quest`
      (`relic` dropped); plain descriptive copy
      ([ADR 0016](./adr/0016-item-uses.md)).
      — 2026-11-18 phase 3 revision: `Sunfire Vial` heals 6, `Field Dressing` 4;
      unknown consumables → `no_effect`, full HP → `at_full` with zero writes.
      Heal lands before the decrement; a failed decrement reports
      `write_failed` with `applied: ['character_hp']` (no transaction). Copy is
      descriptive first ("Small shield. +5 to your AC").
      **Review follow-up:** `inventory` member `update` is `false` (not `'own'`),
      because a member could rename a sword into a `Sunfire Vial` and mint
      charges; Discard needs only `delete: 'own'`.
- [x] `P3.13` **Inventory ownership**: `inventory.userId` (`ownerField`,
      immutable, required), member `update/delete: 'own'`, create off; Forge,
      `useItem` and `applyGmMutation` stamp the character owner's id; fixture
      rows carry `userId`; `schemas.test.ts` pins the new shape.
      — 2026-11-18 phase 3 revision: 7 columns; `userId` is plain text (not
      `userBound`) so the GM action can stamp another player's id. This closes
      `P2.2`'s accepted asymmetry. Locally, inventory rows created before this
      change have no `userId` and are read-only to members; production had none.
- [x] `P3.14` **Archetypes**: `Cleric` → `Marksman` (ranged, DEX/WIS, longbow +
      field dressing); schema select options, presets, fixture drift test and
      copy updated. Crisp blurbs for all four.
      — 2026-11-18 phase 3 revision: Marksman `10/16/12/10/14/11`, HP 19,
      armor +2 (AC 15), `Yew Longbow` + `Field Dressing`. Blurbs and item copy
      rewritten to state the mechanic first. Vanguard/Shadowblade fixture drift
      still pinned; Arcanist AC is 14.

- [x] `P3.15` **Delete character**: `deleteCharacter({characterId})` — owner +
      campaign check, drain `inventory` by paged `deleteWhere`, then remove the
      character; `write_failed` stages `inventory`/`character` with `applied`
      ([ADR 0018](./adr/0018-character-deletion.md)). One character per player
      stays ([ADR 0019](./adr/0019-one-character-per-player.md)).
      — 2026-11-18 phase 3 revision: items drained 100 per page, then the row;
      a 50-page cap fails closed rather than removing a half-drained character.
      Errors `not_owner`, `character_not_found`, `invalid_params`; 8 tests
      (order, two-page drain, both failure stages). Browser proof: settings
      delete → `/home` Forge → forge → delete again.
- [x] `P3.16` **Settings → Characters**: a section headed "Characters" listing
      the caller's character as `Delete <name>`, `ConfirmModal` naming it, toast,
      and `/home` falling back to Forge once the row is gone.
      — 2026-11-18 phase 3 revision: `characters-settings` card on `/settings`
      (read scoped by campaign + userId, loading/error/empty states), one
      `ConfirmModal` naming the character, success/refusal toasts. Testids
      `delete-character`, `characters-empty`, `characters-loading`,
      `characters-read-error`; the Forge is not duplicated.

- [x] `P3.17` **No player HP path**: remove the sheet's
      `-5/-1/+1/+5/Short Rest` controls **and** the `adjustCharacterHp` action
      (not just the UI); HP changes only via `applyGmMutation` (owner
      credential) and `useItem`. Pin the five-action surface in a test
      ([ADR 0020](./adr/0020-no-player-hp-path.md)).
      — 2026-11-18 phase 3 revision: controls, testid, handler, params schema and
      9 tests removed; `action surface` test now pins exactly
      `ensureDefaultCampaign, applyGmMutation, forgeCharacter, useItem,
      deleteCharacter`. Browser proof: no `hp-controls`, no HP buttons, the old
      route answers 404 `Action not found`, and Use at full HP is refused by the
      server with the charge kept.

## Phase 4 — Party presence, dice engine

- [x] `P4.1` `src/components/PartyPresenceBar.tsx` —
      `usePresenceRoom('campaign:default-campaign')` (the scope is
      membership-gated per [ADR 0006](./adr/0006-presence-room-authorization.md)),
      broadcast `{characterId, characterName, archetype, lastRoll, isTypingAction}`.
      — 2026-11-19 phase 4: shipped as the roster's live half and **the only presence socket** (rendered signed in only). Broadcasts `{characterId, characterName, archetype}` plus `lastRoll` after a resolved roll — **deviation: no `isTypingAction`**, because nothing composes an action until the GM prompt exists; the field would be an always-`false` fixture in the payload. Deferred to `P5.9`. HP never crosses the socket (`P4.5`).
- [x] `P4.2` Gate presence per
      [ADR 0006](./adr/0006-presence-room-authorization.md): resolve app
      membership in `src/server/realtime-routes.ts` `wsRoute`'s `extraIdentity`
      for `/ws/presence/*` (canvas and cron already do this), keep
      `campaign:preview` unauthenticated for sample data, and **still** filter
      `anon-` peers client-side so a preview peer can never render as a party
      member.
      — 2026-11-19 phase 4: shipped as a **hand-written route**, not `extraIdentity`: the hook cannot refuse, is skipped for anonymous callers, and only returns a role the room checks *after* the socket is open. `src/server/realtime-routes.ts` now answers 401 (anonymous, non-preview, or bad token) / 503 (`resolveAppMembership` null = could not verify) / 403 (non-member) before `stub.fetch`, and `campaign:preview` (new `PREVIEW_PRESENCE_SCOPE`) stays open with no role. Client-side `anon-` filtering landed in `P4.3` as defence in depth. Covered by `tests/presence.spec.ts` (anonymous + bad-token 401 on both scopes, preview upgrade); 403/503 stay code-reviewed — no non-member JWT and no way to fail the users read on demand.
- [x] `P4.3` Roster join: presence peers × `useQuery('characters')` → avatar,
      name, archetype badge, online dot, `hp/maxHp`.
      — 2026-11-19 phase 4: `src/lib/party-presence.ts` `buildParty()` joins peers to `characters` rows for name/archetype/`hp`/`maxHp`; self first, from the viewer's own row (the SDK excludes self and clears peers on every reconnect, so a peer-derived self row would flash away). `anon-` peers dropped, a peer with no resolvable character renders as "No adventurer" with no HP readout rather than being hidden, and peer dots follow `connected`. 25 unit tests pin the join and the payload guards.
- [x] `P4.4` Server-computed roll per
      [ADR 0005](./adr/0005-dice-roll-authority.md): add `rollSkillCheck` to
      `src/actions/index.ts` — bearer-auth, verify the caller owns the character
      (RBAC is off inside actions), roll with `crypto.getRandomValues`,
      classify through `src/lib/d20.ts` (nat 20 crit success, nat 1 crit
      failure, `total >= activeThreatDc` success, else failure), write the
      `roll-logs` row, return
      `{rawRoll, modifier, total, targetDc, outcome, rollLogId}`. The client
      then broadcasts that authoritative result over presence — durable before
      ephemeral. `src/components/DiceRoller.tsx` never rolls.
      — 2026-11-19 phase 4: shipped: `rollSkillCheck({characterId, statName})` → `character_not_found` / `not_owner` / foreign-campaign guard / `campaign_not_found` (missing or non-numeric `activeThreatDc`) → `crypto.getRandomValues` → `rollD20FromBytes` (`src/lib/rng.ts`, rejection sampling) → `getModifier` → `classifyRoll` → one `roll-logs` row → `{rawRoll, modifier, total, targetDc, outcome, rollLogId}`. **Deviations:** no `DiceRoller.tsx` (the six stat cards are the only roll path, so a second component would be a duplicate entry point); no `campaignId` in the request (read from the character row, so a client cannot aim a roll at another table); a `roll_failed` code for exhausted entropy instead of a 500. 13 action tests + 5 rng tests.
- [x] `P4.5` Keep presence payloads small — `updateState` merges arbitrary keys
      with no size check and broadcasts to every peer.
      — 2026-11-19 phase 4: payload is `{characterId, characterName, archetype, lastRoll{8 fixed keys}}`, replaced not accumulated (~200 bytes). **Correction to the task's premise:** 0.44.2 *does* enforce a size check — `MAX_PRESENCE_STATE_BYTES` 16 KiB (`worker.js:4204-4224`) — but `updateState` merges, so a growing payload hits the cap and then hard-fails; fixed keys avoid both. HP is read from the record room, never sent.
- [x] `P4.6` Note in code: the action is the only roll authority. If the
      presence broadcast fails after the write, the feed shows the roll and
      peers miss the banner — accepted, and must not trigger a retry (a retry
      would roll twice).
      — 2026-11-19 phase 4: noted in code at both ends: the action's docblock and the broadcast effect in `PartyPresenceBar` say the action is the only roll authority, a dropped `updateState` costs peers the banner and never the roll, and no retry path exists — a retry would roll twice. The roller's own banner is deliberately not gated on the socket, so a dropped broadcast still shows the result locally.
- [x] `P4.7` **Deploy #2 + two-window sync proof** (end of day 3): two signed-in
      browsers, one roll, banner and feed land in both without a reload. This is
      the milestone that decides whether the interview rests on the architecture
      or on the AI; do not slip it into day 4 without saying so.
      — 2026-11-19 phase 4: **deploy #2** release `rel_01M7S0P6KBHTVR1GYPX262YGPM`
      (clean tree of `585c9fa`, GitHub source, no commit lineage). **Two-window
      sync proof shipped as a test, not a screenshot:**
      `tests/presence.spec.ts` signs two accounts in, forges if needed, has A click
      DEX, and asserts the banner appears in both windows with **equal text** (roller
      from the action result, peer from presence), that the feed's newest row
      carries the same line, and that the row survives B reloading while the banner
      does not replay — 2/2 green, 6 consecutive green runs. Live:
      `/`, `/home`, `/settings` 200; anonymous campaign socket 401 (probed in
      Chromium against the live URL); `campaign:preview` opens. The live signed-in
      half needs the owner's account (the test pool is local-only).
- [x] `P4.8` Attribute-card click → `rollSkillCheck` and a toast with the
      authoritative result (no banner yet; `P4.4` owns the action). Added in
      phase 3: the click half of `P3.5` cannot be honest before the server action
      exists ([ADR 0005](./adr/0005-dice-roll-authority.md)), so phase 3 ships the
      cards display-only.
      — 2026-11-19 phase 4: each stat card is a `Button` on the live own sheet (`stat-card-<key>`, per-card `loading`, one roll in flight), awaiting `callAction('rollSkillCheck')` and toasting the authoritative numbers; signed-out preview keeps the inert `<li>` so it cannot pretend it can roll (ADR 0005). A failure toasts and clears, never fabricating a roll. The banner is `P4.10`, so this task's "no banner yet" is satisfied twice over.
- [x] `P4.9` Signed-out preview follows ADR 0014's live-row rule once the roster
      is live: with character rows present, `/home` signed out shows the first
      live character and its items instead of `PREVIEW_CHARACTERS[0]`. Deferred
      from phase 3 because the roster is still a fixture, so a live sheet beside
      a fixture roster would be incoherent; `P4.3` makes the roster real.
      Extended in phase 4 to the roster and the feed: the same rule applied to
      one surface and not its neighbours would put a fixture beside live rows.
      — 2026-11-19 phase 4: `/home` signed out resolves one `previewFromLiveRows` flag from `characters` and feeds the sheet, the pack, the roster **and** the feed from it, so a live character never appears beside fixture items, a fixture roster, or `PREVIEW_ROLLS` attributed to fixture names. No liveness dot signed out (no socket, ADR 0006). `grep -n "online: true"` is gone from the page.
- [x] `P4.10` Roll banner (`src/components/vtt/RollBanner.tsx`): the one
      high-contrast strip that announces a resolved roll — `d20(16) + 3 = 19 vs
      DC 13 [SUCCESS]` — for the roller and for every peer, with the d20 sprite
      from ADR 0013 drawn once (extracted from the landing page so there is one
      hand-authored sprite, not two). Dismisses itself; a later roll replaces
      it. Added in phase 4: the phase board's scope says "roll banner" but no
      task owned the component.
      — 2026-11-19 phase 4: `src/components/vtt/RollBanner.tsx` — fixed top strip, `D20Mark` sprite (moved out of `src/pages/index.tsx`, one hand-authored die, `d20-trace` still animates, prerender verified), `d20(n) ±m = t vs DC n` in `pixel-numeral`, outcome badge, dismiss button, 6 s auto-dismiss keyed on `rollLogId` so the same roll cannot keep a stale banner alive. Roller gets it from the action result, peers from `freshRolls` — the two-window spec asserts the two windows' banner text is **equal**.
- [x] `P4.11` Live Party Action Feed: `/home` reads `roll-logs`
      (`where: { campaignId }`, newest first — the record layer already orders
      by `_created_at DESC`) and `ActionFeed` renders those rows, with a
      skeleton while loading and a visible notice on read failure. Signed out:
      live rows when any exist, `PREVIEW_ROLLS` only when the collection is
      empty (ADR 0014). Added in phase 4: `P4.4` writes the row and `P4.6`
      refers to "the feed", but no task made the feed read it.
      — 2026-11-19 phase 4: `useQuery('roll-logs', { where: { campaignId }, limit: 20 })` — no `orderBy`, because the record layer already sorts `_created_at DESC` (ADR 0003); `ActionFeed` now takes `RecordData<RollLogRow>[]` (keyed by `recordId`), renders live rows with `feed-entry`, a `feed-skeleton` while loading, `feed-read-error` on failure and an `EmptyState` when the table has not rolled. Band values uppercase at render, so the fixture's `DEX` and a live row's `dex` read alike.
- [x] `P4.12` `roll-logs` member writes off (`create: false`, `update: false`,
      `delete: false`), pinned in `src/schemas/__tests__/schemas.test.ts` the way
      `P3.10` pinned `characters`. `P4.4` is pointless while a member can
      `createConfirmed` a forged total: ADR 0005 calls the row "evidence rather
      than a claim", and the action credential skips per-record RBAC, so nothing
      needs member write access. Added in phase 4.

      — 2026-11-19 phase 4: `roll-logs` member writes off (`create/update/delete: false`); `'*'`/`viewer`/`admin` unchanged. Pinned in `src/schemas/__tests__/schemas.test.ts`. The action credential skips per-record RBAC, so nothing needed member write access — a member-authored row could not be evidence (ADR 0005).
- [x] `P4.13` The roll banner reads the `roll-logs` row, not the presence payload,
      and presence carries identity only ([ADR 0021](./adr/0021-roll-banner-reads-roll-logs.md)).
      `src/lib/roll-announcements.ts` (`toAnnouncedRoll`, `unseenRolls`) +
      `src/components/vtt/RollBannerLayer.tsx` announce each new row once, newest
      first, filtering `entryType: 'roll'`; the first `ready` snapshot is the
      baseline, so no clock is compared and history is never replayed. `lastRoll`
      is gone from `PartyPresenceBar`'s `updateState` payload and
      `freshRolls`/`parsePresenceState` are gone from `src/lib/party-presence.ts`
      (now `peerCharacterId`). The sheet's toast is the roller's instant feedback.
      — 2026-11-19 phase 4 revision: 9 unit tests for the mapper + 12 for the
      roster join; the two-window spec still asserts both windows' banner text is
      equal, which now proves row → both windows rather than payload → peer.
- [x] `P4.14` The Table feed shows the five most recent rows with an expand
      toggle, scrolls inside its own frame in both states, and never pushes the
      GM console off screen. `RECENT_COUNT = 5`; `feed-expand` (`aria-expanded`,
      `All N` / `Recent`), `feed-count` (`shown/total`), `feed-list` is the scroll
      container; the center column is `lg:overflow-hidden` with the feed
      `lg:flex-1` and the GM `shrink-0`.
      — 2026-11-19 phase 4 revision: measured at 1440×900 signed out — 5/20
      collapsed with `scrollHeight 428 / clientHeight 336`, 20/20 expanded with
      `1688/336`, GM console bottom at 888 in both states. Mobile (390×844) keeps
      the phase-1 stacking and page scroll: the GM is below the feed by design,
      not clipped.
- [x] `P4.15` `roll-logs.statName` is a select of the six ability keys, not free
      text; fixtures normalised to the same lower-case keys and the UI
      upper-cases for display. Pinned in `src/schemas/__tests__/schemas.test.ts`.
      — 2026-11-19 phase 4 revision: `default: ''` stays the "no stat" sentinel a
      GM/combat row carries (select options are metadata, not a write-time
      constraint — checked against `coerceValue`/`rowToData` in 0.44.2). This
      closes the plan's § Worth-your-eyes item on the column.
- [x] `P4.16` The roll line reads `+ 3` / `- 1` in the banner **and** the feed,
      while the sheet's stat cards keep the tight `+3`:
      `formatModifierSpaced` next to `formatModifier` in `src/lib/d20.ts`.
      — 2026-11-19 phase 4 revision: 2 unit tests, including "agrees with
      `formatModifier` once the space is removed", so the two registers cannot
      drift in value.
- [x] `P4.17` A signed-out window sees the roll banner. No presence socket is
      opened there (ADR 0006 unchanged); the banner comes from the public
      `roll-logs` read (ADR 0014, [0021](./adr/0021-roll-banner-reads-roll-logs.md)).
      — 2026-11-19 phase 4 revision: `tests/presence.spec.ts` › "the roll banner
      reaches a signed-out window" loads an anonymous context, waits for its feed
      to be ready (baseline), rolls from a signed-in window and asserts the
      signed-out banner text equals the roller's — 3/3 spec tests green. This was
      the reported bug: the feed updated, the banner did not.

- [x] `P4.18` "Show all" in the table feed means **all** rows, not a page: the
      `/home` read drops `limit` (`useQuery('roll-logs', { where })` returns every
      row — the record layer applies no default cap when `limit` is absent), and
      the feed's 5-row cap is display-only.
      — 2026-11-19 phase 4 revision: measured with 31 roll rows — collapsed shows
      `5/31`, expanded renders 31 rows (`31/31`). **Deviation found by the
      spec:** an unbounded subscription *appends* live inserts instead of
      re-querying, so the new roll sat at the end of the array and never reached
      the five-row window (the banner showed it, the feed did not). `newestFirst`
      in `src/lib/roll-announcements.ts` sorts by the record envelope's
      `createdAt` then the ULID, applied once in `/home` and shared by the feed
      and the banner layer; 4 unit tests pin it. **Known limit:** the read is
      unbounded and the client `Query` has no `offset`, so paging a long campaign
      would need a new read path — recorded here rather than papered over with a
      silent cap.
- [x] `P4.19` Minimised, the feed takes a share of the column and the GM console
      takes the rest; expanded, the feed takes the column and the GM keeps its
      natural height at the bottom. `feedExpanded` is owned by `/home` because the
      column's heights depend on it; `GmConsolePanel`'s message list scrolls inside
      whatever height it is given.
      — 2026-11-19 phase 4 revision: measured at 1440×900 — collapsed feed 304px
      / GM 365px (feed list scrolls 428→230); expanded feed 448px / GM 221px,
      GM bottom edge 888 of 900 in both. Before this, both states were
      380/221 — the "same amount of space" complaint.

- [x] `P4.20` Minimised, the table feed does not scroll at all: it is its own
      (compact) height, the GM console takes the rest, and scrolling belongs to
      the expanded state. Five rows was the wrong cap for that rule — the panel
      ended up a few pixels short of its content, so it scrolled by half a row
      and drew a scrollbar in the signed-out window (where the fixture table has
      four rows) and not in the signed-in one.
      — 2026-11-19 phase 4 revision: minimised is now a **fixed window**
      (`lg:h-[21.5rem]`: four compact rows + header), so the GM console below does
      not jump as rolls arrive. `RECENT_COUNT = 4`, compact rows (`py-1`, one-line
      summary), no internal scroll. Measured at 1440×900 and 1440×760, signed in
      and out: window 344px with `scrollHeight === clientHeight` (no scrollbar),
      GM 189-329 filling the remainder, GM bottom edge 888/748, last row inside the
      frame. Live with four fixture rows: 344px, `overflowPx: 0`. The height is a
      **literal** class — Tailwind scans source text, so an interpolated class is
      never generated.

- [x] `P4.21` Expanded, the feed is content height rather than a fixed window: it
      has no scrollbar while the rows fit, and scrolls inside its own frame with a
      sticky header once they do not. The GM console is `flex-1` with a
      `min-h-48` floor, so it grows into whatever the feed leaves and gives a few
      pixels back before the feed is forced to scroll.
      — 2026-11-19 phase 4 revision: measured at 1440×900 and 1440×700 with 45
      rows — feed 481/281 with `wrapScroll: true`, GM 192 (the floor), GM bottom
      888/688. With four rows there is no toggle at all (4 ≤ `RECENT_COUNT`), so
      the short-feed case is the minimised window itself: one frame, no scroll.

## Phase 5 — AI Game Master

- [x] `P5.1` Install the chat surface ([ADR 0004](./adr/0004-ai-chat-and-owner-billing.md)): — done: 6 routes, `inApp` derived, `/assistant` unlinked (`P5.8`), eight registered collections
      `npx deepspace add ai-chat` (adds
      `ChatPanel`, `ChatPanel.messages`, `ChatPanel.stream`, `pages/assistant.tsx`,
      `schemas/ai-chat-schema.ts`, react-markdown + highlight deps). Registering
      `AI_CHATS_SCHEMA` flips `inApp` in `worker.ts:144` and **creates
      `/api/ai/chat` for the first time** — nothing works before this.
- [x] `P5.2` `buildTools(executor, context?: AgentToolContext<Env>)` — second — done: second param required in `src/ai/tools.ts:340`; typed `AgentToolContext<Env>`
      param required for env/bindings access; the SDK already passes it.
- [x] `P5.3` GM tools: `get_campaign_snapshot` (project only needed columns — — done: four tools; writes via the owner-scoped `applyGmMutation` context
      30 KB tool-result cap), `modify_character_hp`, `grant_character_loot`,
      `update_campaign_scene`. Remember every tool in the `ToolSet` is
      auto-exposed over `/_deepspace/agent/*` HTTP **and MCP**, not just the panel.
- [x] `P5.4` ~~Decide `records.delete`~~ **Resolved: drop it.** Remove — done: removed, and `src/ai/__tests__/tools.test.ts` fails on the old list
      `records.delete` from `ALLOWED_TOOL_NAMES` (`src/ai/tools.ts:18-27`): the GM
      never needs it, there is no soft delete or transaction to undo it, and
      every tool in the set is auto-exposed over MCP. Re-add only as a narrow,
      confirmed GM tool. — 2026-11-18 master
      **Reopened 2026-11-18 phase 4 audit:** the decision is made but the
      removal is not in the code — `src/ai/tools.ts:25` still lists
      `records.delete` and `buildTools` still exposes it. The tick above claimed
      a security-relevant removal that had not shipped; this task is not done
      until the list and its test say so.
- [x] `P5.5` GM system prompt: snapshot-first, **two-stage resolution** (set DC — done: GM brief in `buildSystemPrompt`; pinned by prompt tests
      via tool → ask for the roll → never fabricate dice), verify in
      `roll-logs`, narrate 2-4 short paragraphs, then mutate. Enforce the
      split from [ADR 0009](./adr/0009-engine-owns-outcomes.md): tool first, then
      prose; never state an outcome without a `roll-logs` row or a record write.
      Turn policy per [ADR 0012](./adr/0012-gm-turn-policy.md): answer the latest
      human message, no turn order, no addressing syntax.
- [x] `P5.6` Owner billing ([ADR 0004](./adr/0004-ai-chat-and-owner-billing.md)) = **delete** `authToken: jwt` from — done: no `authToken` in `chat-routes.ts`; live turns billed to the owner
      `makeDefaultSummarizer` and `streamDeepSpaceAgent` in
      `src/ai/chat-routes.ts` so `APP_OWNER_JWT` is used. There is no config flag.
      Locally `dev start` must mint `APP_OWNER_JWT` or the call throws.
- [x] `P5.7` `src/components/GmConsolePanel.tsx` embedding `ChatPanel` in the — done: `ChatPanel` + chips + one auto turn per roll; proven in a temporary Playwright probe
      center column + quick-prompt chips that include character name and latest
      roll. **Auto-resolve** ([ADR 0012](./adr/0012-gm-turn-policy.md)): after a
      resolved roll, synthesise exactly one user message carrying
      `{rawRoll, modifier, total, targetDc, outcome}` so beat 6 flows into beat 7
      without a click; cap at one automatic turn per roll.
- [x] `P5.8` `deepspace add ai-chat` also drops in `src/pages/assistant.tsx`. — done: file installed, nav row removed, page left as shipped
      Leave it unlinked and unstyled — chat history UI is cut (ADR 0008). Do not
      invest in it; do not delete it either (the feature owns that file).
- [x] `P5.9` Broadcast presence `isTypingAction` while a GM message is being — done: `isTypingAction` in the presence payload, roster marker for peers
      composed, and render it on the roster member. Deferred from `P4.1` in
      phase 4: nothing in the app composes an action until the GM prompt exists
      (`P5.7`), so a field that is always `false` would be a fixture in the
      presence payload.
- [x] `P5.10` GM mutations leave feed evidence: `applyGmMutation` writes one — done: evidence row per mutation; seen live as `GAME MASTER | Ash | Ash receives Sunfire Vial x1`
      `roll-logs` row after a successful write (`combat` for `character_hp`,
      `gm_event` for `grant_loot` and `update_scene`), because ADR 0009 admits
      no outcome the table cannot see and `P5.3`'s tools otherwise change HP
      with no row anywhere. One implementation, so a future owner-side caller
      logs too; a failed log write reports `details.logged: false` rather than
      implying atomicity.
- [x] `P5.11` GM write tools are confined to the in-app GM chat turn — done: `gmToolAllowedForPath` gate + tests (ADR 0022)
      ([ADR 0022](./adr/0022-gm-tools-confined-to-chat-turn.md)): every
      `buildTools` tool is auto-exposed over `/_deepspace/agent/*` HTTP and
      MCP, so a member could otherwise set their own HP by POSTing
      `modify_character_hp` — the path ADR 0017 closed. `modify_character_hp`,
      `grant_character_loot` and `update_campaign_scene` refuse unless the
      request path is `/api/ai/chat`; `get_campaign_snapshot` stays available
      everywhere.
- [x] `P5.12` Unit tests for `src/ai/tools.ts`: the allowlist (no — done: 15 tests in `src/ai/__tests__/tools.test.ts`
      `records.delete`), the four GM tools' presence and input rejection, the
      chat-turn gate, the snapshot's column projection and size, and the
      system prompt's two-stage / tool-first rules. Nothing imports this module
      today, which is how `P5.4` was ticked twice without shipping.

- [x] `P5.13` Decide the GM console's default model. `ChatPanel` defaults to
      the catalog's first entry, `claude-opus-5-5`, which answers **402 Payment
      Required** on a free-plan credit balance (`npx deepspace app usage`: 500
      credits, free plan). Haiku 5.5, GPT-6 Luna and GPT-6 Sol all stream. The
      panel is usable today by picking a model (the choice persists in
      `localStorage['deepspace-ai-model']`), so this is a default/pin decision,
      not a broken surface — but the demo's first turn fails until it is made.
      Evidence: phase 5's temporary probe, four models, one 402. — 2026-11-19
      **Resolved:** pin `claude-haiku-5-5` as the console's default (catalog
      reordered, not an allowlist, so the picker keeps every model). Measured
      cost after ~31 live turns: free plan, 493/500 credits, anthropic $0.03 +
      openai $0.04 — no external provider needed.

- [x] `P5.14` The minimised table feed must show all four `RECENT_COUNT` rows: — done: feed is content-sized, capped at `calc(100% - 15.75rem)` with a 15rem console floor; four rows + composer + four chips verified by bounding box at 1440x900 and 1024x768
      today the fixed `lg:h-[21.5rem]` frame clips the fourth at narrow/tall
      viewports (measured at 1024x768), and the GM console is squeezed to a
      192px floor that hides its message area. Size the feed to its content with
      a cap, give the GM a floor that keeps the composer, chips and a couple of
      message lines visible, and drop the stale "three, not five" comment.
- [x] `P5.15` Forge refuses a character name already used at this table — done: `name_taken` guard + 4 tests; the stale duplicate row was deleted from the dev table
      (case-insensitively), `code: 'name_taken'`. Two players can currently both
      be "Ash", and the roster, the `roll-logs` attribution and the GM all read
      only `characterName` — the GM ended up asking "which Ash?". Read the
      campaign's character rows and compare case-folded; the client toasts the
      action's message. (Data fix done in the phase-5 revision session: a stale
      duplicate row was removed.)
- [x] `P5.16` Campaign reset + scene progression — done: `campaign-arc.ts`, `sceneIndex`, `startCampaign` (drains packs + roll log, scene 0, HP to max, starter kits, marker last), banner button + confirm, engine-gated advance
      ([ADR 0023](./adr/0023-campaign-reset-and-scene-progression.md),
      [ADR 0025](./adr/0025-new-game-reset.md)):
      `src/lib/campaign-arc.ts` (five scenes / three acts, `exit: 'check' |
      'defeat'`), `campaigns.sceneIndex` (additive number, default 0),
      `startCampaign` action (scene 0 + every character at `maxHp` + every pack
      back to its archetype starter kit + every `roll-logs` row cleared except
      the reset's own `gm_event` marker, written last
      ([ADR 0026](./adr/0026-reset-clears-roll-log.md)); `not_at_table` unless
      the caller has a character), "Start New Campaign" in the
      banner behind `ConfirmModal`, "Act I · Scene 2 of 5" progress, and
      engine-gated `update_campaign_scene` (`+1` only, correct exit only, else
      `scene_not_complete`).
- [x] `P5.17` The GM opens and turns the story ([ADR 0023](./adr/0023-campaign-reset-and-scene-progression.md)): — done: opening beat fires on the reset (live: GM named the scene and asked the first decision, no dice)
      "Start New Campaign" sends one synthetic opening turn; a scene advance
      narrates in the advancing turn; a resolved roll keeps its auto-resolve.
      Exactly three moments of GM initiative, each attributable to a click or a
      record — no idle or timed turns.
- [x] `P5.18` Narrative combat ([ADR 0024](./adr/0024-narrative-combat.md)): — done: `damage_enemy` + prompt rules; live: `COMBAT | Runebound Sentinel | … takes 4 damage (12/24) — … d20(16) +2 = 18 vs DC 12`, banner `16/24`, scene gate held
      `damage_enemy({ amount, reason })` GM tool (engine clamps `0..enemyMaxHp`,
      writes one `combat` row, refuses without a scene enemy, chat-turn gated per
      ADR 0022); prompt rules for the two-stage attack (narration → DC → check →
      verified consequence, never a fabricated roll); `enemyHp === 0` satisfies
      the scene's `defeat` exit. No attack button, no `enemyAc`/`enemyDamage`.

- [x] `P5.19` One DC per action, and only the requested roll counts
      ([ADR 0028](./adr/0028-one-dc-per-action.md)): `request_check` tool writes
      `pendingCharacterId`/`pendingStat`/`pendingDc` (no feed row),
      `rollSkillCheck` refuses anything else with `roll_not_requested` before the
      die and uses the pending DC, and a roll/advance/reset clears the trio.
      — 2026-11-19 revision (265 unit tests)
- [x] `P5.20` GM voice: the brief forbids mechanics talk ("DC", "the stakes",
      "I'll call for", tool names), forbids recapping what it did, tells the GM
      to describe obstacles rather than enumerate options, to address one named
      character per turn and end on their move, and to set a DC per action with
      `request_check`. — 2026-11-19 revision (690-word brief)
- [x] `P5.21` Shared table thread, server side
      ([ADR 0027](./adr/0027-shared-gm-thread.md)): `gm-messages` collection
      (viewer read, member read-only), `POST /api/gm/chat` streaming one turn with
      history from the thread, the user row persisted before the stream and the
      assistant row on end/abort, owner billing, tools as the caller, and
      `GM_CHAT_PATH` moved off `/api/ai/chat` so `/assistant` and MCP cannot
      reach GM writes. — 2026-11-19 revision (live 200 SSE + both rows persisted)
- [x] `P5.22` Shared thread panel: the GM console renders `gm-messages` itself in — done: thread rendered from `gm-messages` in the preview style, `MODEL` picker in the header, one-line composer, synthetic beats hidden, signed-out windows read the thread (live probe: two signed-in windows + one anonymous)
      the signed-out preview style (no `ChatPanel`), one-line composer, `MODEL`
      button in the header opening the picker, chips and roll auto-resolve through
      the thread, synthetic beats persisted hidden, signed-out windows read the
      same thread.
- [x] `P5.23` Banner `Active DC`: a large number block on the right of the scene — done: `ACTIVE DC` block right of the prose, `pixel-numeral text-5xl`, pulses while a check is pending and falls back to the scene DC after the roll
      description, showing the pending check's DC and pulsing while a roll is
      owed, falling back to the scene DC otherwise.
- [x] `P5.24` Roll gating in the sheet: the requested stat is outlined and — done: requested stat outlined + clickable, other five disabled, label names who owes the roll; wrong-stat clicks write nothing (server also refuses `roll_not_requested`)
      clickable, every other stat is disabled, with a label naming who owes the
      roll.

- [x] `P5.25` A new game starts a new conversation: `startCampaign` drains
      `gm-messages` with the packs and the log (the opening beat repopulates it),
      so nothing from the previous run is narrated. — 2026-11-20 revision
      (live: 19 turns → the new opening narration only)
- [x] `P5.26` The GM's party is who is at the table: `get_campaign_snapshot`
      filters `characters` to the caller plus the thread's recent speakers, passed
      through the tool context, and the brief says never to name a character who
      is not in that list. Synthetic beats carry the caller's character for
      presence (hidden from the thread), so the opening after a reset addresses
      the player, not a stale row. — 2026-11-20 revision (ghost test character
      removed; signed-out roster lists only `joeblo`)

- [x] `P5.27` A narrated roll can never strand the table: the console sends one
      hidden correction when the GM asks for a roll without calling
      `request_check` (once per turn, only within 3 minutes, never while a check
      is pending), and the sheet keeps the named stat rollable at the scene DC
      until a roll answers that message. Past-tense recaps ("you rolled WIS") are
      not requests. The brief also says a check exists only once `request_check`
      returned success. — 2026-11-20 revision (304 unit tests; your table's
      opening beat reproduced the dead end, then self-healed through the
      correction into a real `wis`/13 check)

- [x] `P5.28` Roster parity and an online-only table
      ([ADR 0029](./adr/0029-roster-parity-and-online-table.md)): the roster lists
      every party character in both windows with `isOnline` (filled dot, `offline`
      micro-label; no claim signed out), `PartyPresenceBar` reports the online
      names, and each GM turn carries them so `get_campaign_snapshot` returns the
      caller plus online characters only. — 2026-11-20 revision (live: roster
      `Vesper online / joeblo offline`; POST body `["Vesper"]` while joeblo is
      away). The opening beat is also no longer re-sent by a remount: it is
      skipped when an answer written after the click already exists.

- [ ] `P5.29` **Open gap — a check addressed to a player who disconnects.** Only the
      requested card is rollable (`P5.19`), and the GM now plays with online
      characters only (`P5.28`), so a pending check whose owner goes offline stalls
      the table: nobody else may roll it and the GM has no idle turn to re-ask.
      Observed on the roster/online-table pass, not yet reproduced live. Needs a
      rules decision before code — (a) auto-clear the pending check when its owner
      leaves presence, (b) let any online member take the roll over, or (c) have
      the GM re-ask on its next turn. Related, smaller: an offline member's sheet
      and HP in the roster are the last written values, not live state.

- [x] `P5.30` Engine corrections never enter history: the missed-check
      correction is sent as a **transient** turn (used for that call, not
      persisted, not replayed), because storing "answer with a tool call and
      nothing else" in the thread taught the model to stop writing prose and
      every later turn came back with no assistant row. It also no longer fires
      for an ask a later roll already answered, and the client keeps the flag off
      the persisted beat path. — 2026-11-20 revision (live: a turn that returned
      no text now streams a full reply; the local thread's poisoned row and three
      orphan turns were removed)

- [x] `P5.31` Per-character check gate
      ([ADR 0030](./adr/0030-per-character-check-gate.md)): move
      `pendingStat`/`pendingDc` from `campaigns` to `characters`, drop the
      campaign trio, make `request_check` write the target character,
      `rollSkillCheck` read only the caller's own row and clear on success **and
      failure**, clear the whole party on a scene advance and on reset, project
      each character's pending state into the GM snapshot (today the omission is
      why the GM re-arms a check that is already owed), and read the viewer's row
      in the sheet and banner. — 2026-11-20 (characters 16 columns, campaigns 9→10
      with the round; `roll_not_requested` still refuses before the die; the clear
      happens on success **and** failure; 307 tests)
- [x] `P5.32` Round pacing ([ADR 0031](./adr/0031-round-pacing.md)): `campaigns.roundNumber`
      and `characters.actedRound`; a player turn marks the caller before the model
      call; the round increments when every online character has acted; the
      snapshot carries the round plus who has acted and what each owes; the brief
      stages the un-acted in prose ("Vesper, what are you doing?") and resolves
      each action as it arrives, never asking someone who has already acted.
      (Amended by `P5.34`: the interface shows who owes a move; the GM does not
      remind.)
      A new game resets the round to 1 and every `actedRound` to 0. — 2026-11-20
      (`src/lib/round-pacing.ts`, 315 tests; live two-window probe: both rosters
      resolve each other, the reply names both players)
- [x] `P5.33` Roster join fallback: presence state can hydrate empty (DO restart
      sends `PRESENCE_SYNC`/`JOIN` with `state: {}`), and `buildParty` adds the
      peer to `listed` before resolving their row, so a readable `characters` row
      is never used and the peer renders as "No adventurer". Resolve the row by
      `characters.userId === peer.userId` first, and fall back to the row when the
      payload's `characterId` is missing or unresolvable. — 2026-11-20 (two new
      tests: empty payload, stale id; the row wins in both)

- [x] `P5.34` Waiting is an indicator, not a reminder: `AWAITING YOUR MOVE…` sits
      above the composer for the player whose `actedRound` is behind
      `roundNumber` (pure `turn-status.ts` helper, no new CSS), and the brief no
      longer tells the GM to name or remind the players. It also forbids restating
      the scene, the party's HP or another character's condition unless this turn
      changed it, which is what bloated the thread. — 2026-11-20 (323 tests; live:
      before any move both windows show it, after one acts only the other does,
      and the reply carries no reminder text) [ADR 0031 amendment] — **revised
      2026-11-20**: the line now means "the table is waiting on you". It is read
      from the thread (`awaitingMyMove`: another character moved after the GM's
      last turn and you have not), so it clears the instant you send, shows only
      on the player being waited on, clears once the GM answers, and never appears
      on a solo table. The previous `actedRound < roundNumber` reading lit it for
      every rollover, which is why it never went away. (8 unit tests)

- [x] `P5.35` One GM turn per completed round: a real player message is persisted
      and marks them as acted, and the model is called only when the round closes —
      the last player's message triggers a single turn that answers every action in
      the batch. A second message joins the batch and waits; rolls and engine beats
      still answer immediately. The held path returns `202 {waiting:true}` and the
      client treats it as success. — 2026-11-20 (341 tests; live: first move 202
      with no turn, second 200 with exactly one turn naming both actions)
- [x] `P5.36` Only the asked player may roll (table-wide authorisation, ADR 0030
      amendment): when the caller owes nothing but another character owes a check,
      `rollSkillCheck` refuses with `check_owed_by_other` before the die and before
      any write (fails closed if the roster cannot be read), and the other player's
      cards are inert with `<Name> must roll <STAT>`. Two characters may each owe
      their own check; the composer stays open either way. — 2026-11-20 (15 new
      tests, 5 server / 10 client)

- [x] `P5.37` Quick-prompt chips removed from the GM console: the four buttons, the
      `sendChip` path, `latestRoll`, the `enemyName` prop and the `GM_CHIPS` /
      `buildQuickPrompt` / `QuickPromptContext` exports (plus nine chip tests) are
      gone. Composer, send/stop, awaiting line, thread, model picker, roll
      auto-turn, opening beat and correction are untouched; attacking is typed
      narration (ADR 0024). — 2026-11-20 (banner probe asserts `gm-chip` count 0)
- [x] `P5.38` Scene header scales with the viewport: one compact media query
      (`max-width:1023px` or `max-height:899px`) tightens padding, title, progress,
      button, enemy block and HP bar, clamps the description to two lines and drops
      the `ACTIVE DC` numeral to 30px while keeping it right of the prose; desktop is
      unchanged. — 2026-11-20 (measured: 206px/23% desktop, 149px/19% at 1024×768,
      149px/15% at 768×1024; numeral 48px → 30px; Start button and DC visible at
      every size)

- [x] `P5.39` Rolls batch and the server owns the trigger: a roll turn waits while
      any character owes a check, then one turn carries every roll since
      `campaigns.lastRollTurnAt`, claimed by the route before streaming so two open
      windows cannot each narrate the same dice. The GM narrates each roll for its
      own roller only and never advances a character whose roll is not in the batch.
      — 2026-11-20 (`buildRollBatchPrompt`, cursor reset on a new game, 334 tests;
      the remaining read-then-write race is documented, no transactions available)
- [x] `P5.40` A failed turn hands the dice back: if the stream errors, the narration
      is empty or the assistant row fails to write, the route restores
      `lastRollTurnAt` to the pre-claim value so the batch is retried instead of
      being silently spent. Also: a request that names no `modelId` now defaults to
      `claude-haiku-5-5` instead of the catalog's Opus, which 402s on this plan and
      used to burn the batch before failing. — 2026-11-20

- [x] `P5.41` A turn can never be silent: the SDK's `text` is the **last step's**
      prose, so a turn that narrated and then called a tool arrived with an empty
      string, and `create('gm-messages', { content: '' })` was rejected ("Required
      field 'content' is missing") — no assistant row, no reply, no alert. Prose is
      now recovered from every step's assistant message, an empty `content` is never
      written, a prose-free turn logs and hands a roll claim back, and the brief
      requires at least one sentence per turn. A duplicate roll batch (identical
      beat within 10s) is refused, which is the claim race seen live at 21:51:11.
      — 2026-11-20 (assistantProse + isDuplicateRollBatch helpers, 341 tests)

- [x] `P5.42` The provider can fail and the table must recover: a roll turn is now
      asked by **the roller's window only** (`ownsRollTurn`), so one batch is one
      model call instead of one per open window, and a failed roll turn retries once
      after 1.5s — idempotent because the server hands an un-narrated batch back.
      Observed live: `internal error; reference = …` from the AI proxy killed a roll
      narration that two windows had requested at the same millisecond; the guard
      logged `prose-free turn` and restored the claim, but nothing retried.
      — 2026-11-21 (three `ownsRollTurn` tests, 347 total)

- [x] `P5.43` A `CONTINUE` button for a player with nothing to add: one click
      sends a real player turn ("I hold back and watch what happens"), so the round
      marks them and the GM answers the batch without anyone typing it. Chrome
      micro-button above the composer (`gm-continue`); hidden once the viewer's move
      is already in for the round (`canContinue`: a move is due unless they acted
      after the GM's last turn), and disabled while a turn streams. — 2026-11-21
      (5 `canContinue` tests, builder test, screenshots at 1440×900 and 768×1024)

- [x] `P5.44` A new campaign opens on the scene, not on a check: the opening beat
      is flagged `opening`, the route exposes the read tool **alone** for it (so
      `request_check` and every write are absent, not merely discouraged), and
      `buildOpeningPrompt` says this turn sets the scene and nothing else, ending
      by asking the party what they do. Observed: a fresh campaign immediately
      requested `wis` 12 on joeblo. — 2026-11-21 (rewritten opening tests, 351
      total)

- [x] `P5.45` The minimised feed shows **two** rows on a tablet (four on desktop):
      `ActionFeed` takes `recentCount` and `/home` picks it from
      `useCompactViewport()` — the same query the scene header uses
      (`max-width:1023px` or `max-height:899px`), so the two responsive decisions
      cannot disagree. — 2026-11-21
- [x] `P5.34` amended: the awaiting line and the `CONTINUE` button now share one
      predicate (`moveDue`): a move is due when the GM has spoken since your last
      move. Requiring *another player* to have moved first hid the line exactly
      when you owed a move; the round-counter reading re-lit it permanently. —
      2026-11-21 (screenshot: line visible on the waiting window only)

- [x] `P5.46` Record timestamps are read by shape, not by assumption: `recordTime`
      accepts ISO text, epoch ms, epoch s and `Date`, and every comparison now uses
      it (awaiting line, correction window, opening-beat guard, thread ordering,
      fallback-stat window, server history sort and roll-batch selection). The bug:
      `c_roll_logs` carries epoch numbers while `c_gm_messages` carries ISO text, so
      `Date.parse(number)` → `NaN` → `0` made every timestamp equal — the awaiting
      line read "the GM spoke after your move" for a player who had just sent.
      — 2026-11-21 (6 `recordTime` tests + a numeric-timestamp `moveDue` case, 349
      total)

- [x] `P5.47` The awaiting line reads the shape the page actually passes: `/home`
      handed raw record envelopes (`{ data: { role, characterName } }`) to a helper
      that expected flattened fields, so every event was invisible and "a move is
      due" answered `true` forever. `moveDue` now accepts both shapes (and the call
      site maps explicitly). — 2026-11-21 (envelope test; live probe: line hides for
      the sender, stays on the waiting player)
- [x] `P5.48` The GM never shows the machinery: the finished turn is split into
      sentences (abbreviation-aware, so "Mr. Peanut" stays one), and every sentence
      that mentions the engine — snapshot, request_check, roll-logs, pending*,
      actedRound, roundNumber, "I armed…", a bare `DC 13` — is dropped before
      persisting. Observed leaks: "I armed the WIS check for Mr. Peanut at DC 13;
      no check was owed on their row before this." and "The snapshot shows…". If
      nothing narrative survives, nothing is persisted. — 2026-11-21 (6 tests)

- [x] `P5.49` The sender no longer sees a turn twice: the live streaming overlay was
      cleared by comparing its text to the persisted row, and the server now strips
      machinery sentences before writing, so the two never matched — the sender kept
      the overlay and then gained the row, while every other window saw only the
      row. The overlay now clears when an assistant row created after the turn
      started lands, whatever its final text. — 2026-11-21 (verified from the data:
      one assistant row, two visible messages on the sender only)

## Phase 6 — Gates, tests, deploy

- [x] `P6.1` Mechanical grep gates (plan §Phase 6) all green; emoji sweep clean.
      — 2026-11-21 phase 6
- [x] `P6.2` `collab.spec.ts` rewritten for campaigns/characters/roster/roll
      feed (current file tests `/api-status` identity — keep or replace
      deliberately). **Note (2026-11-19): stat cards are now inert until the GM
      requests a check (`P5.24`, ADR 0028), so `presence.spec.ts`'s bare
      `stat-card-dex` click no longer rolls — the spec needs a requested check
      first (or the free-roll path restored) before it can be green. The two accounts come from `P0.1` and the file should have
      been green since `P0.2`; if it is skipping here, the local registry was
      lost (`npx deepspace test accounts recover --all`).
      — 2026-11-21 phase 6: both specs gate on an owner-requested check; 2/2 + 3/3
- [x] `P6.3` Add `/home` H1 + preview-table assertions to `smoke.spec.ts`
      (plan requires them; nothing asserts them today).
      — 2026-11-21 phase 6: H1 is `SceneBanner`'s; 7/7 smoke
- [x] `P6.4` Full pass: `npm run type-check`, `npm run lint`, `npm run
      test:unit`, `npm run test:e2e`. Note `npm test` runs **only**
      smoke+api — collab needs `test run e2e`.
      — 2026-11-21 phase 6: 356 unit / 14 e2e, lint + tsc clean
- [x] `P6.5` Type-check the tests: `tsconfig.json` `include` is
      `["src", "worker.ts"]`, so `tests/**` is unchecked by `tsc`. Either widen
      include or accept runtime-only checking — document the choice.
      — 2026-11-21 phase 6: widened to `tests`, `@types/node`, root
      `prerender.test.ts` deliberately outside (it is Node-only vitest)
- [x] `P6.6` Deploy (`npx deepspace deploy`), then live smoke on the deployed
      URL: two sessions, two characters, a roll, an AI GM resolution with an
      HP/loot mutation, zero console/WS errors. **No recorded demo** — the
      deliverable is the repo link ([ADR 0008](./adr/0008-playable-interview-build.md)).
      — 2026-11-21 phase 6: release #10, live smoke `combat` 24→20, no console errors
- [x] `P6.7` README final: live URL at the top, two or three screenshots, what
      the app is in three sentences, how the sync works, and links to ADRs 0005 /
      0009 / 0014 (the interesting ones). It is the front door for the interview.
      — 2026-11-21 phase 6: live URL, 3 screenshots, sync section
- [x] `P6.8` Rehearse the eight beats three times end to end, on the deployed
      URL, signed out then signed in, watching for console errors. Time it: the
      whole path must land inside five minutes.
      — 2026-11-21 phase 6: full path (landing + signed-out) 42.0s / 40.9s / 41.8s, zero console errors
- [x] `P6.9` Deterministic e2e check gate: `tests/helpers/check-gate.ts`
      (`requestCheck` via an owner JWT minted from the CLI session,
      `callAsPlayer`), a real `feed-empty` test id in `ActionFeed`, and
      `workers: 1` so specs sharing the default campaign do not race. Needed
      because stat cards are inert until a check is requested (ADR 0028/0030)
      and no member-facing writer exists.
      — 2026-11-21 phase 6

---

## Verified SDK facts (0.44.2)

Findings from the initial recon pass. Trust these over the plan text.

**Version drift.** Plan says `0.43.0`; `^0.44.2` is installed. 0.44 adds
`deleteWhere`, `maxLength`, `roster`, `AgentToolContext`.

**Schema.**
- `RolePermissions.create` is **boolean only** — no `'own'` (won't compile).
- `read/update/delete` take `PermissionLevel` incl. `'own'`.
- `ownerField` absent → `'own'` means "created by". `userBound` stamps/pins
  the column to the caller.
- `viewer` **is** the anonymous role; `where` supports equality on primitives
  only; unknown keys are refused.
- `interpretation: 'reference'` is metadata only — no FK, no cascade.
- `uniqueOn`: index creation is warn-only; the runtime duplicate check is the
  real guard.
- `timestampTrigger` fires on insert/change of the named field; `orderBy:
  'createdAt'` resolves to the **system** `_created_at`, bypassing any column
  of that name.
- DDL is automatic at RecordRoom init (`CREATE TABLE IF NOT EXISTS` + `ALTER
  TABLE ADD COLUMN`). `deepspace.migrations.json` is an SDK-behaviour manifest,
  not a DB queue — nothing to run.
- `lintSchema` checks only 3 per-schema rules and is warn-only; the 4th rule
  (a `'team'` level with no `team_members` collection) is set-level in
  `lintSchemaSet`, reachable only via `lintSchemas`. Our own test is the gate.
- `'*'` in `permissions` is a catch-all **fallback**, not an alias for
  anonymous: `getRolePermissions` tries `permissions[role]` first, then `'*'`,
  then deny-all. `viewer` is the anonymous role, so `viewer` is the key that
  governs anonymous access; listing `'*'` too covers roles added later.
- `userBound` stamps the user id **before** the `required` check on insert, so
  a `userBound: true, required: true` column needs no client value.

**Actions.** `ctx.tools` = `create/update/remove/deleteWhere/get/query/
integration/registerUser`. No `delete` (it is `remove`), **no transactions**.
`create(collection, data, id)` on an existing id is an **upsert**; `update`
never creates. `ctx.tools` runs with per-record RBAC **off**
(`X-App-Action`), so ownership checks are the action's job. The route requires
a bearer token.

**Worker.** Registration order is load-bearing: `registerAgent` must precede
`registerPlatformProxyRoutes` (else the `/_deepspace/*` proxy shadows agent
routes). Six DOs are declared in **both** `worker.ts:38` and `wrangler.toml:44`.
Unmatched `/api/*` returns JSON 404, never the SPA shell. `/ws/presence/:scopeId`
is **gated since `P4.2`**: `src/server/realtime-routes.ts` hand-writes the route
(the `wsRoute` `extraIdentity` hook cannot refuse, and is skipped for anonymous
callers) — anonymous is refused except on `campaign:preview`, a bad token is 401,
`resolveAppMembership` `null` is 503 and a non-member is 403, all before
`stub.fetch`. Anonymous peers still get `anon-<uuid>` ids on the preview scope.

**AI.**
- `streamDeepSpaceAgent` / `createDeepSpaceAI` fall back to
  `env.APP_OWNER_JWT` when `authToken` is omitted — that *is* owner billing.
- `makeDefaultSummarizer(env, { authToken? })`.
- `AgentToolContext<Env> = { env, userId, request }`.
- `token({ inputSchema })` — AI SDK 7 naming; repo imports `zod/v4`.
- Tool results are capped at 30 KB (over-cap returns a failure object).
- Max 20 tool calls per turn; `buildTools` output is auto-exposed over MCP.

**UI kit.** `ConfirmModal` exists (`Modal.tsx:154`): `{open, onClose,
onConfirm, title, description?, confirmText, cancelText, variant, loading}`.
`Button` has `loading`. `<SelectItem>` must be inline JSX. `ToastProvider` and
`TooltipProvider` are already mounted in `_app.tsx`. Missing primitives: Card,
Progress/HP bar, Skeleton, Separator — compose from tokens. Tailwind v4 `@theme`
in `styles.css`; new files are auto-scanned.

**Tests.** `npm test` → smoke+api only; `test run e2e` → all specs.
`deepspace/testing` `users(n)` returns `{context, page, email, name, userId}`
and closes contexts automatically. Two accounts exist
(`lorespace-alice@`/`lorespace-bob@deepspace.test`) — **select them by name
(`Alice`/`Bob`), never by email**, because the bare `alice@`/`bob@` addresses are
held by other developers. Chromium 1255 is cached. Vitest is node-only (no
jsdom) and includes `src/**/*.{test,spec}.ts`.

## Decisions

All resolved. See [§ ADR index](./adr/README.md). Add new questions at the
bottom as `D<n>` with the ADR that settles them.

- [x] `D1` Sequencing: **schemas first** →
      [ADR 0001](./adr/0001-schemas-before-ui.md). `P2a` precedes Phase 1's data
      wiring. — 2026-11-18
- [x] `D2` Messaging drop-in schemas: **do not register** until a feature reads
      them. They would widen RBAC and AI/MCP reach for no benefit, and 0.44.2's
      auto-DDL makes deferring free. — 2026-11-18
- [x] `D3` `ensureDefaultCampaign` trigger: **client-triggered action from
      `/home`** → [ADR 0007](./adr/0007-default-campaign-trigger.md). —
      2026-11-18
- [x] `D4` Presence access: **membership-gated campaign scope**, with
      `campaign:preview` reserved for sample data →
      [ADR 0006](./adr/0006-presence-room-authorization.md). — 2026-11-18
- [x] `D5` Roll authority: **server-computed** via a `rollSkillCheck` action →
      [ADR 0005](./adr/0005-dice-roll-authority.md). — 2026-11-18
- [x] `D6` `records.delete` in the AI allowlist: **dropped**, re-add only as a
      narrow confirmed GM tool. — 2026-11-18
- [x] `D7` Artifact identity: **playable demo-grade build, 96 hours, interview**;
      multiplayer real; eight-beat demo script is the spec; cut list binding →
      [ADR 0008](./adr/0008-playable-interview-build.md). — 2026-11-18 grill
- [x] `D8` Outcome ownership: **engine computes results, model supplies inputs**
      (DC, damage, loot, scene) through tools; no outcome without a roll row or a
      record write → [ADR 0009](./adr/0009-engine-owns-outcomes.md). — 2026-11-18 grill
- [x] `D9` Rules depth: **six attributes, AC, HP, one enemy, one DC**. No skills,
      saves, conditions, initiative, XP or spells →
      [ADR 0010](./adr/0010-rules-depth.md). — 2026-11-18 grill
- [x] `D10` Content: **one scaffolded arc, three scene states** expressed in the
      existing campaign columns; no content library →
      [ADR 0011](./adr/0011-content-arc.md). — 2026-11-18 grill
- [x] `D11` GM turns: **latest message wins, one automatic turn per resolved
      roll**, no turn order → [ADR 0012](./adr/0012-gm-turn-policy.md). —
      2026-11-18 grill
- [x] `D12` Visual register: **Diablo-ward dark fantasy, pixel as chrome and
      signal**, Silkscreen numerals, sans prose, zero raster, `--radius: 0` →
      [ADR 0013](./adr/0013-visual-register.md). — 2026-11-18 grill
- [x] `D13` Read policy: **public-read table by link**, live rows with a fixture
      fallback when unsigned-out; `inventory` delete asymmetry accepted →
      [ADR 0014](./adr/0014-public-read-table.md). — 2026-11-18 grill

---

## Backlog after phase 6

- [ ] `B1` GM prose tuning (owner, 2026-11-21): the mechanics and pacing are done;
      what is left is *story quality* — richer descriptions, better pacing of
      escalations, fewer stock phrases. Do this after `P6.6` so it tunes the
      deployed build rather than mid-gate.
- [ ] `B2` Decide `/assistant` (installed by the ai-chat feature, deliberately
      unlinked, ADR 0008): keep as a private generic assistant, or delete the page
      and the `ChatPanel` modules with it. Not part of the demo either way.
- [ ] `B3` `P5.29` decision — a check owed by a player who disconnects holds the
      table (and now also holds roll batching). Options: auto-clear on presence
      loss, allow any online member to take it over, or have the GM re-ask.