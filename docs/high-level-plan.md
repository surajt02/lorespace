# LoreSpace — Master Architecture & Implementation Plan

LoreSpace is a real-time, multiplayer virtual tabletop RPG (VTT) and collaborative storytelling application built on the DeepSpace SDK (`deepspace@0.43.0`) and Cloudflare Workers. Players join a shared campaign room, generate and manage d20 character sheets, broadcast live dice rolls, and interact with an AI Game Master (GM) that dynamically narrates the campaign, sets Difficulty Classes (DCs) for risky actions, and deterministically mutates persistent SQLite world and character state (HP, inventory, combat encounters, and active scenes) through server-side tools. All mutations synchronize instantaneously across connected clients via Durable Object WebSockets (`RecordRoom` and `PresenceRoom`).

---

## Architectural Guardrails (Strict SDK Compliance)

1. **Three-Tier Routing Contract (`generouted`):**
   - `src/pages/index.tsx` (`/`): Static tier. Must NEVER import or call auth, record, or presence hooks (`useAuth`, `useQuery`, `useMutations`, `usePresenceRoom`).
   - `src/pages/(app)/*` (`/home`): Dynamic, signed-out-capable tier wrapped by `src/pages/(app)/_layout.tsx` (`DeepSpaceAuthProvider` -> `AuthBoot` -> `RecordProvider` -> `RecordScope`). Must render the live surface for signed-in users and a read-only preview with an inline sign-in CTA for signed-out visitors.
   - `src/pages/(app)/(protected)/*`: Gated tier wrapped in `<AuthGate>`. Only pages inside this directory may assume a signed-in user exists.
2. **Import Boundaries:**
   - Import runtime-neutral schema types and drop-in schemas (`CollectionSchema`, `CHANNELS_SCHEMA`, `MESSAGES_SCHEMA`, `AI_CHATS_SCHEMA`, `AI_MESSAGES_SCHEMA`, etc.) from `'deepspace/schema'` whenever shared with browser code.
   - Import client hooks (`useAuth`, `useUser`, `useQuery`, `useMutations`, `usePresenceRoom`, `useChannels`, `useMessages`, `ROLES`) from `'deepspace'`.
   - Import worker classes and helpers (`RecordRoom`, `PresenceRoom`, `BUILT_IN_TOOLS`, `lintSchema`, `ActionHandler`) from `'deepspace/worker'`.
   - Import UI primitives (`Button`, `Modal`, `Dialog`, `ConfirmModal`, `Select`, `Tabs`, `Badge`, `Avatar`, `EmptyState`, `Input`, `Textarea`, `Label`, `Tooltip`, `useToast`) strictly from the local `'@/components/ui'` (or relative `'../components/ui'`) kit—never from `'deepspace'` and never use native browser `<select>`, `window.confirm()`, `window.alert()`, or `window.prompt()`.
3. **Mutation & Toast Discipline:**
   - Use `useAuth().isSignedIn` for authentication state checks (never gate on `useUser().user` truthiness alone, as profile data resolves asynchronously).
   - Use awaited `*Confirmed` mutations (`createConfirmed`, `putConfirmed`, `removeConfirmed`) paired with `<Button loading={pending}>` and local `useToast()` (`success()` / `error()`) whenever performing user-initiated writes.

---

## Phase 1: Project Scaffolding, Custom Theme & Route Shell

### What Needs to Be Done

- Scaffold the DeepSpace application and initialize the AI chat feature surface.
- Replace the placeholder `slate` and `paper` themes with a custom dark VTT theme (`obsidian`) and configure the document metadata.
- Build the static landing page at `src/pages/index.tsx` following the 5-step DeepSpace Landing Workflow.
- Build the primary 3-column VTT workspace shell at `src/pages/(app)/home.tsx` supporting both signed-in play and signed-out preview mode, preserving all required navigation test IDs.

### Implementation Method

