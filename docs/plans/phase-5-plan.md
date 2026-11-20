# Phase 5 — AI Game Master

- **Status:** Done
- **Session:** 2026-11-19, orchestrator session (scouts: `sdk-ai-chat`, `gm-surfaces`)
- **Governing tasks:** `P5.1`–`P5.12` in [`../tasks.md`](../tasks.md)
- **ADRs in force:** [0004](../adr/0004-ai-chat-and-owner-billing.md) (install + owner billing),
  [0009](../adr/0009-engine-owns-outcomes.md) (engine owns outcomes), [0012](../adr/0012-gm-turn-policy.md)
  (latest message wins, one auto turn per roll), [0014](../adr/0014-public-read-table.md),
  [0015](../adr/0015-server-authored-character-state.md), [0017](../adr/0017-gm-owner-credential.md)
  (GM writes need the owner credential), [0020](../adr/0020-no-player-hp-path.md),
  [0021](../adr/0021-roll-banner-reads-roll-logs.md); new:
  [0022](../adr/0022-gm-tools-confined-to-chat-turn.md) (this phase)
- **Depends on:** Phase 4 outcome — server-authored `roll-logs`, gated campaign presence, live feed
  and roll banner in every window
- **Unblocks:** Phase 6 may assume a streamed GM that reads the table and writes HP/loot/scene
  through owner-authorized tools, every mutation leaving a `roll-logs` row

## Goal

The GM console stops being a picture. A signed-in player types (or clicks a chip) into the center
column and a streamed, owner-billed Game Master answers: it snapshots the campaign, sets a DC,
asks for the roll, verifies the roll in `roll-logs`, narrates, and mutates HP / loot / scene through
owner-authorized tools. A resolved roll fires exactly one automatic GM turn. Signed out, the panel
keeps its static preview.

## Definition of done

- [ ] `npm run validate` (tsc + 8+ unit files) and `npm run lint` pass
- [ ] `npx deepspace add ai-chat` output is committed: `ChatPanel*`, `schemas/ai-chat-schema.ts`,
      `pages/(app)/(protected)/assistant.tsx`, five deps; `AI_CHATS_SCHEMA` registered so
      `worker.ts:144` computes `inApp: true`
- [ ] `src/ai/tools.ts` no longer contains `records.delete`; a unit test asserts the allowlist
- [ ] `buildTools(executor, context)` builds four GM tools; write tools refuse outside `/api/ai/chat`
- [ ] `POST /api/actions/applyGmMutation` still refuses a non-owner caller (`not_gm`), and a GM
      mutation writes one `roll-logs` row (`combat` for HP, `gm_event` for loot/scene)
- [ ] `chat-routes.ts` passes no `authToken` to `makeDefaultSummarizer` or `streamDeepSpaceAgent`
- [ ] `/home` signed in: GM panel streams a reply; chips send; one roll → one automatic GM turn
- [ ] `/home` signed out: GM panel shows `PREVIEW_GM_MESSAGES`, no input, no network
- [ ] Roster shows a typing marker while a peer composes a GM message

## Scope

**In scope**

- `src/ai/tools.ts` — allowlist, system prompt, `buildTools` + four GM tools
- `src/ai/chat-routes.ts` — owner billing (no `authToken`)
- `src/components/ChatPanel.tsx`, `ChatPanel.messages.tsx`, `ChatPanel.stream.ts` — installed by the
  feature; `ChatPanel` gains two additive props (`queuedPrompt`, `onDraftChange`)
- `src/schemas/ai-chat-schema.ts`, `src/schemas.ts` — two SDK-owned collections registered
- `src/pages/(app)/(protected)/assistant.tsx` — installed, left unlinked/unstyled (`P5.8`)
- `src/components/GmConsolePanel.tsx` — embeds `ChatPanel`; chips; auto-resolve; signed-out preview
- `src/lib/gm-prompts.ts` (new) — pure prompt builders + one-turn-per-roll dedupe
- `src/lib/gm-tools.ts` (new) — pure zod schemas + `toGmMutation` mapping + chat-turn gate helper
- `src/actions/index.ts` — `applyGmMutation` writes its `roll-logs` evidence row
- `src/server/action-routes.ts` — export `createActionTools` so the tool layer can build an
  owner-scoped `ActionContext`
- `src/components/PartyPresenceBar.tsx`, `src/lib/party-presence.ts` — `isTypingAction`
- `src/pages/(app)/home.tsx` — passes user/character/rolls to the GM panel, owns the draft flag
- Tests: `src/ai/__tests__/tools.test.ts`, `src/lib/__tests__/gm-prompts.test.ts`,
  `src/lib/__tests__/party-presence.test.ts` (extend), `src/actions/__tests__/actions.test.ts` (extend)

**Out of scope (explicit non-goals)**

- Chat-history UI, conversation rail, chat rename/delete UI (`/assistant` stays unlinked — ADR 0008
  cut list, `P5.8`)
- Multiple campaigns / a GM seat / turn order (ADR 0011, 0012)
- New e2e specs and the `collab` rewrite — Phase 6 (`P6.2`, `P6.3`); this phase proves itself with
  unit tests plus a manual dev-server run
- Deploy — Phase 6 (`P6.6`). This phase does not run `npx deepspace deploy`
- Messaging schemas, conditions/initiative/XP/spells (D2, ADR 0010)

## Entry state (verified)

