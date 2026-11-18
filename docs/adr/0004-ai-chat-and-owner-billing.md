# 0004 — Install `ai-chat` and bill the app owner

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** AI
- **Constraints:** `P5.1`, `P5.6`

## Context

Phase 5 assumes `src/components/ChatPanel.tsx` exists and that owner billing is
a configuration step. Neither is true here: the `ai-chat` feature has never
been installed, so there is no panel, no `ai-chat-schema.ts`, and because
`worker.ts` sets `inApp` from the registered schemas, **`/api/ai/chat` is not
registered at all** — the GM console would 404 against a route that does not
exist. Owner billing is not a flag either: `streamDeepSpaceAgent` and
`makeDefaultSummarizer` fall back to `env.APP_OWNER_JWT` only when
`authToken` is omitted, and `chat-routes.ts` currently passes the caller's
JWT in both places.

## Decision

Install the feature (`npx deepspace add ai-chat`) as the first Phase 5 task,
registering `AI_CHATS_SCHEMA` and `AI_MESSAGES_SCHEMA`. Bill every turn to the
app owner by omitting `authToken` from both AI calls. Tools keep executing as
the verified caller, so per-record RBAC is unchanged.

## Consequences

- **Positive:** any signed-in reviewer or second test account can drive the GM
  without personal credits — which is the whole point of the evaluation
  experience. Identity is still enforced upstream by the agent access resolver.
- **Negative:** the app pays for all inference, so a single exhausted
  `APP_OWNER_JWT` credit balance breaks the GM for everyone at once — a
  shared failure domain that needs monitoring before any public demo. Five new
  runtime deps (`react-markdown`, `remark-gfm`, `remark-breaks`,
  `rehype-highlight`, `highlight.js`) enter the client bundle.
- **Follow-up:** local streaming requires `APP_OWNER_JWT` to be minted by
  `deepspace dev start`; without it an owner-billed call throws rather than
  falling back. `P5.1` must land before any GM tool work is testable.

## Alternatives considered

- **Keep user billing (leave `authToken: jwt`).** Rejected: reviewers without
  platform credits hit `insufficient_credits` on their first turn, which is the
  worst possible demo outcome.
- **Build our own chat panel against `streamDeepSpaceAgent`.** Rejected: the
  SDK feature already ships the panel, stream client, schema and routes; a
  bespoke panel is maintenance for no product difference.