1. **Bootstrap & Feature Installation:**
   - Initialize the project and install the AI chat surface:
     ```bash
     npm create deepspace@latest lorespace
     cd lorespace
     npx deepspace add ai-chat --install
     ```
   - Verify `wrangler.toml` and `worker.ts` export `__DO_MANIFEST__` with `RECORD_ROOMS` (`AppRecordRoom`) and `PRESENCE_ROOMS` (`AppPresenceRoom`).
2. **Theme Creation (`src/themes.css`, `src/themes.ts`, `index.html`):**
   - In `src/themes.css`, create a `[data-theme="obsidian"]` block defining a high-contrast dark tabletop palette: near-black background (`#09090b`), crisp panel card surfaces (`#121216`), muted zinc borders (`#27272a`), parchment off-white foreground (`#f4f4f5`), amber/gold primary accent (`#d97706`) for dice and CTAs, crimson destructive tokens (`#dc2626`) for HP damage, and sharp technical border radii (`--radius: 0.375rem`).
   - Register `'obsidian'` in the `THEMES` array inside `src/themes.ts`.
   - In `index.html`, set `<html lang="en" data-theme="obsidian" data-ui-theme="dark">` and `<title>LoreSpace — Multiplayer AI Tabletop RPG</title>`. Ensure `data-theme="slate"` is completely removed from `index.html`.
3. **Static Landing Page (`src/pages/index.tsx`):**
   - At the very top of `src/pages/index.tsx`, write the mandatory **Design Direction** comment block (6-prompt brief: product, emotion, visual metaphor, three references, signature element, hero visual + 6-token Style Tile: color, type pair, theme, art direction, motion personality, voice).
   - Compose a split-hero layout featuring verb-first copy on the left and a live-rendered, animated React component mockup of a d20 skill check and character sheet on the right (built with inline SVGs and styled divs—never an AI-generated image). Route the primary CTA button to `/home`.
4. **3-Column VTT Workspace Shell (`src/pages/(app)/home.tsx` & `src/components/Navigation.tsx`):**
   - Make line 1 of `src/pages/(app)/home.tsx` the required Product Polish declaration:
     ```tsx
     /* home pattern: product-preview-first — live multiplayer VTT campaign table, dice log, and character sheet */
     ```
   - Keep `app-navigation`, `nav-sign-in-button`, and `nav-user-name` test IDs intact in `src/components/Navigation.tsx`, and keep `signOut()` accessible.
   - Structure `home.tsx` into a responsive 3-column desktop grid:
     - **Top Bar:** Active Campaign Scene banner (Location, Atmosphere badge, Active Threat DC badge, Enemy HP tracker if in combat) + Live Party Presence Roster.
     - **Left/Center Column:** Tabbed or split view combining the **Party Action & Dice Feed** and the **AI Game Master Stream**.
     - **Right Sidebar:** The active player's **d20 Character Sheet** (6 core attributes, derived modifiers, AC, animated HP bar) and **Inventory List**.
   - When `!useAuth().isSignedIn`, render the exact same 3-column VTT workspace populated with deterministic read-only sample campaign data and an inline sign-in banner plus `<AuthOverlay />`.

---

## Phase 2: SQLite Data Model, RBAC & Server Actions

### What Needs to Be Done

- Declare typed SQLite collection schemas for `campaigns`, `characters`, `inventory`, and `roll_logs` alongside the SDK's drop-in `users`, `ai-chats`, `ai-messages`, and public messaging schemas.
- Enforce strict collection-level RBAC and pass `lintSchema()` with zero warnings.
- Create privileged server actions in `src/actions/index.ts` for campaign initialization and multi-collection orchestration.

### Implementation Method

