# Phase 4 — Party presence, server-computed roll, roll banner

- **Status:** Done
- **Session:** 2026-11-19, orchestrator + delegated workers (server, roster, roll path, feed/preview, two-window spec), independent review folded in
- **Governing tasks:** `P4.*` in [`../tasks.md`](../tasks.md)
- **ADRs in force:** [0005](../adr/0005-dice-roll-authority.md) (server rolls),
  [0006](../adr/0006-presence-room-authorization.md) (presence is
  membership-gated), [0003](../adr/0003-roll-log-timestamp-column.md)
  (`rolledAt`), [0009](../adr/0009-engine-owns-outcomes.md) (engine owns
  outcomes), [0013](../adr/0013-visual-register.md) (the d20 sprite),
  [0014](../adr/0014-public-read-table.md) (live rows signed out),
  [0015](../adr/0015-server-authored-character-state.md) /
  [0020](../adr/0020-no-player-hp-path.md) (server-authored character writes)
- **Depends on:** Phase 3 — live `characters`/`inventory` reads, `forgeCharacter`,
  `useItem`, `adjustCharacterHp`-free sheet, deployed release
  `rel_01M7RWGCYG4VH0ZP30RRB8CSHV`
- **Unblocks:** Phase 5 — the GM needs `roll-logs` rows it can trust (`P4.4`),
  a `campaign:default-campaign` presence room it can share (`P4.1`/`P4.2`), and a
  live feed to resolve into (`P4.11`)

## Goal

Sign in with a friend and the table becomes a table: the roster shows who is
actually present and their live HP, clicking a stat card sends the roll to the
server, and the authoritative result lands as a banner in both windows and as a
row in the action feed — durable in `roll-logs` first, broadcast second. Nothing
about the roll is decided in the browser.

## Definition of done

- [ ] `npm run validate && npm run lint` pass
- [ ] `npm run test:unit`: new suites for the d20 byte mapper, the presence
      payload guards and the action's ownership/DC paths; action-list pin updated
      to six names; `roll-logs` member-write pin added
- [ ] `grep -rn "Math.random" src/` returns only the two pre-existing non-dice
      uses — `src/components/ui/Toast.tsx` (toast id) and `src/main.tsx` (a prose
      string) — plus the mention in `src/lib/__tests__/rng.test.ts`'s comment. No
      roll path contains it, and `src/lib/d20.ts` still generates nothing
- [ ] `src/lib/d20.ts` still imports nothing and generates no randomness
      (existing grep gate in `d20.test.ts`)- [ ] `/ws/presence/campaign:default-campaign` refuses an anonymous socket;
      `/ws/presence/campaign:preview` accepts one (asserted in
      `tests/presence.spec.ts`)
- [ ] Two signed-in browsers, one roll, banner + new feed row in both without a
      reload (`tests/presence.spec.ts`, `P4.7`)
- [ ] `npx deepspace deploy` from a clean committed tree; live `/` and `/home`
      serve, zero console errors (`P4.7`)

## Scope

**In scope:** `src/server/realtime-routes.ts`, `src/constants.ts`,
`src/actions/index.ts`, `src/lib/rng.ts` (new), `src/lib/party-presence.ts` (new),
`src/schemas/roll-logs-schema.ts`, `src/components/PartyPresenceBar.tsx` (new),
`src/components/vtt/RollBanner.tsx` (new), `src/components/vtt/D20Mark.tsx` (new,
extracted from `src/pages/index.tsx`), `src/components/vtt/PartyRoster.tsx`,
`src/components/vtt/ActionFeed.tsx`, `src/components/CharacterSheetPanel.tsx`,
`src/pages/(app)/home.tsx`, `src/schemas/__tests__/schemas.test.ts`,
`src/actions/__tests__/actions.test.ts`, `tests/presence.spec.ts` (new).

**Out of scope (explicit non-goals):**

- **No client-side dice.** `Math.random` never appears; `src/lib/d20.ts` stays
  randomness-free (ADR 0005). The high-level plan's `DiceRoller.tsx` computing
  the roll in the browser is superseded by ADR 0005, and no separate
  `DiceRoller.tsx` is created: the sheet's six stat cards are the only roll
  entry point (`P4.8`), and a second one would be a duplicate path with no task.
- **No per-campaign membership collection.** None exists; "campaign membership"
  is app membership today (`resolveAppMembership`). Decided by ADR 0006's
  wording and the schema, not by this plan.
- **No `isTypingAction`** until the GM prompt exists (`P5.9`): a field that is
  always `false` is a fixture inside the presence payload.
- **No HP broadcast over presence.** `characters` is already live-synced through
  the record room; HP comes from `useQuery`, so the presence payload stays small
  (`P4.5`).
