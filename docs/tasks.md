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
6. **Commit per phase** (or per coherent slice) with a `phase N:` prefix.
   `deepspace deploy` refuses a dirty worktree, so a clean tree is a deploy
   prerequisite, not a nicety.
7. **No emoji in UI chrome, no purple/indigo gradients, no placeholder copy.**
   Icons come from `lucide-react`.
8. **Any change of direction gets an ADR** in `docs/adr/` (copy
   `template.md`, next free number, link it here). Supersede, never rewrite.
9. **A phase that finishes leaves an Outcome section** in its
   `plans/phase-N-plan.md`: shipped, slipped, deviations, inherited assumptions.

## Current state

As of 2026-11-18: fresh DeepSpace scaffold, nothing LoreSpace-specific built.

| Thing | State |
| --- | --- |
| Theme | `slate` (indigo `#818cf8` primary) — must become `obsidian` |
| `src/pages/index.tsx` | Generic scaffold landing, no design-direction block |
| `src/pages/(app)/home.tsx` | 27-line placeholder |
| `src/schemas.ts` | `users` + `settings` only |
| `src/actions/index.ts` | `{}` — every action call 404s |
| `src/ai/tools.ts` | Built-in record tools only, generic prompt |
| `ai-chat` feature | **Not installed** — no `ChatPanel`, no `/api/ai/chat` |
| Tests | `smoke`+`api` green; `collab` auto-skipped (0 test accounts) |
| Git | scaffold committed; `src/router.ts`, `modals.tsx` are gitignored (regenerated) |

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

| Phase | Scope | Status |
| --- | --- | --- |
| 2a | Data model prelude: 4 schemas + registration + default campaign | todo — **prerequisite for 1 and 3** |
| 1 | Theme, landing page, 3-column workspace shell | todo |
| 2 | RBAC hardening, `ensureDefaultCampaign`, `applyGmMutation` | todo |
| 3 | Character sheet, d20 math, archetype generator, inventory | todo |
| 4 | Party presence roster, dual-path dice engine | todo |
| 5 | AI Game Master: install ai-chat, GM tools, owner billing, console | todo |
| 6 | Grep gates, unit + multi-user E2E, deploy + live smoke | todo |

---

## Phase 2a — Data model prelude (schemas only)

Sequencing decision: schemas land before the UI that reads them, so the
workspace is built data-driven once instead of rewritten
([ADR 0001](./adr/0001-schemas-before-ui.md)). This is the schema half of
Phase 2; RBAC hardening and the GM actions stay in Phase 2.

- [ ] `P2a.1` `src/schemas/campaigns-schema.ts` — 8 columns per plan; `'*'`/`viewer`
      read-only, `member` create+update, `admin` all.
- [ ] `P2a.2` `src/schemas/characters-schema.ts` — 6 attributes + hp/maxHp/ac;
      `ownerField: 'userId'`, `userBound: true` on `userId`,
      `uniqueOn: ['userId', 'campaignId']`, `member` create + `'own'` update/delete.
- [ ] `P2a.3` `src/schemas/inventory-schema.ts` — `characterId` as
      `reference{targetTable:'characters',displayColumn:'name'}` (metadata only,
      no FK — join client-side).
- [ ] `P2a.4` `src/schemas/roll-logs-schema.ts` — roll columns + `ownerField:'userId'`.
      **Deviation:** use `rolledAt` with `timestampTrigger: { field: 'summary' }`
      instead of `createdAt` ([ADR 0003](./adr/0003-roll-log-timestamp-column.md)) —
      the SDK resolves `orderBy: 'createdAt'` to the system `_created_at`, so a
      custom column named `createdAt` is unsortable and redundant.