| Thing | State | Where |
| --- | --- | --- |
| `ai-chat` feature | **not installed** — no `ChatPanel*`, no `assistant.tsx`, no `ai-chat-schema.ts`, five deps absent | `package.json`, `src/components/` |
| `/api/ai/chat*` | **not registered** — `worker.ts:144` computes `inApp` from `AI_CHATS_SCHEMA` membership in `schemas`, which has six collections | `worker.ts:142-145`, `src/schemas.ts:23-30` |
| `src/ai/chat-routes.ts` | present (scaffold copy); passes `authToken: jwt` to both `makeDefaultSummarizer` (`:222`) and `streamDeepSpaceAgent` (`:345`) | `src/ai/chat-routes.ts` |
| `src/ai/tools.ts` | `ALLOWED_TOOL_NAMES` still lists `records.delete` (`:25`); `buildTools(executor)` ignores the context arg; generic non-GM prompt | `src/ai/tools.ts:18-27,80,54` |
| `GmConsolePanel` | static: `messages: GmMessage[]` prop, disabled native input, no socket | `src/components/GmConsolePanel.tsx:17-74` |
| GM fixture | `PREVIEW_GM_MESSAGES` (3 messages) passed even signed in | `src/lib/preview-data.ts:260-285`, `home.tsx:327` |
| Presence payload | `{ characterId, characterName, archetype }`; no `isTypingAction` anywhere | `src/components/PartyPresenceBar.tsx:48`, `src/lib/party-presence.ts:51-54` |
| `applyGmMutation` | owner-gated (`not_gm`), clamps HP, writes **no** `roll-logs` row, no client caller | `src/actions/index.ts:226-341` |
| `roll-logs` | exists; `entryType` select `roll/action/gm_event/combat`; `summary` required; members read-only; feed already labels `gm_event` "Game Master" and `combat` "Combat" | `src/schemas/roll-logs-schema.ts`, `src/components/vtt/ActionFeed.tsx:35-39` |
| Installed SDK | `deepspace` 0.44.2, `ai` 7.0.107; `AgentToolContext<Env> = { env, userId, request }`; `createUserToolExecutor(env, userId, signal, {room?})`; 30 KB result cap, 20 tool calls/turn | `node_modules/deepspace/dist/worker.d.ts:2835-2895` |
| Action tools | created in `action-routes.ts` with `X-App-Action: 'true'` (per-record RBAC off, identity = the id passed), `createActionTools(env, userId, callerJwt)` is module-private | `src/server/action-routes.ts:66,88-160` |
| Tests | vitest node-only, 9 files / 133 tests; nothing imports `src/ai/tools.ts` | `src/**/__tests__` |
| Source control | GitHub source claimed (per `tasks.md`); commits only this phase | `git log` |

## Contracts

**Data — two SDK-owned collections, registered in this phase** (`AI_CHATS_SCHEMA`, `AI_MESSAGES_SCHEMA`)

- `ai-chats`: `userId` (text, userBound, immutable, required), `title`, `model`, `compactedSummary`,
  `compactedThroughId`; `ownerField: 'userId'`; `member` read/update/delete `'own'`, **create
  `false`**; `viewer` read `'own'`.
- `ai-messages`: `chatId` (immutable, required), `userId` (userBound, immutable, required), `role`
  (required), `content` (text), `parts` (json); same permission matrix.
- Both are written only by the worker's chat routes (`chat-routes.ts`), never by the browser.

**Routes**

- `POST /api/ai/chats` `{ title? }` → `{ chat }`; `PATCH /api/ai/chats/:id` `{ title? }`;
  `DELETE /api/ai/chats/:id`; all bearer + app membership (`agent.ts` `createAccessResolver`),
  401/403/503 mapped by `chat-routes.ts:74-88`.
- `POST /api/ai/chat` `{ chatId, userMessageId, content, modelId? }` → UI message stream,
  `X-Asst-Id` response header. Billed to `APP_OWNER_JWT` (no `authToken`), tools run as the caller
  except the GM tools below.

**AI tools** (`src/ai/tools.ts`, exposed to the model; every name is also an MCP tool name)

- Unchanged record tools minus `records.delete`: `schema.list`, `schema.describe`, `records.query`,
  `records.get`, `records.create`, `records.update`, `user.current`.
- `get_campaign_snapshot` → `{ campaign, characters, recentRolls }`, projected columns only
  (`characters`: recordId, name, archetype, hp, maxHp, ac, six stats; `recentRolls`: 10 newest with
  entryType, characterName, statName, dice fields, outcome, summary) — stays far under 30 KB.
- `modify_character_hp { characterId, delta, reason? }` → clamped via `applyGmMutation`, writes one
  `combat` row.
- `grant_character_loot { characterId, itemName, category?, description?, quantity? }` → one
  `inventory` row + one `gm_event` row.
- `update_campaign_scene { locationName?, atmosphereTag?, sceneSummary?, activeThreatDc?, enemyName?,
  enemyHp?, enemyMaxHp? }` → one `campaigns` update + one `gm_event` row.
- **Gate (ADR 0022):** the three write tools run only when `new URL(context.request.url).pathname ===
  '/api/ai/chat'`; otherwise they return `{ success:false, code:'gm_tools_chat_only' }` without
  touching a record. `get_campaign_snapshot` is read-only and stays available on every surface.
- **Authority:** write tools build an owner-scoped `ActionContext`
  (`userId: env.OWNER_USER_ID`, `tools: createActionTools(env, env.OWNER_USER_ID,
  env.APP_OWNER_JWT)`) and call the existing `applyGmMutation`, so clamping, target checks and the
  `not_gm` rule keep one implementation (ADR 0017, 0009).