- **No GM console, no chat** (`P5`). **No initiative/conditions/attack rolls**
  (ADR 0010). **No roll history page, no pagination** — the feed shows the
  newest 20 rows.
- **No new `campaign:preview` UI.** The scope is allowed by the server and
  asserted by a test; the signed-out table keeps rendering sample data (ADR
  0006), so no anonymous socket is opened at all.

## Entry state (verified)

| Thing | State | Where |
| --- | --- | --- |
| `usePresenceRoom(scopeId)` | SDK 0.44.2: `{ peers, connected, updateState }`; **`peers` excludes self**; one string arg, no `enabled`; anon peers are `anon-<uuid>` | `node_modules/deepspace/dist/index.d.ts:3003-3038` |
| `/ws/presence/:scopeId` | **ungated**: `wsRoute((env) => env.PRESENCE_ROOMS)`, no `extraIdentity`, no scope validation | `src/server/realtime-routes.ts:153-156` |
| `wsRoute`'s `extraIdentity` | returns `{ role? }` only, is **not called for anonymous callers**, and cannot refuse — a callback tweak cannot satisfy ADR 0006 | `src/server/realtime-routes.ts:21-47` |
| `/ws/yjs/:docId` | hand-written route that authenticates, resolves a role, and returns 401/403 **before** `stub.fetch` — the shape to copy | `src/server/realtime-routes.ts:129-143` |
| `resolveAppMembership` | `(env, userId) => { member, role } \| null`; `null` means "could not verify" → 503, never 403. Precedent: `src/ai/agent.ts:63-70` | `node_modules/deepspace/dist/worker.d.ts:3750-3770` |
| Roll authority | no `rollSkillCheck`; `classifyRoll(rawRoll, total, targetDc)` is the only classifier; 5 actions registered; tests pin exactly 5 names | `src/lib/d20.ts:88`, `src/actions/index.ts:619-625`, `src/actions/__tests__/actions.test.ts:161` |
| `roll-logs` writes | `member: create: true` today — a signed-in browser can forge a row, so ADR 0005 is not yet enforced | `src/schemas/roll-logs-schema.ts:39` |
| `roll-logs` insert | `userBound` overwrites `userId`; `timestampTrigger` stamps `rolledAt` from `summary`; action credential skips per-record RBAC | `node_modules/deepspace/dist/worker.js:1543,1558-1565,1589` |
| `campaigns.activeThreatDc` | default `12`; the only DC in the app; `campaignId` for a roll must be the character's, not the client's claim | `src/schemas/campaigns-schema.ts:21` |
| Query ordering | no `orderBy` already sorts `_created_at DESC`; `orderDir: 'desc'` available; `orderBy: 'createdAt'` maps to the system column | `node_modules/deepspace/dist/worker.js:2231-2235,2296` |
| Roster / feed | `PartyRoster` (`members: RosterMember[]`, prop-driven) and `ActionFeed` (`entries: RollLogRow[]`) exist and are fixture-fed; `home.tsx` hardcodes `online: true` and `PREVIEW_ROLLS` | `src/components/vtt/*.tsx`, `src/pages/(app)/home.tsx` |
| Stat cards | display-only `<li>`s; no click, no testid; `P4.8` owns the click path | `src/components/CharacterSheetPanel.tsx:~295` |
| Route change / deploy | GitHub source claimed permanently by `P3.8`; deploys ship the checkout, record no commit lineage | `docs/tasks.md` § Current state |

## Contracts

### Data — `roll-logs` (permissions only, no column change)

`src/schemas/roll-logs-schema.ts` permission matrix becomes:

| role | read | create | update | delete |
| --- | --- | --- | --- | --- |
| `'*'` / `viewer` | true | false | false | false |
| `member` | true | **false** (was true) | **false** (was `'own'`) | **false** (was `'own'`) |
| `admin` | true | true | true | true |

Append-only from the app's point of view: only the server writes rolls. The
action credential is unaffected (`X-App-Action` skips per-record RBAC).

### Pure functions

`src/lib/rng.ts` (new, imports nothing, no `crypto`):

```ts
/** Uniform 1..20 from raw bytes; rejects the biased tail (>= 240). */
export function rollD20FromBytes(bytes: Uint8Array): number // throws RangeError when exhausted
```

`src/lib/party-presence.ts` (new, no React, no DOM):