- [ ] `P2a.5` Register all four in `src/schemas.ts`. Decide messaging drop-ins
      (`CHANNELS_SCHEMA`, `MESSAGES_SCHEMA`, `REACTIONS_SCHEMA`,
      `CHANNEL_MEMBERS_SCHEMA`, `READ_RECEIPTS_SCHEMA`): plan says register,
      nothing reads them — see [open decisions](#open-decisions).
- [ ] `P2a.6` `lintSchema` clean for every schema (unit test in `P2a.7`).
- [ ] `P2a.7` `src/schemas/__tests__/schemas.test.ts` asserting
      `lintSchema(schema)` is `[]` for each. Runs under Vitest (node env).
- [ ] `P2a.8` `default-campaign` record id becomes a shared constant in
      `src/constants.ts` — Phase 4 hardcodes the presence scope
      `campaign:default-campaign` and must agree with the action.

## Phase 1 — Theme, landing page, workspace shell

- [ ] `P1.1` `[data-theme="obsidian"]` in `src/themes.css` overriding **all**
      color tokens (`styles.css:19-96` is the slate default — a missed token
      leaks indigo `#818cf8`, which the anti-AI gate forbids). Palette per plan:
      `#09090b` bg, `#121216` card, `#27272a` border, `#f4f4f5` fg, `#d97706`
      primary, `#dc2626` destructive, `--radius: 0.375rem`.
- [ ] `P1.2` `'obsidian'` in `THEMES` (`src/themes.ts`); fix `getActiveTheme()`
      fallback (hardcodes `'slate'` at lines 36-38) and `getTheme()` first-entry
      fallback.
- [ ] `P1.3` `index.html`: `lang="en" data-theme="obsidian"`, remove
      `data-theme="slate"` (grep gate), `<title>LoreSpace — Multiplayer AI
      Tabletop RPG</title>`, and an `html[data-theme="obsidian"]` first-paint
      line matching `#09090b` (today `#0a0a0a`).
- [ ] `P1.4` `src/seo.ts` title/description for LoreSpace (single source for the
      prerendered head).
- [ ] `P1.5` Design Direction comment block at the top of `src/pages/index.tsx`
      (6-prompt brief + 6-token Style Tile).
- [ ] `P1.6` Split-hero landing: verb-first copy left, live-rendered animated
      d20 skill-check + character-sheet mockup right (inline SVG/styled divs,
      **deterministic** — no `Math.random`/`Date.now`/`window`; CSS keyframes).
      CTA → `/home`. Keep `data-testid="static-landing"` and `<Seo>` first.
- [ ] `P1.7` Line 1 of `src/pages/(app)/home.tsx` is exactly:
      `/* home pattern: product-preview-first — live multiplayer VTT campaign table, dice log, and character sheet */`
      (grep gate).
- [ ] `P1.8` 3-column workspace shell in `home.tsx`: scene banner (location,
      atmosphere, active DC, enemy HP) + party roster; center = action/dice feed
      + AI GM stream; right = character sheet + inventory. Use `bg-shell` /
      `bg-shell-panel`. `h-full` + internal scroll (layout is
      `h-screen overflow-hidden`).
- [ ] `P1.9` Signed-out branch: same 3 columns on deterministic sample data +
      inline sign-in banner owning its own `<AuthOverlay>` state (home is tier 2,
      so there is no `AuthGate`). Gate on `useAuth().isSignedIn`, not
      `useAuthProfileReady({requireUser:true})` (today's `home.tsx:13`).
      Sample party members must **not** use `data-testid="nav-user-name"`
      (`smoke.spec.ts:60-64` asserts count 0 signed out).
- [ ] `P1.10` Data boundary: components take their data as props so Phase 3/4
      swap sample data for `useQuery` without rewriting markup.
- [ ] `P1.11` Keep nav test IDs intact (`app-navigation`, `nav-sign-in-button`,
      `nav-user-name`, `nav-user-email`) and `signOut()` reachable
      (`collab.spec.ts` depends on the account menu).
- [ ] `P1.12` Grep gates that this phase must turn green: no
      `data-theme="slate"` in `index.html`; no `placeholder page` in `src/`;
      `home pattern:` present; `data-theme="obsidian"` present in `themes.css`.

## Phase 2 — RBAC hardening, server actions

- [ ] `P2.1` Manual audit of every schema's role matrix after P2a; confirm
      `viewer` = anonymous means `read: true` is a deliberate public exposure.
- [ ] `P2.2` `inventory` `member: delete: true` lets any member delete any
      item while `characters` is `'own'` — decide and document the asymmetry.
- [ ] `P2.3` `src/actions/index.ts` — `ensureDefaultCampaign`: `tools.query`
      then `tools.create(..., 'default-campaign')`. Known-id create is an
      **upsert**, so it is idempotent. Seed scene + enemy + DC per plan.
- [ ] `P2.4` `applyGmMutation` — privileged multi-collection HP/loot writes.
      Remember `ctx.tools` runs with per-record RBAC **off**: check ownership
      yourself. There are **no transactions** — ordered best-effort only, and
      say so in the code comment instead of claiming atomicity.
- [ ] `P2.5` Call `ensureDefaultCampaign` on the path that lands a player in
      `/home` (decide: action call from the client vs. a job/cron).

## Phase 3 — Character sheet, d20 math, inventory

- [ ] `P3.1` `src/lib/d20.ts` — `getModifier`, `formatModifier`,
      `calculateArmorClass`, `ARCHETYPE_PRESETS` (Vanguard/Shadowblade/
      Arcanist/Cleric). Pure, no React, no DOM.
- [ ] `P3.2` Unit tests for `src/lib/d20.ts` (Vitest node env; boundary cases
      at 1/10/11/20, AC clamping).
- [ ] `P3.3` `src/components/CharacterSheetPanel.tsx` — `useQuery('characters',
      { where: { campaignId } })`, match `record.data.userId === userId`,
      `animate-pulse` skeleton while `status === 'loading'`.
- [ ] `P3.4` "Roll Adventurer" generator + creation modal (local primitives),
      `createConfirmed` + seed 2 starter inventory items, toast on success.
- [ ] `P3.5` 6 attribute cards (`font-mono tabular-nums`), click → skill check;
      HP bar (no `Progress` primitive — compose div + `bg-success|warning|
      destructive` + inline width) and −5/−1/+1/+5/Short Rest, clamped
      `0..maxHp` via `putConfirmed`.
- [ ] `P3.6` `src/components/InventoryPanel.tsx` — add-item `Modal` with
      `Select` (inline `<SelectItem>` children only), `Textarea`; discard via
      `ConfirmModal` naming the item.
- [ ] `P3.7` Empty states via local `EmptyState`, icons from `lucide-react`.

## Phase 4 — Party presence, dice engine

- [ ] `P4.1` `src/components/PartyPresenceBar.tsx` —
      `usePresenceRoom('campaign:default-campaign')`, broadcast
      `{characterId, characterName, archetype, lastRoll, isTypingAction}`.
- [ ] `P4.2` Filter anonymous peers (`anon-<uuid>` ids never join to
      `characters`) — otherwise ghosts in the roster. `/ws/presence/:scopeId`
      has **no auth**: signed-out visitors can join any scope.
- [ ] `P4.3` Roster join: presence peers × `useQuery('characters')` → avatar,
      name, archetype badge, online dot, `hp/maxHp`.
- [ ] `P4.4` `src/components/DiceRoller.tsx` — dual path: (A) ephemeral
      presence broadcast → animated banner on every client, (B) durable
      `createConfirmed` on `roll-logs`. Classification: nat 20 crit success,
      nat 1 crit failure, `total >= activeThreatDc` success, else failure.
- [ ] `P4.5` Keep presence payloads small — `updateState` merges arbitrary keys
      with no size check and broadcasts to every peer.
- [ ] `P4.6` Note in code: rolls are computed client-side, so `roll-logs` is a
      shared record, not a trust boundary.

## Phase 5 — AI Game Master

- [ ] `P5.1` Install the chat surface ([ADR 0004](./adr/0004-ai-chat-and-owner-billing.md)):
      `npx deepspace add ai-chat` (adds
      `ChatPanel`, `ChatPanel.messages`, `ChatPanel.stream`, `pages/assistant.tsx`,
      `schemas/ai-chat-schema.ts`, react-markdown + highlight deps). Registering
      `AI_CHATS_SCHEMA` flips `inApp` in `worker.ts:144` and **creates
      `/api/ai/chat` for the first time** — nothing works before this.
- [ ] `P5.2` `buildTools(executor, context?: AgentToolContext<Env>)` — second
      param required for env/bindings access; the SDK already passes it.
- [ ] `P5.3` GM tools: `get_campaign_snapshot` (project only needed columns —
      30 KB tool-result cap), `modify_character_hp`, `grant_character_loot`,
      `update_campaign_scene`. Remember every tool in the `ToolSet` is
      auto-exposed over `/_deepspace/agent/*` HTTP **and MCP**, not just the panel.
- [ ] `P5.4` Decide `records.delete` in `ALLOWED_TOOL_NAMES` (plan's allowlist
      omits it; current file includes it).
- [ ] `P5.5` GM system prompt: snapshot-first, two-stage resolution (set DC →
      ask for the roll → never fabricate dice), verify in `roll-logs`, narrate
      2-4 paragraphs, then mutate.
- [ ] `P5.6` Owner billing ([ADR 0004](./adr/0004-ai-chat-and-owner-billing.md)) = **delete** `authToken: jwt` from
      `makeDefaultSummarizer` and `streamDeepSpaceAgent` in
      `src/ai/chat-routes.ts` so `APP_OWNER_JWT` is used. There is no config flag.
      Locally `dev start` must mint `APP_OWNER_JWT` or the call throws.
- [ ] `P5.7` `src/components/GmConsolePanel.tsx` embedding `ChatPanel` in the
      center column + quick-prompt chips that include character name and latest
      roll.

## Phase 6 — Gates, tests, deploy

- [ ] `P6.1` Mechanical grep gates (plan §Phase 6) all green; emoji sweep clean.
- [ ] `P6.2` `collab.spec.ts` rewritten for campaigns/characters/roster/roll
      feed (current file tests `/api-status` identity — keep or replace
      deliberately). Needs **2 test accounts**: `npx deepspace test accounts
      create` — zero exist today, so the file is auto-skipped.
- [ ] `P6.3` Add `/home` H1 + preview-table assertions to `smoke.spec.ts`
      (plan requires them; nothing asserts them today).
- [ ] `P6.4` Full pass: `npm run type-check`, `npm run lint`, `npm run
      test:unit`, `npm run test:e2e`. Note `npm test` runs **only**
      smoke+api — collab needs `test run e2e`.
- [ ] `P6.5` Type-check the tests: `tsconfig.json` `include` is
      `["src", "worker.ts"]`, so `tests/**` is unchecked by `tsc`. Either widen
      include or accept runtime-only checking — document the choice.
- [ ] `P6.6` Deploy (`npx deepspace deploy`) from a clean worktree, then live
      smoke on the deployed URL: two sessions, two characters, a roll, an AI GM
      resolution with an HP/loot mutation, zero console/WS errors.

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
- `lintSchema` checks only 4 rules and is warn-only; our own test is the gate.

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
requires no token and has no role gate; anon clients get `anon-<uuid>` ids.

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
and closes contexts automatically. No test accounts exist; Chromium is not
cached. Vitest is node-only (no jsdom) and includes `src/**/*.{test,spec}.ts`.

## Open decisions

- [ ] `D1` — **Resolved:** schemas first → [ADR 0001](./adr/0001-schemas-before-ui.md).
      `P2a` precedes Phase 1's data wiring.
- [ ] `D2` Register the messaging drop-in schemas
      (`CHANNELS`/`MESSAGES`/`REACTIONS`/`CHANNEL_MEMBERS`/`READ_RECEIPTS`)
      when nothing reads them, or drop them from the registration list?
- [ ] `D3` When does `ensureDefaultCampaign` run — client action on `/home`
      mount, worker-side on first record read, or a job?
- [ ] `D4` Presence room auth → [ADR 0006](./adr/0006-presence-room-authorization.md)
      (Proposed): accept anonymous peers and filter `anon-` ids client-side, or
      gate `/ws/presence/*` behind membership?
- [ ] `D5` Trust model for rolls → [ADR 0005](./adr/0005-dice-roll-authority.md)
      (Proposed): client-computed `Math.random()` as the plan designs, or a
      server action so `roll-logs` is authoritative for the AI GM?
- [ ] `D6` `records.delete` in the AI allowlist: keep or drop? (write an ADR if
      the answer is not obvious from Phase 5's prompt design)