**Components**

- `ChatPanel` (`src/components/ChatPanel.tsx`): shipped props unchanged — `chatId`, `userId`,
  `onChatCreated?`, `models?`, `emptyStatePrompts?`, `className?`, `header?`, `compact?`,
  `disabled?`. Two **additive** props this phase:
  `queuedPrompt?: { id: string; content: string } | null` (send `content` once when `id` changes and
  not loading) and `onDraftChange?: (hasText: boolean) => void` (fired on textarea change). Both
  optional, no behaviour change when absent.
- `GmConsolePanel` (`src/components/GmConsolePanel.tsx`): props
  `{ signedIn: boolean; userId?: string; character?: { name: string; recordId: string } | null;
  rolls: RollLogRow[]; onDraftChange?: (hasText: boolean) => void }`. Testids: `gm-stream` (outer),
  `gm-chip` (each quick chip), `gm-live` (live panel wrapper), `gm-preview` (signed-out list).
- `PartyPresenceBar`: new optional prop `isTyping?: boolean`; broadcast and roster render.

**Pure functions**

- `src/lib/gm-prompts.ts`: `buildRollPrompt(row: RollLogRow): string` (names the roller, stat, dice,
  DC, outcome and carries a JSON payload `{rawRoll, modifier, total, targetDc, outcome}`);
  `buildQuickPrompt(kind: GmChipKind, ctx: { characterName?: string; latestRoll?: RollLogRow | null }): string`;
  `unresolvedRolls(rows, announced: Set<string>): RollLogRow[]` (newest-first, `entryType === 'roll'`
  only, excludes already-announced ids).
- `src/lib/gm-tools.ts`: `GM_WRITE_TOOL_NAMES`, `gmToolAllowedForPath(pathname: string): boolean`,
  `toGmMutation(tool, args): { kind: ... }` mapping + zod validators mirroring the action's schema.

**Constants:** `DEFAULT_CAMPAIGN_ID` unchanged (`src/constants.ts`); GM chips are a local const in
`gm-prompts.ts` (`GM_CHIPS`).

## Steps

### Step 1 — Install the feature, keep `/assistant` unlinked (`P5.1`, `P5.8`)

- Files: `src/components/ChatPanel.tsx`, `ChatPanel.messages.tsx`, `ChatPanel.stream.ts`,
  `src/pages/(app)/(protected)/assistant.tsx`, `src/schemas/ai-chat-schema.ts`, `src/schemas.ts`,
  `src/nav.ts`, `package.json`, `package-lock.json`
- Change: `npx deepspace add ai-chat`; `npm install` for `react-markdown`, `remark-gfm`,
  `remark-breaks`, `rehype-highlight`, `highlight.js`; confirm `...aiChatSchemas` spread; delete the
  auto-added `{ path: '/assistant', label: 'AI Chat' }` nav row (P5.8: unlinked, not deleted).
- Watch out: installer skips existing files and only patches `schemas.ts` when the import is absent;
  the protected page's import path is rewritten to `../../../components/ChatPanel` — verify.
  `worker.ts:144` must now compute `inApp: true`.
- Proof: `npm run type-check`; `grep -c "aiChatSchemas" src/schemas.ts` = 2; `grep -c assistant src/nav.ts` = 0;
  `grep -n "inApp" worker.ts` shows the schema-derived flag; `/assistant` route file exists.

### Step 2 — Drop `records.delete` from the AI allowlist (`P5.4`)

- Files: `src/ai/tools.ts`, `src/ai/__tests__/tools.test.ts` (new)
- Change: remove `'records.delete'` from `ALLOWED_TOOL_NAMES`; no change to
  `src/server/action-routes.ts:143` (actions keep `remove`).
- Watch out: the task was ticked once without shipping; this step is not done until the test fails
  on the old list.
- Proof: `npx vitest run src/ai` before/after — the new test asserts the allowlist names and that
  `buildTools` produces no `records_delete`.

### Step 3 — GM mutations leave feed evidence (`P5.10`)

- Files: `src/actions/index.ts`, `src/actions/__tests__/actions.test.ts`
- Change: after a successful write, `applyGmMutation` creates one `roll-logs` row:
  `entryType: 'combat'` for `character_hp` (summary `Kaelen takes 6 damage (18/24) — <reason>` with
  `outcome: 'info'`), `'gm_event'` for `grant_loot` (`Kaelen receives Sunfire Vial x1`) and for
  `update_scene` (`The scene shifts to <locationName>`), keyed by `characterName` (target's name, or
  `'Game Master'` when unnamed). Log after the mutation; a failed log write returns the successful
  mutation with `details.applied` naming the write and the log failure — never implies atomicity.
- Watch out: `roll-logs` requires `campaignId`, `characterName`, `entryType`, `summary`; the log must
  never change HP clamping or the `not_gm` refusal order.
- Proof: extended `applyGmMutation` tests — one log row per kind, no log on refusal, and the
  existing 13 tests still green.

### Step 4 — `buildTools(executor, context)` + four GM tools (`P5.2`, `P5.3`, `P5.11`)

- Files: `src/ai/tools.ts`, `src/lib/gm-tools.ts`, `src/server/action-routes.ts`,
  `src/ai/__tests__/tools.test.ts`, `docs/adr/0022-gm-tools-confined-to-chat-turn.md` (new)