```ts
export type PresenceRoll = {
  rollLogId: string; statName: AbilityScoreKey; rawRoll: number; modifier: number
  total: number; targetDc: number; outcome: RollOutcome; at: number
}
export interface PartyMember { userId: string; name: string; archetype: string
  hp: number; maxHp: number; isSelf: boolean; hasCharacter: boolean }
export function parsePresenceState(state: Record<string, unknown>): {
  characterId: string | null; lastRoll: PresenceRoll | null }
export function buildParty(input: {
  peers: { userId: string; state: Record<string, unknown> }[]
  characters: RecordData<CharacterRow>[]
  myCharacter: RecordData<CharacterRow> | null
  myUserId: string
}): PartyMember[]
export function freshRolls(input: {
  peers: { userId: string; state: Record<string, unknown> }[]
  mountedAt: number
  seen: Set<string>
}): { userId: string; roll: PresenceRoll }[]   // newest first, each rollLogId once
```

Rules pinned by tests: an `anon-` peer never renders; a peer payload with a
missing/odd field is ignored rather than half-rendered; HP comes from the
`characters` row, never from presence state; a `lastRoll` older than mount (or
already seen) is not announced, so a peer joining mid-session does not replay
history.

### Components

| File | Export | Props | testids |
| --- | --- | --- | --- |
| `src/components/PartyPresenceBar.tsx` | `PartyPresenceBar` | `{ characters: RecordData<CharacterRow>[]; myCharacter: RecordData<CharacterRow> \| null; userId: string; announce: Announcement \| null }` — `Announcement = ResolvedRoll & { statName }` | `party-roster` (via `PartyRoster`), `roll-banner` (via `RollBanner`) |
| `src/components/vtt/RollBanner.tsx` | `RollBanner` | `{ roll: AnnouncedRoll \| null; onDismiss: () => void }` — `AnnouncedRoll` is the action payload plus `characterName` (no `at`) | `roll-banner`, `roll-banner-outcome` |
| `src/components/vtt/D20Mark.tsx` | `D20Mark` | `{ className?: string }` — the landing page's sprite moved, `d20-trace` intact | — |
| `src/components/vtt/PartyRoster.tsx` | `PartyRoster` | `RosterMember` gains `isSelf?: boolean`; `online === undefined` draws no dot; no HP readout when `maxHp === 0` | `party-roster`, `roster-member`, `roster-self` |
| `src/components/vtt/ActionFeed.tsx` | `ActionFeed` | `{ entries: RecordData<RollLogRow>[]; status: QueryStatus }` — records, not rows, so the key is `recordId` | `action-feed`, `feed-entry`, `feed-skeleton`, `feed-read-error` |
| `src/components/CharacterSheetPanel.tsx` | unchanged export | `+ onRollResolved?: (roll: ResolvedRoll, statName: AbilityScoreKey) => void` | `stat-card-<key>`; the in-flight state is that button's `aria-busy`/`loading`, not a second testid |

`ResolvedRoll` is the action's return shape (§ Routes). Only `PartyPresenceBar`
opens a presence socket (one socket per client, rendered signed-in only), which
is why the banner lives inside it as a fixed overlay rather than in the grid.

### Routes / actions

`POST /api/actions/rollSkillCheck` (bearer required; 401 without) —

- input `{ characterId: string; statName: 'str'|'dex'|'con'|'int'|'wis'|'cha' }`
  (zod; unknown keys stripped). No `rawRoll`, no `total`, no `campaignId` — the
  campaign is read from the character row, so a client cannot aim a roll at
  another table.
- gates, in order: `character_not_found` (get failed or missing) →
  `not_owner` (`character.userId !== ctx.userId`) → `character_not_found` again
  when `character.campaignId !== DEFAULT_CAMPAIGN_ID` (the same guard every
  other character action has, so the DC read below cannot come from one table
  while the log row names another) → `campaign_not_found`
  (`campaigns/DEFAULT_CAMPAIGN_ID` unreadable or a non-numeric DC) → roll →
  write.
- roll: `crypto.getRandomValues(new Uint8Array(64))` →
  `rollD20FromBytes` (re-draw on `RangeError`, max 3 attempts) →
  `getModifier(character[statName])` → `total = rawRoll + modifier` →
  `classifyRoll(rawRoll, total, campaign.activeThreatDc)`.
- write one `roll-logs` row: `campaignId`, `characterName`, `entryType: 'roll'`,
  `statName`, `rawRoll`, `modifier`, `total`, `targetDc`, `outcome`, `summary`.
  No `userId` (userBound), no `rolledAt` (timestampTrigger). A failed write
  returns `write_failed` with `details.stage = 'roll_log'`.
- returns `{ rawRoll, modifier, total, targetDc, outcome, rollLogId }`.

`GET /ws/presence/:scopeId` (presence room) —

- unauthenticated + `scopeId === 'campaign:preview'` → upgrade, no role.
- unauthenticated + any other scope → `401`.
- token present but invalid → `401`.
- token valid → `resolveAppMembership`: `null` → `503`, `member === false` →
  `403`, else upgrade with `{ role }`.
