# 0027 — One shared GM thread per campaign

- **Status:** Accepted
- **Date:** 2026-11-19
- **Area:** AI / realtime
- **Constraints:** `P5.21`, `P5.22`
- **Supersedes:** the route clause of
  [0022](./0022-gm-tools-confined-to-chat-turn.md) (`/api/ai/chat` → the GM
  route), and the per-player chat assumption behind the console in
  [0004](./0004-ai-chat-and-owner-billing.md)
- **Complements:** [0012](./0012-gm-turn-policy.md) (latest message wins)

## Context

The `ai-chat` feature stores conversations per user: `ai-chats` and
`ai-messages` are `read: 'own'`. The GM console was built on it, so every player
had a **private** GM conversation. At a table that means two players watching one
dice log and reading two different narrations of the same roll — the opposite of
the wedge (one table, one story). It also put the GM write tools behind
`/api/ai/chat`, a route the generic `/assistant` page shares, so a signed-in
player could drive `damage_enemy` from a personal assistant chat.

The signed-out preview already reads the public table; the story should be part
of that table, not a private window.

## Decision

**One GM conversation per campaign, readable by everyone who can read the table.**

- New collection `gm-messages`: `campaignId`, `role` (`user|assistant`),
  `characterName`, `content`, `parts`. `viewer` **read** (a signed-out window sees
  the story), `member` read only — the Worker writes both sides — `admin` all.
- One route, `POST /api/gm/chat`, streams a turn: history read from
  `gm-messages` (last 30 turns), tools run as the verified caller (so
  `records.*` stays RBAC-bound), writes and billing as the app owner
  ([ADR 0004](./0004-ai-chat-and-owner-billing.md)), user row persisted before
  the stream, assistant row on end/abort.
- **Synthetic beats are stored but invisible.** The opening beat and the roll
  payload are persisted with `characterName: '__beat__'` and filtered out of the
  rendering; the model still receives them. The player sees a scene, not a setup
  message.
- **The GM-tool gate moves with the thread** (`GM_CHAT_PATH = '/api/gm/chat'`),
  so GM writes are possible from the table thread and refused on
  `/api/ai/chat`, `/_deepspace/agent/*` and the agent surface.
- `/assistant` and `ChatPanel` remain installed for a private, generic assistant
  (unlinked, `P5.8`); they are no longer the GM's surface.

## Consequences

- **Positive:** every player and a signed-out window read the same narration;
  attribution is one field (`characterName`) on the row instead of an inference
  across private histories; the GM write path exists on exactly one route.
- **Negative:** the GM has no private memory per player, so a whisper or a private
  check is not expressible; `ai-chats`/`ai-messages` are now dead weight for the
  GM and only serve `/assistant`; the thread grows unbounded (no compaction yet —
  the route caps history at 30 turns).
- **Follow-up:** if private whispers or per-character secrets are wanted, they are
  a second collection with a narrower read rule, not a return to per-user chats.

## Alternatives considered

- **Keep per-player threads.** Rejected: two narrations of one roll is not a
  table.
- **Fan one turn out to every player's private chat.** Rejected: it multiplies
  owner-billed turns by the party size and still leaves divergent history.
- **Reuse `ai-chats` with a shared chat.** Rejected: its RBAC is `read: 'own'`
  and member `create: false`; widening a vendor collection is worse than owning
  five columns.