- Change: second parameter required (`AgentToolContext<ToolsEnv>` with a structural
  `ToolsEnv = { OWNER_USER_ID, APP_OWNER_JWT, RECORD_ROOMS, DEEPSPACE_APP_ID, APP_NAME }`); export
  `createActionTools` from `action-routes.ts`; add the four tools with zod v4 `inputSchema`; write
  tools gated on the chat path and executed through the owner-scoped `applyGmMutation` context;
  snapshot tool queries `campaigns`/`characters`/`inventory`/`roll-logs` through the passed executor
  with a column projection.
- Watch out: the executor runs as the **caller** (per-record RBAC on) — the snapshot is therefore
  scoped by `viewer/member` read (all rows are readable, ADR 0014), while writes need the owner path.
  Tool results over 30 KB come back as a failure object, so project columns. Never throw across the
  tool boundary: return `{ success:false, code }`.
- Proof: `src/ai/__tests__/tools.test.ts` — four tools present, write tools refuse on
  `/_deepspace/agent/tools`, allow on `/api/ai/chat`, snapshot projection under 30 KB for a 4×
  character table, `toGmMutation` mapping rejected for bad input.

### Step 5 — GM system prompt (`P5.5`)

- Files: `src/ai/tools.ts`, `src/ai/__tests__/tools.test.ts`
- Change: `buildSystemPrompt(appName, schemas)` becomes the LoreSpace GM brief: snapshot first;
  two-stage resolution (set the DC through `update_campaign_scene`, ask for the named check, never
  fabricate dice); verify the reported roll in `roll-logs`; narrate 2–4 short paragraphs; tool
  first, prose second; answer the latest human message — no turn order, no addressing syntax
  (ADR 0012); never state an outcome without a `roll-logs` row or a record write (ADR 0009);
  inventory items with explicit uses (ADR 0016); `markdown` formatting.
- Watch out: the prompt is product behaviour rendered to players — keep it in `tools.ts`, tested by
  substring assertions, not a separate fixture.
- Proof: test asserts the prompt contains snapshot-first, "roll-logs", "never fabricate", the chip
  vocabulary, and no generic "DeepSpace assistant" framing.

### Step 6 — Owner billing (`P5.6`)

- Files: `src/ai/chat-routes.ts`
- Change: delete `authToken: jwt` from `makeDefaultSummarizer(c.env, …)` and
  `streamDeepSpaceAgent(c.env, { … })`; drop the now-unused `jwt` local only if nothing else reads it
  (the route still requires a bearer token for identity).
- Watch out: without `APP_OWNER_JWT` the call throws; `dev start` mints it. Compaction is billed to
  the owner with it.
- Proof: `grep -n "authToken" src/ai/chat-routes.ts` = 0; a local streamed turn answers (manual).

### Step 7 — The GM console (`P5.7`)

- Files: `src/components/ChatPanel.tsx` (two additive props), `src/components/GmConsolePanel.tsx`,
  `src/lib/gm-prompts.ts`, `src/pages/(app)/home.tsx`,
  `src/lib/__tests__/gm-prompts.test.ts`
- Change: signed in, render `ChatPanel` with `chatId={null}`, `userId`, `compact`, header badge, and
  `emptyStatePrompts` from `GM_CHIPS`; `gm-chip` buttons send a prompt built with the viewer's
  character name and latest roll; `onDraftChange` forwards input presence. Auto-resolve: baseline on
  the first non-empty `rolls` snapshot, then for each new `entryType: 'roll'` row send exactly one
  `queuedPrompt` (`buildRollPrompt`), one per row id, never for a row by the same character twice.
  Signed out: render `PREVIEW_GM_MESSAGES` in the same frame, no panel, no socket, no network.
- Watch out: ChatPanel owns its input; the additive props are the only hook — never fork the panel.
  Two windows signed in as two players each own a chat (`ai-messages` are `read: 'own'`), so each
  panel gets one turn per roll; dedupe by roll `recordId` per mount.
- Proof: `src/lib/__tests__/gm-prompts.test.ts` (payload shape, chips carry name + roll, dedupe);
  manual dev run — signed in, one chip → streamed reply; a roll → exactly one extra turn.

### Step 8 — Typing presence (`P5.9`)

- Files: `src/lib/party-presence.ts`, `src/components/PartyPresenceBar.tsx`,
  `src/components/vtt/PartyRoster.tsx`, `src/pages/(app)/home.tsx`,
  `src/lib/__tests__/party-presence.test.ts`
- Change: broadcast `isTypingAction: boolean` in the same `updateState` payload; parse it with a
  `peerIsTyping(state)` guard; `PartyMember.isTyping`; roster renders a `typing` marker for peers
  (never for self). `/home` owns a `gmComposing` boolean fed by `GmConsolePanel`'s `onDraftChange`.
- Watch out: presence merges payloads, so always send the whole payload (identity + flag) and reset
  the flag on unmount/blur; never add roll data back into presence (ADR 0021).
- Proof: extended `party-presence` tests (flag true/false, missing flag false, never HP/rolls) and a
  two-window check that the marker appears and clears.

### Step 9 — Documentation and commit (`P5.*` ticks)

- Files: `docs/tasks.md`, `docs/plans/phase-5-plan.md`, `docs/adr/README.md`, `docs/plans/README.md`
- Change: tick `P5.1`–`P5.12` with dates; ADR 0022 accepted and indexed; Outcome filled with the
  feature inventory verbatim; phase board row 5 = done, row 6 = ready.
- Proof: `git status` clean after `git commit -m "phase 5: …"`.

## Verification