- uses `authenticatedRoomRequest` exactly as the other routes do.

`src/constants.ts` gains `PREVIEW_PRESENCE_SCOPE = 'campaign:preview'`.

### Presence payload (the only thing `updateState` carries)

```ts
{ characterId, characterName, archetype,
  lastRoll?: { rollLogId, statName, rawRoll, modifier, total, targetDc, outcome, at } }
```

Fixed keys, ~200 bytes, replaced — never accumulated. `updateState` merges, so a
character edit omits `lastRoll` and keeps the last one.

## Steps

### Step 1 — Presence gate and roll authority on the server (`P4.2`, `P4.4`, `P4.6`, `P4.12`)

- Files: `src/server/realtime-routes.ts`, `src/constants.ts`,
  `src/actions/index.ts`, `src/lib/rng.ts` (new), `src/schemas/roll-logs-schema.ts`,
  `src/schemas/__tests__/schemas.test.ts`, `src/actions/__tests__/actions.test.ts`,
  `src/lib/__tests__/rng.test.ts` (new)
- Change: hand-write `/ws/presence/:scopeId` on the `/ws/yjs/:docId` pattern
  (401 / 503 / 403 before `stub.fetch`) — `wsRoute`'s `extraIdentity` cannot
  refuse and is skipped for anonymous callers, so ADR 0006 is implemented at the
  route, not inside the shared helper. Add `rollSkillCheck` per § Routes and the
  `roll-logs` permission flip. Update the action-list pin to six names and add a
  permission pin.
- Watch out: `resolveAppMembership` `null` is 503, not 403; do not write `userId`
  or `rolledAt`; a missing campaign is a failed action, not `targetDc: 0`;
  `crypto` is a workerd/node global in both runtimes, never imported from
  `node:crypto`.
- Proof: `npm run test:unit`; `curl -s -o /dev/null -w '%{http_code}'
  'http://127.0.0.1:5173/ws/presence/campaign:default-campaign'` → 401 (curl
  sends no upgrade; a 401/403 body is the answer we want, and the socket case
  is `P4.7`).

### Step 2 — Presence payload guards and roster join (`P4.1`, `P4.3`, `P4.5`)

- Files: `src/lib/party-presence.ts` (new),
  `src/lib/__tests__/party-presence.test.ts` (new),
  `src/components/PartyPresenceBar.tsx` (new),
  `src/components/vtt/PartyRoster.tsx`, `src/pages/(app)/home.tsx`
- Change: the new component calls
  `usePresenceRoom(DEFAULT_CAMPAIGN_PRESENCE_SCOPE)`, seeds `updateState` from
  `myCharacter` and re-broadcasts on change, and renders `PartyRoster` from
  `buildParty(...)` — self first with an "you" marker, peers joined through
  `useQuery` rows for HP, `anon-` peers dropped, peers without a character shown
  as "No adventurer" rather than hidden. Render it only when signed in (the
  signed-out table keeps the fixture roster per ADR 0006).
- Watch out: a peer array is empty on first connect and on every reconnect, so
  the roster must not flash an empty state for self (self comes from
  `myCharacter`, not from peers); `RosterMember.online` becoming optional must
  not draw an "offline" dot for the signed-out preview.
- Proof: `npm run test:unit`; signed in, one window: own character present in
  `[data-testid="roster-member"]`.

### Step 3 — Roll from the sheet, banner to the room (`P4.8`, `P4.10`, `P4.6`)

- Files: `src/components/CharacterSheetPanel.tsx`,
  `src/components/vtt/RollBanner.tsx` (new),
  `src/components/vtt/D20Mark.tsx` (new), `src/pages/index.tsx`,
  `src/components/PartyPresenceBar.tsx`, `src/pages/(app)/home.tsx`
- Change: each stat card becomes a `<button>` (live + own character only) that
  awaits `callAction<ResolvedRoll>('rollSkillCheck', { characterId, statName })`,
  shows `loading` on that card, toasts the outcome, and calls
  `onRollResolved(roll, statName)`. `home.tsx` holds that result and passes it
  to `PartyPresenceBar`, which broadcasts it and renders `RollBanner` for the
  roller; peers get the banner from `freshRolls(peers, …)`. Extract the landing
  d20 into `D20Mark` and use it in both places. Comment at the action and at the
  broadcast: the action is the only roll authority; a broadcast failure after a
  successful write is accepted and must never retry (a retry rolls twice).
- Watch out: preview mode must stay click-free — no bearer token means no roll
  (ADR 0005); the banner must be dismissible/timed and must never replay an old
  roll on mount; `d20-trace` animation lives in `styles.css` and must survive
  the extraction.