1. **Schema Declarations (`src/schemas/*.ts` & `src/schemas.ts`):**
   - Import `type { CollectionSchema }` from `'deepspace/schema'` in every schema file.
   - Use only `'number' | 'text'` for `storage`. Define explicit `read`, `create`, `update`, and `delete` keys on every role (`'*'`, `'viewer'`, `'member'`, `'admin'`).
   - **`src/schemas/campaigns-schema.ts` (`campaigns`):**
     - Columns:
       - `title` (`storage: 'text'`, `interpretation: 'plain'`, `required: true`)
       - `locationName` (`storage: 'text'`, `interpretation: 'plain'`, `default: 'The Ashen Threshold'`)
       - `atmosphereTag` (`storage: 'text'`, `interpretation: { kind: 'select', options: ['exploration', 'combat', 'tavern', 'dungeon', 'boss'] }`, `default: 'exploration'`)
       - `sceneSummary` (`storage: 'text'`, `interpretation: 'plain'`, `default: ''`)
       - `activeThreatDc` (`storage: 'number'`, `interpretation: 'plain'`, `default: 12`)
       - `enemyName` (`storage: 'text'`, `interpretation: 'plain'`, `default: ''`)
       - `enemyHp` (`storage: 'number'`, `interpretation: 'plain'`, `default: 0`)
       - `enemyMaxHp` (`storage: 'number'`, `interpretation: 'plain'`, `default: 0`)
     - Permissions: `'*'` (`read: true`, writes `false`), `viewer` (`read: true`, writes `false`), `member` (`read: true, create: true, update: true, delete: false`), `admin` (all `true`).
   - **`src/schemas/characters-schema.ts` (`characters`):**
     - Columns:
       - `userId` (`storage: 'text'`, `interpretation: 'plain'`, `userBound: true`, `immutable: true`, `required: true`)
       - `campaignId` (`storage: 'text'`, `interpretation: 'plain'`, `required: true`)
       - `name` (`storage: 'text'`, `interpretation: 'plain'`, `required: true`)
       - `archetype` (`storage: 'text'`, `interpretation: { kind: 'select', options: ['Vanguard', 'Shadowblade', 'Arcanist', 'Cleric'] }`, `required: true`)
       - `hp` (`storage: 'number'`, `interpretation: 'plain'`, `required: true`)
       - `maxHp` (`storage: 'number'`, `interpretation: 'plain'`, `required: true`)
       - `ac` (`storage: 'number'`, `interpretation: 'plain'`, `required: true`)
       - `str`, `dex`, `con`, `int`, `wis`, `cha` (each `storage: 'number'`, `interpretation: 'plain'`, `required: true`)
     - Ownership & Uniqueness: Set `ownerField: 'userId'` and `uniqueOn: ['userId', 'campaignId']` so each user owns at most one character per campaign and cannot spoof ownership.
     - Permissions: `'*'` (`read: true, create: false, update: false, delete: false`), `viewer` (`read: true, create: false, update: false, delete: false`), `member` (`read: true, create: true, update: 'own', delete: 'own'`), `admin` (all `true`).
   - **`src/schemas/inventory-schema.ts` (`inventory`):**
     - Columns:
       - `characterId` (`storage: 'text'`, `interpretation: { kind: 'reference', targetTable: 'characters', displayColumn: 'name' }`, `required: true`)
       - `campaignId` (`storage: 'text'`, `interpretation: 'plain'`, `required: true`)
       - `itemName` (`storage: 'text'`, `interpretation: 'plain'`, `required: true`)
       - `category` (`storage: 'text'`, `interpretation: { kind: 'select', options: ['weapon', 'armor', 'consumable', 'relic', 'quest'] }`, `default: 'relic'`)
       - `description` (`storage: 'text'`, `interpretation: 'plain'`, `default: ''`)
       - `quantity` (`storage: 'number'`, `interpretation: 'plain'`, `default: 1`)
     - Permissions: `'*'` (`read: true`, writes `false`), `viewer` (`read: true`, writes `false`), `member` (`read: true, create: true, update: true, delete: true`), `admin` (all `true`).
   - **`src/schemas/roll-logs-schema.ts` (`roll-logs`):**
     - Columns:
       - `userId` (`storage: 'text'`, `interpretation: 'plain'`, `userBound: true`, `immutable: true`)
       - `campaignId` (`storage: 'text'`, `interpretation: 'plain'`, `required: true`)
       - `characterName` (`storage: 'text'`, `interpretation: 'plain'`, `required: true`)
       - `entryType` (`storage: 'text'`, `interpretation: { kind: 'select', options: ['roll', 'action', 'gm_event', 'combat'] }`, `required: true`)
       - `statName` (`storage: 'text'`, `interpretation: 'plain'`, `default: ''`)
       - `rawRoll` (`storage: 'number'`, `interpretation: 'plain'`, `default: 0`)
       - `modifier` (`storage: 'number'`, `interpretation: 'plain'`, `default: 0`)
       - `total` (`storage: 'number'`, `interpretation: 'plain'`, `default: 0`)
       - `targetDc` (`storage: 'number'`, `interpretation: 'plain'`, `default: 0`)
       - `outcome` (`storage: 'text'`, `interpretation: { kind: 'select', options: ['critical_success', 'success', 'failure', 'critical_failure', 'info'] }`, `default: 'info'`)
       - `summary` (`storage: 'text'`, `interpretation: 'plain'`, `required: true`)
       - `createdAt` (`storage: 'number'`, `interpretation: 'datetime'`, `timestampTrigger: { field: 'summary' }`)
     - Set `ownerField: 'userId'`.
     - Permissions: `'*'` (`read: true`, writes `false`), `viewer` (`read: true`, writes `false`), `member` (`read: true, create: true, update: 'own', delete: 'own'`), `admin` (all `true`).
   - **Registration (`src/schemas.ts`):** Export `schemas` containing `usersSchema`, `settingsSchema`, `campaignsSchema`, `charactersSchema`, `inventorySchema`, `rollLogsSchema`, `CHANNELS_SCHEMA`, `MESSAGES_SCHEMA`, `REACTIONS_SCHEMA`, `CHANNEL_MEMBERS_SCHEMA`, `READ_RECEIPTS_SCHEMA`, `AI_CHATS_SCHEMA`, and `AI_MESSAGES_SCHEMA`.