```sh
npm run type-check
npm run lint
npm run test:unit
npx vitest run src/ai src/lib/__tests__/gm-prompts.test.ts
npx deepspace dev start          # background, then manual beats below
```

Manual, dev server, signed in as `Alice` (and a second window as `Bob`):

1. `/home` → GM panel is live (no fixture), input enabled, header badge `MODEL`.
2. Click `Inspect the room` → streamed reply, tool call visible in the worker log, no console errors.
3. Click `Resolve my latest roll` after a stat-card roll → the GM cites the `roll-logs` numbers.
4. Roll a stat card → within one turn the GM narrates damage; a `combat` row appears in the feed and
   the sheet's HP bar drops; exactly one GM turn per roll (not two).
5. Ask for loot → an `inventory` row appears in the pack and one `gm_event` row in the feed.
6. Bob's window shows `Bob is typing` (or the roster marker) while Alice composes.
7. Signed out → `/home` GM panel shows the three preview messages, input absent/disabled, no
   `/api/ai/*` request in the network panel.

Gates that must be green this phase:

- `grep -n "records.delete" src/ai/tools.ts` → no match
- `grep -c "authToken" src/ai/chat-routes.ts` → 0
- `curl -s -o /dev/null -w '%{http_code}' -X POST $DEV/api/ai/chat` with no bearer → 401 (route exists)
- `AGENT tools` (`npx deepspace agent tools <app> --json`) lists the four GM tools — read the schema,
  do not guess args

## Risks

| Risk | Trigger | Mitigation |
| --- | --- | --- |
| Local AI turns fail | no `APP_OWNER_JWT` in `dev start`, exhausted owner credits, provider outage | `dev start` mints it; if credits are exhausted, ship the code with unit-test proof and report the manual beat as unverified |
| Member can call a GM write tool out-of-conversation over MCP | every `buildTools` tool is auto-exposed | ADR 0022 gate on `/api/ai/chat` + test; flagged in § Worth your eyes |
| `ChatPanel` additive props drift from SDK upgrades | feature files are copies, not vendored | keep both props optional and documented; a re-install regenerates and the props are re-applied by hand |
| Two windows double-fire auto-resolve | each window watches the same `roll-logs` | dedupe by roll `recordId` per mount, one turn per id; cap stated in ADR 0012 |
| Tool result over 30 KB | unbounded `characters`/`roll-logs` read in the snapshot | column projection + `recentRolls` limited to 10; test asserts size |
| A GM mutation lands without a feed row | log write fails after the mutation | return the mutation with `details.logged: false`; the next turn's snapshot still shows the true HP |
| Install pulls five client deps into the bundle | `ai-chat` install | accepted in ADR 0004; note bundle growth in the Outcome |

## Open questions

- [x] Do GM writes need a second implementation, or reuse `applyGmMutation`? → reuse with an
      owner-scoped `ActionContext`; `P5.11`/ADR 0022 fixes the exposure boundary.
- [x] Is `isTypingAction` (P5.9) compatible with ADR 0021's identity-only payload? → yes: a boolean
      keystroke flag is presence, not a roll claim; presence still never carries dice.
- [x] Should `/assistant` appear in nav? → no; `P5.8` keeps it unlinked.

## Outcome

Filled in at the end of the phase, never rewritten afterwards.

- **Shipped:** the `ai-chat` feature installed and owner-billed, so `/api/ai/chat`
  exists; a GM console that streams real turns over a snapshot tool; four GM
  tools (one read, three writes) that run as the owner through
  `applyGmMutation` and refuse outside the in-app chat turn (ADR 0022); a GM
  brief that enforces two-stage resolution and roll verification; one automatic
  GM turn per resolved roll; a `roll-logs` evidence row for every GM mutation; a
  typing flag on presence. Proven live: chip → `get_campaign_snapshot` →
  streamed prose with a DC; roll → exactly one automatic turn carrying the
  payload, GM fetching the `roll-logs` row by id; direct loot instruction →
  `grant_character_loot` → feed row `GAME MASTER | Ash | Ash receives Sunfire Vial x1`.
- **Slipped:** `P5.13` — the console's default model is the catalog's first entry,
  `claude-opus-5-5`, which answers 402 on a free-plan balance. The panel works by
  picking Haiku 5.5 (or a GPT model); the default is a product/cost call, left
  open rather than guessed.
- **Deviations:** ADR 0022 is **new** (write tools confined to `/api/ai/chat`);
  it complements 0017 rather than superseding it. Implementation deviations, all
  in the task ticks: `buildTools`' second param is **required**, not optional
  (`P5.2` wording kept, ticked with the note); the chip bar renders inside the
  panel's pinned footer rather than between the message list and the composer,
  because `ChatPanel` owns its composer and the only additive hook is
  `queuedPrompt`; the `ChatPanel` copy gained exactly two optional props
  (`queuedPrompt`, `onDraftChange`); a burst of rolls collapses to one automatic
  turn (the ADR 0012 cap, applied per mount); `get_campaign_snapshot` returns
  `campaign: null` on an empty table; a refused tool call returns
  `{ success:false, code }` instead of throwing.
- **Inherited by the next phase:** `/api/ai/chat` streams under the owner
  credential and every GM write leaves a `roll-logs` row, so Phase 6's live smoke
  can assert a feed row per mutation; the presence payload is now
  `{ characterId, characterName, archetype, isTypingAction }`; `/assistant`
  exists, unlinked; `ChatPanel` is an SDK copy with two local props that a
  re-install would drop; the free-plan 402 on Opus 5.5 is the one thing that can
  break a live demo turn (`P5.13`).