- Proof: `npm run test:unit`; signed in: click DEX → toast with
  `d20(n) + m = t vs DC d`, banner appears once, `roll-banner` shows the same
  numbers as the toast.

### Step 4 — Live action feed (`P4.11`)

- Files: `src/pages/(app)/home.tsx`, `src/components/vtt/ActionFeed.tsx`
- Change: `useQuery<RollLogRow>('roll-logs', { where: { campaignId },
  limit: 20 })` (record layer already sorts `_created_at DESC`); pass
  `records.map(r => r.data)` plus `status`; skeleton while loading, notice on
  error, `EmptyState` when empty signed in. Signed out: live rows when present,
  `PREVIEW_ROLLS` when the collection is empty (ADR 0014).
- Watch out: `RollLogRow` must match the 12 columns exactly (no `userId` needed
  in the UI but present in data); do not filter by `entryType` — GM/combat rows
  are part of the feed story; a roll row and a presence banner must not disagree
  (both derive from the same action result).
- Proof: `npm run test:unit`; signed in: a new roll appears at the top of
  `action-feed` with `feed-entry` and matching numbers.

### Step 5 — Signed-out preview follows the live rows (`P4.9`)

- Files: `src/pages/(app)/home.tsx`
- Change: signed out, `myCharacter` = first live `characters` row when any exist
  (else `PREVIEW_CHARACTERS[0]`), items from live `inventory` for that character
  (else `PREVIEW_INVENTORY`), roster from live rows with `online` left
  `undefined`.
- Watch out: the roster and sheet must resolve the *same* character or the
  preview shows two different parties; the preview stays read-only.
- Proof: `grep` no `online: true` remains in `home.tsx`; signed out with rows
  present → sheet shows the first live character's name and HP.

### Step 6 — Two-window proof and deploy #2 (`P4.7`)

- Files: `tests/presence.spec.ts` (new), `docs/tasks.md`,
  `docs/plans/phase-4-plan.md`, `docs/plans/README.md`
- Change: the spec signs two accounts in, forges a character in each if the
  forge form is up, has A roll DEX, and asserts in both contexts: a
  `roll-banner` with the same `d20(n) + m = t` string and a new `feed-entry`.
  Adds the anonymous-socket assertions from § Definition of done. Then deploy
  from a clean tree and check `/` and `/home` live.
- Watch out: presence needs the workerd socket behind vite — if the harness
  cannot hold two live sockets, record the manual two-window check with
  screenshots in this plan instead of a flaky spec. Commit before deploying
  (GitHub-source deploy ships dirty bytes and records no lineage).
- Proof: `npm run test:e2e` (or the documented manual equivalent);
  `npx deepspace deploy`; live `/` and `/home` 200.

## Verification

```sh
npm run type-check
npm run lint
npm run test:unit
grep -rn "Math.random" src/                     # only the two non-dice hits (see DoD)
grep -rn "anon-" src/                           # party-presence.ts, its test fixtures, comments only
npm run test:smoke
npm run test:e2e                                 # presence.spec.ts is the sync proof
```

Manual, signed in (two browsers) and signed out:

1. Sign in as A and B in separate profiles → `/home` shows both characters in
   the roster, A's chip marked as self, live HP from the record room.
2. A clicks DEX → server resolves; both windows flash the same banner and the
   feed gains the same row. Reload B → the feed row is still there, no banner.
3. Signed out → populated table from live rows, no presence dot, stat cards
   inert.
4. A second anonymous browser pointed at
   `wss://<host>/ws/presence/campaign:default-campaign` is refused.

## Risks

| Risk | Trigger | Mitigation |
| --- | --- | --- |
| Presence gate breaks canvas/cron | Editing the shared `wsRoute` helper | The presence route is hand-written like `/ws/yjs`; `wsRoute` is untouched |
| Roster flashes empty / shows "offline" for self | `peers` is `[]` on connect and reconnect | Self comes from `myCharacter`; `online === undefined` renders no dot |
| Old roll replayed as a fresh banner | `updateState` merges, so `lastRoll` persists for late joiners | `freshRolls` drops rolls older than mount and dedupes `rollLogId` |
| Double roll on a retry | Client retries after a failed broadcast | Broadcast failure is not a roll failure; comment + no retry path (`P4.6`) |
| Forged roll rows | `roll-logs` member create still on | `P4.12` flips it; schema test pins it |
| Feed reads 20 rows with no filter and grows | `limit` unset | Explicit `limit: 20`; pagination is out of scope |
| Two-window spec flaky over dev sockets | Miniflare/vite websocket timing | Assert on banner text with a generous timeout; fall back to a recorded manual check |
| Sheet and roster disagree signed out | Two independent resolutions | One `previewFromLiveRows` flag feeds sheet, pack, roster **and** feed (`Step 5`) |
| Two peers roll in the same batch, or a peer's roll lands in the same commit as the roller's | `freshRolls` returns several and `PartyPresenceBar` renders only `fresh[0]` | Accepted: the feed still holds every row, and the banner is an announcement, not the record. A queue is the fix if the table ever exceeds a few players |
| Freshness compares two clocks | `freshRolls` compares the announcer's `at` with the observer's `mountedAt` | Accepted: a skewed clock can replay or miss one banner, never the `roll-logs` row |
| First visit on a brand-new account can get a transient 403 | `resolveAppMembership`'s users row is created by the record-room connect, which races the presence connect | Self-healing (the hook retries every second) and the roster still renders from the query; peer dots now follow `connected`, so a refused socket claims nothing. Watch it on a fresh account at `P6.8` |
| The 403 and 503 branches of the presence route have no test | No test JWT for a non-member, and no way to fail the users read on demand | Recorded rather than faked: the anonymous 401 and the preview exemption are asserted in `tests/presence.spec.ts`; 403/503 stay code-reviewed |