2. **Privileged Server Actions (`src/actions/index.ts`):**
   - Implement `ensureDefaultCampaign`: Uses `ctx.tools.query('campaigns', {})` and, if empty, calls `ctx.tools.create('campaigns', { title: 'Chronicles of the Obsidian Vault', locationName: 'The Sunken Reliquary', atmosphereTag: 'dungeon', sceneSummary: 'Ancient braziers flicker green across a flooded stone chamber. A sealed runic door blocks the northern archway.', activeThreatDc: 13, enemyName: 'Runebound Sentinel', enemyHp: 24, enemyMaxHp: 24 }, 'default-campaign')` so all players land in a ready-to-play shared campaign room immediately.
   - Implement `applyGmMutation`: Allows privileged multi-collection updates (e.g., applying HP deltas across any party member's character sheet, granting starting gear or boss loot, and logging a `gm_event` row atomically via `ctx.tools`).

---

## Phase 3: Character Sheet UI, Archetype Generator & Inventory Management

### What Needs to Be Done

- Build the one-click "Roll Adventurer" generator and customizable character creation modal using local Base UI primitives.
- Build the reactive d20 character sheet displaying the 6 core stats, derived modifiers, Armor Class, and animated HP bar with damage/heal controls.
- Build the live inventory panel supporting item inspection, consumable usage, and item deletion with confirmation modals.

### Implementation Method

1. **Pure d20 Math Helpers (`src/lib/d20.ts`):**
   - Implement pure helper functions:
     - `getModifier(score: number): number => Math.floor((score - 10) / 2)`
     - `formatModifier(mod: number): string => (mod >= 0 ? `+${mod}`:`${mod}`)`
     - `calculateArmorClass(dexScore: number, bonus = 2): number => 10 + getModifier(dexScore) + bonus`
     - `ARCHETYPE_PRESETS`: Pre-balanced stat arrays and starting items for `Vanguard` (STR/CON focus), `Shadowblade` (DEX/CHA focus), `Arcanist` (INT/WIS focus), and `Cleric` (WIS/CON focus).
2. **Character Generator & Sheet Component (`src/components/CharacterSheetPanel.tsx`):**
   - Query characters in the active campaign via `const { records: characters, status } = useQuery('characters', { where: { campaignId: activeCampaignId } })`. Identify the signed-in user's character by matching `record.data.userId === userId`.
   - While `status === 'loading'`, render `animate-pulse` skeleton blocks (`bg-muted rounded-md`) matching the character sheet dimensions.
   - When the signed-in user has no character in the campaign, render the local `<EmptyState>` component with a `<Button loading={creating}>` that calls `createConfirmed` on `characters` (and seeds two starter items in `inventory`), firing `useToast().success('Adventurer Forged', ...)` upon completion.
   - Render the 6 ability score cards (`STR`, `DEX`, `CON`, `INT`, `WIS`, `CHA`) using `font-mono tabular-nums` for scores and modifiers. Clicking any ability card triggers a d20 skill check for that attribute.
   - Provide quick HP adjustment buttons (`-5`, `-1`, `+1`, `+5`, `Short Rest`) that call `putConfirmed` clamped between `0` and `maxHp` and display a toast confirmation.
3. **Inventory Panel (`src/components/InventoryPanel.tsx`):**
   - Subscribe via `useQuery('inventory', { where: { characterId: activeCharacter.id } })`.
   - Include an "Add Item" `<Modal>` using `<Input>`, `<Select>` (with inline `<SelectItem>` children for categories), and `<Textarea>`.
   - Include a "Use / Discard" flow guarded by `<ConfirmModal>` naming the specific item (e.g., `title="Discard 'Sunfire Vial'?"`) before calling `removeConfirmed`.

---

## Phase 4: Real-Time Party Presence & Dual-Path Dice Engine

### What Needs to Be Done

- Build the top-bar Party Presence Roster showing all online players, their active character names, archetypes, live HP bars, and recent activity status.
- Implement the interactive d20 dice roller that simultaneously broadcasts an immediate ephemeral toast/banner to all peers via `usePresenceRoom` and persists a verified roll record to `roll-logs` via `RecordRoom`.

### Implementation Method

1. **Party Presence Roster (`src/components/PartyPresenceBar.tsx`):**
   - Connect to the campaign presence room using `usePresenceRoom('campaign:default-campaign')` from `'deepspace'`.
   - Broadcast the current user's active character summary (`characterId`, `characterName`, `archetype`, `lastRoll`, `isTypingAction`) whenever their local state updates.
   - Cross-reference connected peers with the `useQuery('characters')` dataset to render each party member's `<Avatar>`, name, archetype `<Badge>`, online indicator dot, and live `hp / maxHp` counter in the top bar.
2. **Dual-Path Dice Roller (`src/components/DiceRoller.tsx`):**
   - When a user clicks any of the 6 stat buttons on their character sheet or clicks the dedicated `Roll d20` bar:
     1. Compute `rawRoll = Math.floor(Math.random() * 20) + 1`, `modifier = getModifier(statScore)`, and `total = rawRoll + modifier`.
     2. Compare `total` against `campaign.data.activeThreatDc` to classify `outcome`: `rawRoll === 20` -> `'critical_success'`, `rawRoll === 1` -> `'critical_failure'`, `total >= activeThreatDc` -> `'success'`, else `'failure'`.
     3. **Path A (Ephemeral Instant Broadcast):** Immediately broadcast the roll payload over `usePresenceRoom` so every connected browser flashes a high-contrast animated roll banner (`"Kaelen rolled DEX: d20(16) + 3 = 19 vs DC 13 [SUCCESS]"`).
     4. **Path B (Durable SQLite Log):** Call `createConfirmed` on `roll-logs` with the full roll metadata so the roll permanently appears in the Party Action Feed and can be inspected by the AI Game Master's tools.

---

## Phase 5: Streamed AI Game Master & Deterministic Database Tools

### What Needs to Be Done

- Configure the AI Game Master's system prompt in `src/ai/tools.ts` to run a structured d20 resolution loop (Scene Framing -> DC Assignment -> Roll Verification -> World/Character Mutation).
- Register custom AI tools in `buildTools` inside `src/ai/tools.ts` that read and mutate `campaigns`, `characters`, `inventory`, and `roll-logs`.
- Configure owner-billed streaming in `src/ai/chat-routes.ts` so reviewers and players can invoke the AI GM without needing personal platform credits.
- Integrate the AI Game Master chat stream directly into the main VTT workspace alongside the shared Party Action Feed.

### Implementation Method

1. **AI Game Master Tool Definitions (`src/ai/tools.ts`):**
   - Keep the built-in read/write tools in `ALLOWED_TOOL_NAMES`:
     ```ts
     const ALLOWED_TOOL_NAMES = [
       "schema.list",
       "schema.describe",
       "records.query",
       "records.get",
       "records.create",
       "records.update",
       "user.current",
     ];
     ```
   - Inside `buildTools(executor, context?: AgentToolContext<Env>)`, register four domain-specific d20 Game Master tools using `tool({ description, inputSchema: z.object(...), execute })`:
     - `get_campaign_snapshot`: Queries `campaigns`, `characters`, `inventory`, and the 10 most recent `roll-logs` rows in one call so the AI GM has full situational awareness of all party members, their HP/stats, and their latest dice rolls without burning multiple lookup turns.
     - `modify_character_hp`: Accepts `{ characterId, delta, reason, campaignId }`. Reads the target `characters` record via `executor`, computes `nextHp = Math.max(0, Math.min(maxHp, currentHp + delta))`, updates the `characters` record, and creates a `combat` entry in `roll-logs` explaining the damage or healing.
     - `grant_character_loot`: Accepts `{ characterId, campaignId, itemName, category, description, quantity }`. Inserts the new item into `inventory` and logs a `gm_event` row in `roll-logs` so all players see the loot drop in the shared feed.
     - `update_campaign_scene`: Accepts `{ campaignId, locationName, atmosphereTag, sceneSummary, activeThreatDc, enemyName, enemyHp, enemyMaxHp }`. Updates the active `campaigns` row and writes a `gm_event` transition entry to `roll-logs`.
2. **AI Game Master System Prompt (`buildSystemPrompt` in `src/ai/tools.ts`):**
   - Instruct the AI to operate as the **LoreSpace Game Master**:
     - Always call `get_campaign_snapshot` at the start of a turn if party or scene context is needed.
     - **Two-Stage Action Resolution:** When a player declares a risky action (e.g., _"I leap across the chasm"_ or _"I strike the Runebound Sentinel"_), if they have not rolled for it yet, set the stakes using `update_campaign_scene` (setting `activeThreatDc`) and ask the player to roll the specific ability check (e.g., _"Roll a DEX check against DC 14"_). Never fabricate dice rolls on behalf of a player.
     - When a player reports a roll or asks to resolve their latest check, verify the roll in `roll-logs`, narrate the outcome vividly in 2–4 concise paragraphs, and immediately invoke `modify_character_hp`, `grant_character_loot`, or `update_campaign_scene` so the database state reflects the narrative consequences.
3. **Owner-Billed AI Route Configuration (`src/ai/chat-routes.ts`):**
   - Configure `makeDefaultSummarizer(c.env)` and `streamDeepSpaceAgent(c.env, { ... })` without passing the caller's `authToken: jwt` to the billing parameter so turns are billed to the app owner's credits, guaranteeing frictionless evaluation for any signed-in reviewer or second test account.
4. **Embedded VTT AI Console (`src/components/GmConsolePanel.tsx`):**
   - Embed `ChatPanel` (from `src/components/ChatPanel.tsx`) inside the VTT workspace's center column and add quick-prompt action chips (_"Inspect the room"_, _"Resolve my latest roll"_, _"Attack the active enemy"_, _"Take a short rest"_) that automatically include the player's character name and latest roll result from `roll-logs`.

---

## Phase 6: Anti-AI Gate Audit, Multi-User Playwright Suite & Production Deploy

### What Needs to Be Done

- Run all mechanical grep gates from DeepSpace's **Product Polish** and **Anti-AI Gate** specifications and resolve every violation.
- Write unit tests for schema linting (`lintSchema`) and d20 math helpers, plus multi-user Playwright E2E tests (`smoke.spec.ts`, `api.spec.ts`, `collab.spec.ts`) using `deepspace/testing`.
- Deploy the application to `<app-name>.app.space` and run a live smoke test on the deployed URL.

### Implementation Method

1. **Product Polish & Anti-AI Grep Gates:**
   - Run the mandatory absence and presence grep checks from the repository root:
     ```bash
     # Must return 0 hits:
     grep -REn '<select|(^|[^[:alnum:]_.])(window\.)?(confirm|alert|prompt)[[:space:]]*\(' src/
     grep -rn "placeholder page\|Your app goes here" src/
     grep -rn 'data-theme="slate"' index.html
     # Must return valid matches:
     grep "home pattern:" 'src/pages/(app)/home.tsx'
     grep 'data-theme="obsidian"' src/themes.css
     ```
   - Audit all components to confirm zero emojis appear in UI chrome (headers, buttons, badges, empty states—using `lucide-react` icons such as `Sword`, `Shield`, `Sparkles`, `Scroll`, `Dices`, `Heart`, `Skull` instead) and zero purple/indigo gradients exist.
2. **Automated Verification Suite (`tests/`):**
   - **Schema Lint & Math Unit Tests (`src/schemas/__tests__/schemas.test.ts`):** Import `lintSchema` from `'deepspace/worker'` and assert `expect(lintSchema(schema)).toEqual([])` for every schema in `src/schemas.ts`.
   - **Smoke Spec (`tests/smoke.spec.ts`):** Verify `/` renders the landing page without errors, `/home` renders the app-specific H1 and preview table when signed out, `<title>` contains `LoreSpace`, navigation test IDs (`app-navigation`, `nav-sign-in-button`) exist, and interactive Base UI primitives (`Modal` / `Select`) open cleanly.
   - **Multi-User Collaboration Spec (`tests/collab.spec.ts`):**
     - Import `{ test, expect } from 'deepspace/testing'`.
     - Use `const [alice, bob] = await users(2)` to open two authenticated sessions on `/home`.
     - Have Alice create a character and trigger a d20 roll or HP change (prefixed with `__test-${Date.now()}__`).
     - Assert that Bob's browser context automatically renders Alice's character in the Party Roster, updates her HP bar, and displays her dice roll in the shared Party Action Feed without a page reload.
     - Clean up all test-created records in a `finally` block.
   - Run `npx deepspace test run` and ensure `tsc --noEmit` and all Playwright specs pass.
3. **Production Deployment & Live Smoke Verification:**
   - Commit all work and deploy via CLI:
     ```bash
     npx deepspace deploy
     ```
   - Open the deployed `<app-name>.app.space` URL in two separate browser sessions, forge two characters, roll a d20 skill check, prompt the AI GM to resolve the roll and mutate HP/loot, and verify zero console or WebSocket errors occur in production.