### Feature inventory (the close-out's sections 1-5)

**1. Shipped, by feature**

| Feature | State | Files | Evidence |
| --- | --- | --- | --- |
| `ai-chat` surface installed — panel, message/stream hooks, chat page, both collections registered | route | `src/components/ChatPanel.tsx`, `src/components/ChatPanel.messages.tsx`, `src/components/ChatPanel.stream.ts`, `src/schemas/ai-chat-schema.ts`, `src/schemas.ts`, `src/pages/(app)/(protected)/assistant.tsx` | `POST /api/ai/chats` → 200 and `POST /api/ai/chat` → 200 in the live probe; `worker.ts:144` derives `inApp` from `AI_CHATS_SCHEMA`; schema test pins eight collections |
| Owner billing for every GM turn — no caller JWT on either AI call | auth | `src/ai/chat-routes.ts` | `grep -c authToken src/ai/chat-routes.ts` = 0; live probe answered a streamed turn with no user billing |
| Four GM tools — snapshot (read) plus HP / loot / scene (writes) | action | `src/ai/tools.ts`, `src/lib/gm-tools.ts`, `src/server/action-routes.ts` | `src/ai/__tests__/tools.test.ts` (15 tests: projection under 30 KB, owner-scoped write with `X-User-Id=OWNER_USER_ID`, `gm_tools_chat_only` on `/_deepspace/agent/tools`); live probe executed `get_campaign_snapshot` and `grant_character_loot` |
| GM write tools confined to the in-app chat turn | auth + unit test | `src/lib/gm-tools.ts`, `src/ai/tools.ts` | `gmToolAllowedForPath` tests (write allowed on `/api/ai/chat` only); ADR 0022 |
| GM brief — snapshot-first, two-stage resolution, verify in `roll-logs`, tool first then prose, latest-message turn policy | unit test | `src/ai/tools.ts` (`buildSystemPrompt`) | prompt tests in `src/ai/__tests__/tools.test.ts`; live probe's GM set a DC, asked for a WIS check, then refused to resolve a DEX roll against it |
| Feed evidence for GM mutations — one `roll-logs` row per write | action + unit test | `src/actions/index.ts` | `src/actions/__tests__/actions.test.ts` › "logs one combat row with the clamped HP change and the reason", "logs one gm_event row when loot is granted", "logs one gm_event row from the Game Master when the scene shifts", "writes no roll-logs row when it refuses"; live feed row `GAME MASTER | Ash | Ash receives Sunfire Vial x1` |
| GM console — embedded `ChatPanel`, four quick chips naming the character and latest roll, signed-out preview | e2e | `src/components/GmConsolePanel.tsx`, `src/lib/gm-prompts.ts`, `src/pages/(app)/home.tsx` | temporary Playwright probe (four runs, recorded above); `gm-prompts.test.ts` (14 tests) for chip/prompt content; layout fix: chips were click-blocked by the panel composer until `ChatPanel` got a sized wrapper |
| One automatic GM turn per resolved roll | e2e + unit test | `src/components/GmConsolePanel.tsx`, `src/lib/gm-prompts.ts` | `buildRollPrompt` carries `{rawRoll, modifier, total, targetDc, outcome}`; `unresolvedRolls` excludes announced ids and non-roll rows; live probe: one DEX roll → exactly one turn, GM quoting the row id |
| Typing presence — `isTypingAction` broadcast and rendered | action + unit test | `src/lib/party-presence.ts`, `src/components/PartyPresenceBar.tsx`, `src/components/vtt/PartyRoster.tsx`, `src/pages/(app)/home.tsx` | `peerIsTyping` + `buildParty` tests (flag carried, self never typing, presence still supplies no HP/rolls); roster `roster-typing` marker |
| `records.delete` removed from the AI allowlist | unit test | `src/ai/tools.ts` | "never exposes a delete tool" fails on the old list |

**2. Not real yet**

| What you see | Actually | Becomes real in |
| --- | --- | --- |
| Signed-out GM stream (3 messages) | `PREVIEW_GM_MESSAGES` in `src/lib/preview-data.ts`, rendered by `GmConsolePanel`'s preview branch | never — the signed-out table is ADR 0014's sample; a signed-in player always gets the live panel |
| Signed-out GM input + send button | native `<input disabled>` + disabled button that say what they are | never — same reason |
| `/assistant` page | installed SDK chat page, reachable by URL, unlinked and unstyled | not planned — chat-history UI is cut (ADR 0008, `P5.8`) |
| Model picker default | `ChatPanel`'s catalog-first `claude-opus-5-5`, which 402s on a free plan; a working model must be picked | `P5.13` — a default/pin decision, then Phase 6's live demo |
| Two "Ash" characters in the campaign | leftover test-account characters from phase 3/4 runs, not fixtures | not a feature gap — the GM handles it by asking which sheet; delete them in Settings |

**3. Persistence check**

Yes — four collections, all written from the Worker, never the browser for the
GM path: `ai-chats` + `ai-messages` by `src/ai/chat-routes.ts` (one chat per
panel, user-scoped `read: 'own'`); `roll-logs` by `applyGmMutation` (one
`combat`/`gm_event` row per GM write) and by `rollSkillCheck`; `inventory` and
`campaigns` by `applyGmMutation`'s loot and scene kinds; `characters.hp` by its
`character_hp` kind. The browser writes nothing in this phase.