## Open questions

- [ ] **Per-campaign presence membership.** No `campaign_members` collection
  exists; the gate is app membership. Resolved in this session: implement app
  membership, name the limitation in the plan and the report — a schema change
  is out of scope and would need an ADR.
- [ ] **Anonymous roll attempt.** Resolved by ADR 0005: signed-out visitors
  cannot roll; cards are display-only and the route answers 401 without a
  bearer.
- [ ] **`isTypingAction`.** Resolved: deferred to `P5.9`.

## Outcome

Filled in at the end of the phase, never rewritten afterwards.

- **Shipped:** a membership-gated campaign presence room; a presence roster that
  joins peers to live `characters` rows; `rollSkillCheck` as the only roll
  authority, writing `roll-logs` before anything is broadcast; a roll banner in
  every open window; a live action feed; a signed-out table that shows live rows
  when the table has any. Deployed as release `rel_01M7S0P6KBHTVR1GYPX262YGPM`.
- **Slipped:** `isTypingAction` → `P5.9` (no producer exists until the GM prompt).
- **Deviations:** ADR-wise none — ADR 0005, 0006, 0009, 0013, 0014 and 0015 were
  implemented, not changed. Implementation deviations, all recorded in the task
  ticks: no `DiceRoller.tsx`; no `campaignId` in the roll request; the presence
  route is hand-written rather than an `extraIdentity` callback (that hook cannot
  refuse); `roll-logs` member writes flipped off under `P4.12`; `P5.4` reopened
  because `src/ai/tools.ts` still lists `records.delete`.
- **Inherited by the next phase:** `roll-logs` rows are trustworthy evidence
  (server-authored, member read-only) and carry `rolledAt`; the presence scope,
  payload shape and one-socket-per-client rule are fixed; `campaign.activeThreatDc`
  is the only DC; a resolved roll already reaches every window, so `P5.7`'s
  auto-resolve has a real event to hang on.

### Feature inventory (the close-out's sections 1-5)

**1. Shipped, by feature**