**4. Pending, by phase**

- **Phase 6** — live deploy (`P6.6`) turns the locally proven GM into a live URL;
  its smoke additions (`P6.3`) and `collab` rewrite (`P6.2`) can assert the GM
  panel and a mutation row; README front door (`P6.7`) needs screenshots of the
  console.
- **`P5.13`** — the model default, before the demo, not a phase.

**5. Worth your eyes**

| Tier | Item | Why a human | What to check | Files |
| --- | --- | --- | --- | --- |
| blocks | The GM writes as the **owner**, not the caller | ADR 0017 closed the player HP path; these tools reopen a write path for the GM and rely on a path check for confinement | Confirm the in-app chat is the only acceptable door for an HP/loot/scene write (ADR 0022), or require per-character consent | `src/ai/tools.ts:301-327`, `src/lib/gm-tools.ts:99-103` |
| blocks | **Every** tool in the set is also an MCP tool | `get_campaign_snapshot` is readable by any member over `/_deepspace/agent/*`; write tools are refused there | Confirm read-only surface exposure is acceptable, and that a refused write returns a narratable `gm_tools_chat_only` rather than a 500 | `src/ai/tools.ts:340-372` |
| blocks | Default model is `claude-opus-5-5`, which **402s** on the free plan | A demo's first turn fails with "Payment Required" unless the reviewer picks a model; the working choice is taste + cost (Haiku is cheapest/fastest) | Decide the default: leave the catalog picker, reorder so Haiku is first, or pin a model for the console | `src/components/GmConsolePanel.tsx`, `ChatPanel.tsx` (`DEFAULT_MODELS`) |
| blocks | Auto-resolve runs **once per roll per window** | Each player owns a chat (`ai-messages` `read: 'own'`), so two players at the table both send a GM turn for one roll — 2× owner cost per roll, and two different narrations of one dice result | Confirm that is the intended table feel (ADR 0012 says one turn per roll), or decide the GM chat is shared/per-table | `src/components/GmConsolePanel.tsx` (`announced`/`baselined`), ADR 0012 |
| blocks | The GM's system prompt is product behaviour | A passing test only proves phrases exist; the voice, rules depth and refusal behaviour are the product | Read the brief once and say if the GM's stance ("ask which Ash", "I won't resolve a DEX roll against a WIS DC") is the GM you want | `src/ai/tools.ts` `buildSystemPrompt` |
| taste | Chips sit under the composer, not above it | `ChatPanel` owns its composer; the alternative was forking the panel | One look at the console: does the chip row read as part of the composer? | `src/components/GmConsolePanel.tsx` |
| taste | GM prose renders in ChatPanel's own markdown/rounded style | The rest of the table is square pixel chrome (`--radius: 0`) | Say if the console should be chrome-styled (squared, Silkscreen labels) before Phase 6 screenshots | `src/components/ChatPanel.messages.tsx` |
| taste | Error copy is raw provider text ("Payment Required") | It is honest but reads as a stack trace | Say if a failed turn should say "The Game Master is unavailable" instead | `src/components/ChatPanel.tsx:282` |

### Revision — 2026-11-19 (after the phase closed)

Requested after using the console; recorded rather than folded into the Outcome
above, which stays as it shipped.

- **Console chrome (`P5.14`, `P5.13`).** `ChatPanel*` + `GmConsolePanel` restyled
  to ADR 0013: zero radius, Silkscreen role/model/tool labels, amber left rule on
  GM prose, one-bar square composer ("Speak to the Game Master"), a GM empty
  state instead of the generic assistant copy (the four prompts no longer print
  twice). `ChatPanel` gained three additive props (`emptyState`, `placeholder`,
  `roleLabels`). The console's model list is reordered so `claude-haiku-5-5` is
  first — a reorder, not an allowlist, after measuring the free plan: 487/500
  credits after ~85 turns; Opus 5.5 is the only plan-refused model.
- **Layout (`P5.14`).** The minimised feed is content-sized, capped at
  `calc(100% - 15.75rem)`, with a 15rem console floor; measured at 1440x900 and
  1024x768, four rows + composer + four chips fit. The stale "three, not five"
  comment is gone.
- **Duplicate names (`P5.15`).** Two test accounts had both forged "Ash"; one
  stale row was deleted from the dev table and Forge now refuses a name another
  adventurer at the table already uses (`name_taken`, case-insensitive).
- **Campaign flow (`P5.16`, `P5.17`) — ADR 0023/0025/0026.** Five scenes across
  three acts in `src/lib/campaign-arc.ts`; additive `campaigns.sceneIndex`;
  `startCampaign` is a **new game** (scene 0, HP to max, packs back to archetype
  starter kits, roll log drained except its own marker row, `not_at_table` for a
  caller with no character); the banner carries `Act I · Scene 1 of 5`, the enemy
  name + HP, and `Start campaign` / `Start New Campaign` behind a confirm modal;
  `update_campaign_scene` may only advance one scene and only when the engine
  agrees the scene is over (`invalid_scene` / `scene_not_complete`); the reset's
  click sends one opening beat, so the GM opens the story.
- **Narrative combat (`P5.18`) — ADR 0024.** No attack action or button: a
  player narrates, the GM sets the DC and asks for the check, and applies one
  engine-clamped consequence — `damage_enemy` (new, clamped to `0..enemyMaxHp`,
  one `combat` row, chat-turn gated) on a hit, `modify_character_hp` on a miss.
- **Two prompt defects found by the live probe, fixed.** The auto-resolve message
  did not say to apply the consequence, and the GM attributed a roll to whoever
  last wrote `sceneSummary`; both are now explicit in `buildRollPrompt` and the
  GM brief (attribution, no repeat checks, `sceneSummary` is scenery not action).
  The brief was re-cut to stay under the 700-word test cap.

**Live evidence (temporary probes, deleted):** the reset wrote
`{"sceneIndex":0,"clearedRolls":2,"clearedItems":4,"healedCharacters":2,"grantedItems":4}`
and the feed held exactly `A new game begins — Act I, Scene 1`; the opening beat
narrated the threshold and asked for the first decision with no dice; a narrated
arrow at the sentinel produced `COMBAT | Runebound Sentinel | … takes 4 damage
(12/24) — … d20(16) +2 = 18 vs DC 12`, the banner read `16/24`, and the scene did
not advance while the enemy stood.

**Still open:** `P6.*` (gates, e2e, deploy); the deployed app needs a deploy
before its `campaigns` table gains `sceneIndex` (additive, automatic at room
init).

### Revision 2 — 2026-11-19/20 (shared thread, per-action DC, voice)

- **Shared thread** (ADR 0027, `P5.21`/`P5.22`): `gm-messages` collection
  (`viewer` read, member read-only, Worker writes), `POST /api/gm/chat` streams
  one turn with history from the thread, user row before the stream, assistant row
  on end/abort, owner billing, tools as the caller. The panel renders the thread
  itself in the signed-out preview style — no `ChatPanel` — with a one-line
  composer, a `MODEL` picker in the header, and both synthetic beats persisted
  under `characterName: '__beat__'` and filtered from the view. Signed-out windows
  read the same thread.
- **Gate moved** (amends ADR 0022): `GM_CHAT_PATH` is `/api/gm/chat`, so GM writes
  are refused on `/api/ai/chat` — the route `/assistant` shares — and on MCP.
  `/assistant` is now a private generic assistant, unlinked.
- **One DC per action** (ADR 0028, `P5.19`): `request_check` writes
  `pendingCharacterId`/`pendingStat`/`pendingDc`, `rollSkillCheck` uses that DC and
  refuses anything else with `roll_not_requested` before the die; cleared by the
  roll, an advance or a reset. The sheet greys every other stat, the banner shows
  the pending DC and pulses (`P5.23`/`P5.24`).
- **Voice** (`P5.20`): the brief bans mechanics talk and recaps, forbids
  enumerating options, addresses one named character per turn and sets a DC per
  action through `request_check`.
- **Fixed during integration:** the route loaded the thread after writing the
  user row and then appended the same turn again — the model saw every message
  twice. History now loads before the write.
- **Regression to fix in Phase 6:** stat cards are inert until a check is
  requested, so `presence.spec.ts`'s bare `stat-card-*` click no longer rolls
  (noted on `P6.2`).

### Revision 3 — 2026-11-20 (new game, new conversation; no ghosts)

- `startCampaign` now drains `gm-messages` too (`P5.25`): a new game starts an
  empty thread, and the opening beat writes the first narration. Live check: 19
  turns → one.
- The GM's snapshot is filtered to **the caller plus the thread's recent
  speakers** (`P5.26`), passed through a widened `GmToolContext`; the brief says
  never to name a character who is not in that list. Synthetic beats carry the
  caller's character name for presence only (stored under `__beat__`, never
  rendered), so the opening after a reset addresses the real player instead of
  falling back to every `characters` row.
- The stale test-account character ("Ash" with no items) was removed from the dev
  table; the signed-out preview roster now lists only the real character.

### Revision 5 — 2026-11-20 (roster parity, online-only table, no resent intro)

- `P5.28`: `buildParty` appends unmatched `characters` rows with `isOnline: false`,
  so both windows list the same party; the roster shows a filled dot plus an
  `offline` label, and signed out keeps the no-claim `undefined` (ADR 0006).
- The presence bar reports the online character names upward; the console sends
  them with every turn and the route filters the snapshot to caller ∪ online.
  A solo session is single-player by construction (ADR 0029, supersedes the
  thread-speaker rule of `P5.26`).
- The opening beat no longer re-sends after a remount: it is skipped when an
  assistant row newer than the click already exists. The correction beat also
  forbids re-narrating the scene, so a missed `request_check` cannot look like a
  second intro.

### Revision 7 — 2026-11-20 (multiplayer: per-character gate, rounds, roster join)

- `P5.31` (ADR 0030): the pending check moved from the campaign to `characters`
  (`pendingStat`/`pendingDc`). Two players can each owe their own roll; a
  mismatch is still refused before the die; the request is spent on success and
  failure; a scene advance clears the party, a reset clears every character with
  HP. The GM snapshot now projects each character's owed check — omitting it was
  why the GM re-armed a check that was already live.
- `P5.32` (ADR 0031): `campaigns.roundNumber` + `characters.actedRound`,
  `src/lib/round-pacing.ts` marks a real player turn before the model call and
  rolls the round over only when every online character has acted. The brief
  stages every un-acted player by name and resolves each action as it arrives;
  a new game starts at round 1. ADR 0012 is superseded.
- `P5.33`: `buildParty` resolves a peer by `characters.userId` before falling back
  to "No adventurer" — presence state can hydrate empty after a DO restart, and
  the row is the authority.
- Open and unchanged: `P5.29` (a check owed by a player who disconnects holds the
  table), an unanswered round never expires, and an offline member's sheet shows
  last-written values.