| Feature | State | Files | Evidence |
| --- | --- | --- | --- |
| Campaign presence gate — anonymous, bad-token, non-member and unverifiable callers refused before the room; `campaign:preview` exempt | route | `src/server/realtime-routes.ts`, `src/constants.ts` | `tests/presence.spec.ts` › "the campaign presence scope refuses an anonymous socket" (401 anon + 401 bad token on both scopes, `preview` opens); live `curl` on `/ws/presence/campaign%3Adefault-campaign` → 401 |
| Presence socket and own-state broadcast (`characterId`, `characterName`, `archetype`, `lastRoll`) | action | `src/components/PartyPresenceBar.tsx` | same spec › "one roll lands in both windows without a reload" — two `roster-member` per window with no reload, plus `roster-self` |
| Party roster join: peers × `characters` rows, self first, anon dropped, HP from the query | read + unit test | `src/lib/party-presence.ts`, `src/components/vtt/PartyRoster.tsx` | `src/lib/__tests__/party-presence.test.ts` (25 tests); spec's two-window roster assertions |
| Server-computed roll — ownership, campaign guard, DC from `campaigns`, `classifyRoll`, one `roll-logs` row, authoritative payload | action + unit test | `src/actions/index.ts` | `src/actions/__tests__/roll-skill-check.test.ts` (13 tests, incl. `not_owner` writes nothing, DC of 0 refused, crit boundaries); `[action] "rollSkillCheck"` in the e2e server log |
| Unbiased d20 from raw bytes (rejection sampling, no `Math.random`) | unit test | `src/lib/rng.ts` | `src/lib/__tests__/rng.test.ts` (5 tests: bands, rejection, exhaustion, 0-199 → ten of each face) |
| Server-authored roll history — `roll-logs` member create/update/delete off | auth + unit test | `src/schemas/roll-logs-schema.ts` | `src/schemas/__tests__/schemas.test.ts` › "makes roll history read-only for members" |
| Roll banner — d20 sprite, `d20(n) ±m = t vs DC n`, outcome badge, 6s auto-dismiss, identical for roller and peers | e2e | `src/components/vtt/RollBanner.tsx`, `src/components/vtt/D20Mark.tsx` | spec asserts the two windows' banner text is equal and matches `/d20\(\d+\) [+-]?\d+ = \d+ vs DC \d+/` |
| Stat-card roll — click → `rollSkillCheck` → toast + banner, one roll in flight, inert signed out | action | `src/components/CharacterSheetPanel.tsx` | spec clicks `stat-card-dex` and the roll lands; signed-out probe shows zero `stat-card-*` |
| Live table feed — newest 20 `roll-logs` rows, skeleton/read-error/empty | read | `src/components/vtt/ActionFeed.tsx`, `src/pages/(app)/home.tsx` | spec: newest `feed-entry` carries the banner's line and survives a reload; signed-out browser probe shows a live `Ash` roll row |
| Signed-out live-row preview — one flag feeds sheet, pack, roster and feed; no liveness dot | read | `src/pages/(app)/home.tsx` | browser probe on the dev server signed out: sheet `Ash` (live), 3 live roster rows, 0 green dots, live `d20(10) +2 = 12 vs DC 12` row |
| One hand-authored d20 sprite shared by landing and banner | e2e/render | `src/components/vtt/D20Mark.tsx`, `src/pages/index.tsx` | `npm run build` prerenders `/` with `d20-trace`; live landing renders |

**2. Not real yet**

| What you see | Actually | Becomes real in |
| --- | --- | --- |
| GM console stream (3 messages) | `PREVIEW_GM_MESSAGES` in `src/lib/preview-data.ts` | Phase 5 — `GmConsolePanel` + `ChatPanel` |
| Disabled GM prompt input + send button | native `<input disabled>` with no handler in `src/components/GmConsolePanel.tsx` | Phase 5 — `P5.7` |
| Roster "typing" affordance | absent from the payload — `isTypingAction` was deliberately not shipped | Phase 5 — `P5.9` |
| `campaign:preview` presence room | route allows it; nothing joins it and it renders nothing | never — reserved by ADR 0006 for a future live preview |
| Signed-out table on an empty database | fixture `PREVIEW_CAMPAIGN` / `PREVIEW_CHARACTERS` / `PREVIEW_ROLLS`, with no notice | never — ADR 0014's sample table for demo beat 2; a signed-in viewer never sees it |
| Feed depth | newest 20 rows only, no pagination or history page | not planned (ADR 0008 cut list) |

**3. Persistence check**

Yes — one collection: every roll writes a `roll-logs` row (12 columns,
`userId` userBound, `rolledAt` stamped from `summary`) from
`rollSkillCheck` in the Worker. Roll history has exactly one writer; the browser
writes nothing.

**4. Pending, by phase**

- **Phase 5** — replaces the GM console fixtures with the streamed AI GM, makes
  `roll-logs` the thing the GM verifies, adds the roll→GM auto-resolve and stamps
  `isTypingAction` from the prompt.
- **Phase 6** — mechanical grep gates, `collab.spec.ts` rewritten (its
  integration-catalog loading test races when four spec files run in parallel),
  `/home` smoke assertions, live deploy smoke, README front door, beat rehearsal.

**5. Worth your eyes**

| Tier | Item | Why a human | What to check | Files |
| --- | --- | --- | --- | --- |
| blocks | Presence is gated on **app** membership, not per-campaign | A security boundary; there is no `campaign_members` collection, so "member of the campaign" means "member of the app" | Confirm app membership is the intended boundary for this build, or say a per-campaign gate is required | `src/server/realtime-routes.ts:187-191` |
| blocks | `roll-logs` keeps `admin: create/update/delete: true` and `viewer: read: true` | An accepted risk, not an oversight: an admin (the owner credential) can still write history by hand, and history is world-readable | Confirm both are still acceptable (ADR 0005's "evidence" claim, ADR 0014's public table) | `src/schemas/roll-logs-schema.ts:42-47` |
| blocks | A peer's banner numbers are **claims**, not verified against `roll-logs` | The roster and banner trust a payload from another browser; only the roller's banner and the feed are authoritative | Confirm the accepted risk is clear enough to demo, or require the banner to fetch the row first | `src/components/PartyPresenceBar.tsx:105-127` |
| blocks | `roll-logs.statName` is free text, written `dex` by the action and `DEX` by fixtures; `outcome` also carries `'info'` | A column contract the GM (Phase 5) will read; a select would fail the fixture rows, so the mixed casing is load-bearing today | Decide whether `statName` should become a select (and the fixtures rewritten) before Phase 5 reads it | `src/schemas/roll-logs-schema.ts:33-37` |
| blocks | A brand-new account can get a transient 403 on presence | `resolveAppMembership`'s users row is created by the record-room connect, which races the presence connect; self-heals in ~1s | Watch one fresh signup: is the roster self row up immediately, and does the peer dot appear within a second? | `src/server/realtime-routes.ts:188-190`, `src/components/PartyPresenceBar.tsx` |
| taste | Banner copy and format: `Kaelen rolled DEX: d20(14) +2 = 16 vs DC 13` + `SUCCESS` badge | Copy and register; the missing space after `+` comes from the shared `formatModifier` | Say if `+2` should read `+ 2` everywhere (one formatter) | `src/components/vtt/RollBanner.tsx:90-99` |
| taste | Banner is a fixed overlay over the top of the table | It covers the scene banner for six seconds | Watch one roll in a real window; move it if it covers something you need | `src/components/vtt/RollBanner.tsx:78-83` |
| taste | "No adventurer" row for a present player without a sheet | The alternative was hiding a present person | Say if you would rather show their presence name or hide them | `src/lib/party-presence.ts:44`, `:150-160` |
| taste | Empty feed copy: "No rolls yet" / "Rolls land here as the party makes them." | Copy | One read | `src/components/vtt/ActionFeed.tsx:148-157` |

**6. Files touched** (`git diff --stat c18800f..HEAD`, phase commits `585c9fa` +
this one; 23 files, +2740/−171)

`src/server/realtime-routes.ts`, `src/actions/index.ts`,
`src/actions/__tests__/actions.test.ts`,
`src/actions/__tests__/roll-skill-check.test.ts`, `src/lib/rng.ts`,
`src/lib/__tests__/rng.test.ts`, `src/lib/party-presence.ts`,
`src/lib/__tests__/party-presence.test.ts`, `src/schemas/roll-logs-schema.ts`,
`src/schemas/__tests__/schemas.test.ts`, `src/constants.ts`,
`src/components/PartyPresenceBar.tsx`, `src/components/vtt/RollBanner.tsx`,
`src/components/vtt/D20Mark.tsx`, `src/components/vtt/PartyRoster.tsx`,
`src/components/vtt/ActionFeed.tsx`, `src/components/CharacterSheetPanel.tsx`,
`src/pages/(app)/home.tsx`, `src/pages/index.tsx`, `tests/presence.spec.ts`,
`docs/tasks.md`, `docs/plans/README.md`, `docs/plans/phase-4-plan.md`.

**7. Verification**

```sh
npm run validate        # tsc --noEmit + vitest: 8 files / 134 tests pass
npm run lint            # eslint . clean
npm run test:unit       # 8 files / 134 tests
npx deepspace test run smoke  --port 5283   # 6 passed
npx deepspace test run api    --port 5283   # 2 passed
npx deepspace test run tests/presence.spec.ts --port 5273  # 2 passed (16.1s)
npx deepspace test run e2e    --port 5273   # 12 passed, 1 failed: the pre-existing
                                            # collab.spec.ts loading-state race under
                                            # four parallel specs (P6.2), green alone
grep -rn "Math.random" src/   # only Toast id generator, main.tsx prose, a test comment
npx deepspace deploy          # rel_01M7S0P6KBHTVR1GYPX262YGPM, live in 6s
```

Live and local checks: `/`, `/home`, `/settings` → 200 on
<https://lorespace.app.space>; live anonymous `GET /ws/presence/campaign%3Adefault-campaign`
→ 401 and `?token=not-a-jwt` on `campaign:preview` → 401; live browser probe
(chromium, signed out) refuses the campaign socket, opens the preview socket,
renders the preview table and zero unexpected console errors; dev-server probe
signed out shows live `Ash`, three roster rows, no liveness dot, a live roll row
and zero clickable stat cards.

Demo beats: **beat 4** (character appears in the roster, second window updates
without a reload) and **beats 5-6's server half** (click DEX → server resolves →
banner and feed in both windows) pass by hand and in `tests/presence.spec.ts`.

- **Next:** `/phase 5` — **ready**. Nothing in Phase 5 is blocked now: `roll-logs`
  is trustworthy evidence (`P4.4`), the presence room it can share is up
  (`P4.1`/`P4.2`), and the feed it resolves into is live (`P4.11`). `P5.4` is
  reopened and must land before the tool set is exposed — `records.delete` is
  still in `src/ai/tools.ts`.
