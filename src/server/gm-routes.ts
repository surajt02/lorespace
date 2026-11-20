/**
 * The shared table GM thread — one streamed GM turn per campaign.
 *
 * `POST /api/gm/chat` is the console's only AI route. It differs from the SDK's
 * per-player `/api/ai/chat` (which `/assistant` keeps) in one load-bearing way:
 * the conversation is a **record of the table**, not of the caller. History is
 * read from `gm-messages` and both sides are written back there, so every
 * player and the signed-out window read the same story instead of two private
 * narrations of one roll (`gm-messages-schema.ts`).
 *
 * Two identities, deliberately different:
 *
 * - **Persistence runs as the owner.** `gm-messages` grants members read-only
 *   (the Worker is the only writer, like `roll-logs`), so the rows are written
 *   through the owner-credential action tools.
 * - **Tools run as the caller.** `createUserToolExecutor` carries the verified
 *   caller's id, so `records.*` keeps its per-record RBAC — the caller can read
 *   the table, and nothing else. The GM write tools do not rely on that
 *   identity: they run through `applyGmMutation` as the owner (ADR 0017) and are
 *   gated to this route's path (ADR 0022).
 *
 * `synthetic: true` marks an engine beat — the opening narration, the turn after
 * a resolved roll — rather than a player's line. It is persisted with
 * `characterName: '__beat__'` so the panel can hide it from the transcript (the
 * setup text would ruin the scene), and it reaches the model with no speaker
 * prefix, because the engine said it, not a character.
 *
 * Streaming, abort handling, persistence-on-end and error mapping mirror
 * `src/ai/chat-routes.ts`; read that file for the reasoning behind the order of
 * operations.
 *
 * One answer is not a stream: a real player turn whose round is still open is
 * recorded and marked, then answered **202** `{ waiting: true, roundNumber }`
 * with no model call (ADR 0031, amended 2026-11-20).
 */

import type { Hono } from 'hono'
import { createUIMessageStreamResponse, toUIMessageStream } from 'ai'
import type { ModelMessage } from 'ai'
import {
  buildUiParts,
  createUserToolExecutor,
  deepSpaceAgentErrorSummary,
  listDeepSpaceAgentModels,
  loggableError,
  resolveDeepSpaceAgentModel,
  streamDeepSpaceAgent,
} from 'deepspace/worker'
import type { ActionResult, ActionTools, QueryActionData, VerifyResult } from 'deepspace/worker'
import { buildSystemPrompt, buildTools } from '../ai/tools.js'
import { DEFAULT_CAMPAIGN_ID } from '../constants.js'
import { recordRoundTurn, shouldStreamGmTurn } from '../lib/round-pacing.js'
import { schemas } from '../schemas.js'
import { createActionTools } from './action-routes.js'
// Type-only — TypeScript strips it at runtime, so this file never imports the
// worker entry (which imports `registerGmRoutes` from here).
import type { AppContext, Env } from '../../worker.js'

type ResolveAuth = (req: Request, env: Env) => Promise<VerifyResult | null>

/** What one player typed. Far above a table message; blocks megabyte payloads. */
const MAX_CONTENT_LENGTH = 2_000
/** A character name's bound, matching `characters.name`'s schema limit. */
const MAX_NAME_LENGTH = 40
/** No table is larger than this; a longer list is trimmed, not trusted. */
const MAX_ONLINE_NAMES = 24

/** Rows read per turn. The thread is small; this only bounds a pathological one. */
const THREAD_ROW_LIMIT = 200

/** Turns handed to the model — the thread's tail, oldest first. */
const THREAD_TURN_LIMIT = 30

/**
 * The `characterName` a synthetic beat is persisted under. It is a sentinel, not
 * a person: the panel hides the row (`characterName === '__beat__'`) so the
 * table does not read the setup instruction, while the model still receives it
 * without a speaker prefix — nothing said it, the engine did.
 */
const BEAT_SENTINEL = '__beat__'

/** One row of `gm-messages` as the record room returns it. */
interface ThreadRow {
  recordId: string
  createdAt?: string
  data: Record<string, unknown>
}

/**
 * The thread's last `THREAD_TURN_LIMIT` turns, oldest first, as the model reads
 * them.
 *
 * A `user` row reaches the model as `"Name: what they did"` so attribution is
 * never guessed (the panel labels its own rows from `characterName`; the prefix
 * exists only in the model's copy). An `assistant` row arrives as-is.
 *
 * Ordering: the wire envelope carries `createdAt`, so rows are sorted by it. A
 * row without one sorts as epoch 0, which keeps the room's insertion order among
 * such rows (`Array.prototype.sort` is stable) — and a read failure degrades to
 * an empty history rather than failing a turn the table is waiting on.
 */
/** What the model reads, plus the character names who spoke in it. */
interface ThreadHistory {
  messages: ModelMessage[]
  speakers: string[]
}

async function loadThread(ownerTools: ActionTools): Promise<ThreadHistory> {
  let result: ActionResult<QueryActionData<Record<string, unknown>>>
  try {
    result = await ownerTools.query('gm-messages', {
      where: { campaignId: DEFAULT_CAMPAIGN_ID },
      limit: THREAD_ROW_LIMIT,
    })
  } catch (error) {
    console.error(`[gm-chat] thread read threw: ${loggableError(error)}`)
    return { messages: [] as ModelMessage[], speakers: [] as string[] }
  }
  if (!result.success) {
    console.error(`[gm-chat] thread read failed: ${result.error}`)
    return { messages: [] as ModelMessage[], speakers: [] as string[] }
  }

  const rows: ThreadRow[] = result.data.records.map((record) => ({
    recordId: record.recordId,
    createdAt: record.createdAt,
    data: record.data ?? {},
  }))
  rows.sort((a, b) => (Date.parse(a.createdAt ?? '') || 0) - (Date.parse(b.createdAt ?? '') || 0))

  const messages: ModelMessage[] = []
  const speakers: string[] = []
  for (const { data } of rows.slice(-THREAD_TURN_LIMIT)) {
    const content = typeof data.content === 'string' ? data.content : ''
    if (content.trim() === '') continue
    if (data.role === 'user') {
      const name = typeof data.characterName === 'string' ? data.characterName.trim() : ''
      // A synthetic beat has no speaker: the sentinel never becomes a prefix.
      const attributed = name !== '' && name !== BEAT_SENTINEL
      if (attributed) speakers.push(name)
      messages.push({ role: 'user', content: attributed ? `${name}: ${content}` : content })
    } else if (data.role === 'assistant') {
      messages.push({ role: 'assistant', content })
    }
  }
  return { messages, speakers }
}

export function registerGmRoutes(app: Hono<AppContext>, resolveAuth: ResolveAuth): void {
  app.post('/api/gm/chat', async (c) => {
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    // `resolveAuth` may accept a cookie session, which carries no bearer token —
    // and the caller's JWT is what the tool executor forwards. A call without
    // one is refused here rather than failing deeper in the request, exactly as
    // `action-routes.ts` does.
    const authHeader = c.req.header('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ') || authHeader.length <= 7) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req
      .json<{
        content?: unknown
        characterName?: unknown
        characterId?: unknown
        modelId?: unknown
        synthetic?: unknown
        transient?: unknown
        onlineCharacterNames?: unknown
      }>()
      .catch(
        () =>
          ({} as {
            content?: unknown
            characterName?: unknown
            modelId?: unknown
            synthetic?: unknown
            transient?: unknown
            onlineCharacterNames?: unknown
          }),
      )

    const rawContent = body.content
    if (typeof rawContent !== 'string' || rawContent.trim() === '') {
      return c.json({ error: 'content is required' }, 400)
    }
    const content = rawContent.trim()
    if (content.length > MAX_CONTENT_LENGTH) {
      return c.json({ error: `content exceeds ${MAX_CONTENT_LENGTH} chars` }, 400)
    }
    // A synthetic beat is an engine instruction (the opening, a resolved roll),
    // not something a player said: it is persisted under the sentinel so the
    // panel can hide it, and reaches the model without a speaker prefix.
    const synthetic = body.synthetic === true
    const characterName = synthetic
      ? BEAT_SENTINEL
      : typeof body.characterName === 'string'
        ? body.characterName.trim()
        : ''

    // A *transient* turn is an engine instruction for this call only — the
    // correction sent when the GM narrated a roll it never registered. It is
    // never persisted and never replayed: history is what the model learns from,
    // and a standing "answer with a tool call and nothing else" in the thread
    // silences every later turn (the failure this flag exists to prevent).
    const transient = body.transient === true

    const selectedModel = resolveDeepSpaceAgentModel(body.modelId, 'application')
    if (!selectedModel) {
      // Name the valid ids: the caller has no other way to learn them here.
      const modelIds = listDeepSpaceAgentModels('application').map((model) => model.id)
      return c.json(
        {
          error: `Unknown modelId: ${String(body.modelId)}. Valid: ${modelIds.join(', ')}`,
          code: 'unknown_model',
          modelIds,
        },
        400,
      )
    }

    // The thread is written by the Worker alone (`gm-messages` is member
    // read-only), so persistence uses the owner-credential action tools.
    const ownerTools = createActionTools(c.env, c.env.OWNER_USER_ID, c.env.APP_OWNER_JWT)

    // History is loaded BEFORE the user row is written: `loadThread` reads the
    // thread back, and loading after the write would put this turn in `history`
    // *and* in the appended message below — the model would answer the same
    // sentence twice. The row still lands before the model is called, so a turn
    // that reached the GM is always in the thread.
    const thread = await loadThread(ownerTools)

    // The user's row lands before the model is called: a turn that reached the
    // GM must be in the thread, and a failed write is refused here rather than
    // spending credits on a story with a hole in it.
    const userWrite = transient
      ? { success: true as const }
      : await ownerTools
          .create('gm-messages', {
            campaignId: DEFAULT_CAMPAIGN_ID,
            role: 'user',
            characterName,
            content,
          })
          .catch((error: unknown) => {
            console.error(`[gm-chat] user row write threw: ${loggableError(error)}`)
            return { success: false as const, error: 'write threw' }
          })
    if (!userWrite.success) {
      console.error(`[gm-chat] user row write failed: ${userWrite.error}`)
      return c.json({ error: 'Could not record the turn' }, 500)
    }

    // Attribution for the model only: the panel renders `characterName` from the
    // row it reads back, so the prefix never reaches the player's view — and a
    // synthetic beat has no speaker to attribute it to.
    const modelName = synthetic ? '' : characterName
    // A synthetic beat still knows who is playing: the panel sends the viewer's
    // character with it so the snapshot is filtered to the real table. The row
    // is stored under the sentinel either way (it is never rendered), but the
    // speaker counts for presence.
    // A transient turn is the engine speaking, not a player: it never counts as a
    // speaker at the table.
    const presentSpeaker =
      transient || typeof body.characterName !== 'string' ? '' : body.characterName.trim()
    const messages: ModelMessage[] = [
      ...thread.messages,
      { role: 'user', content: modelName ? `${modelName}: ${content}` : content },
    ]

    // Tools run as the verified caller: `records.*` keeps per-record RBAC, so a
    // player can read the public table and nothing they do not own. The GM write
    // tools bypass this identity on purpose — they write as the owner through
    // `applyGmMutation` and are gated to this path (ADR 0022).
    // Who is playing: the caller plus every character the panel reports as
    // online (`P5.28`). The snapshot is filtered to this set, so a character
    // whose owner is not connected — an offline party member, a test account — is
    // a roster row and nothing more. The list is client-supplied, so it is
    // bounded and shape-checked here; it can only ever *narrow* what the model
    // sees, never grant a read the caller could not make (the tool executor still
    // runs as the caller).
    const reportedOnline = Array.isArray(body.onlineCharacterNames)
      ? body.onlineCharacterNames
          .filter((name): name is string => typeof name === 'string')
          .map((name) => name.trim().slice(0, MAX_NAME_LENGTH))
          .filter((name) => name.length > 0)
          .slice(0, MAX_ONLINE_NAMES)
      : []
    const presentCharacterNames = [
      ...new Set([...reportedOnline, presentSpeaker].map((name) => name.trim()).filter(Boolean)),
    ]

    // Round pacing (ADR 0031): a real player's turn marks their character as
    // having acted in the current round BEFORE the model is called, so the
    // snapshot the GM reads already shows this speaker as done — and when the
    // last online character has acted, the round rolls over here, so the GM
    // stages the new one in this same reply. An engine beat and a transient
    // correction are the app speaking, not a character acting, so neither
    // marks anything. A bookkeeping failure is logged, never returned: it must
    // not cost a player their message.
    const round = await recordRoundTurn(ownerTools, {
      userId: auth.userId,
      onlineCharacterNames: presentCharacterNames,
      playerTurn: !synthetic && !transient,
    })

    // The GM answers once per completed round (amended 2026-11-20): a player's
    // message is already recorded and marked, but the model is only called by
    // the message that closes the round, so a two-player table gets one turn
    // covering both actions instead of two half-rounds. A bookkeeping failure
    // (`marked: false`) counts as complete — an unknown round must never hold
    // the table's story, the same rule as never stranding a roll.
    const roundComplete = !round.marked || round.rolledOver
    if (!shouldStreamGmTurn({ synthetic, transient, roundComplete })) {
      // No model call, no assistant row: the player's row is in the thread and
      // the subscription has it. The next action in the batch — or the closing
      // message — reads this row from history when its turn does arrive.
      // `roundNumber` is the open round this message joined; the `0` fallback is
      // unreachable (only a marked turn can be held) and keeps the shape fixed.
      return c.json(
        { waiting: true, roundNumber: round.marked ? round.roundNumber : 0 },
        202,
      )
    }
    const tools = buildTools(
      createUserToolExecutor(c.env, auth.userId, c.req.raw.signal, {
        room: `app:${c.env.DEEPSPACE_APP_ID}`,
      }),
      { env: c.env, userId: auth.userId, request: c.req.raw, presentCharacterNames },
    )

    // Allocated before streaming so the client can tag its in-flight overlay
    // with the same id the persisted row will carry.
    const asstId = `gm-${Date.now()}-${crypto.randomUUID()}`

    // Save the GM's finished turn. Called on normal completion and on abort
    // after at least one step. A failed write logs and does not fail the
    // stream: the player already watched the turn.
    const persistAssistant = async (
      text: string,
      responseMessages: ModelMessage[],
    ): Promise<void> => {
      const parts = buildUiParts(responseMessages)
      if (text.trim() === '' && parts.length === 0) {
        console.warn('[gm-chat] FINISH empty turn, skipping persist')
        return
      }
      try {
        const written = await ownerTools.create('gm-messages', {
          campaignId: DEFAULT_CAMPAIGN_ID,
          role: 'assistant',
          characterName: 'Game Master',
          content: text,
          ...(parts.length > 0 ? { parts } : {}),
        })
        if (!written.success) {
          console.error(`[gm-chat] assistant row write failed: ${written.error}`)
        }
      } catch (error) {
        console.error(`[gm-chat] assistant row write threw: ${loggableError(error)}`)
      }
    }

    const { result } = streamDeepSpaceAgent(c.env, {
      profile: 'application',
      modelId: selectedModel.modelId,
      // No `authToken`: both AI calls fall back to `env.APP_OWNER_JWT`, so the
      // app pays for the table's GM turns (ADR 0004). The caller is still the
      // identity tools run as, and it is the id persisted above.
      instructions: buildSystemPrompt(c.env.APP_NAME, schemas),
      messages,
      tools,
      // Cancel provider and tool work with the request; `onAbort` then saves the
      // steps that did complete, and a zero-step abort saves nothing.
      abortSignal: c.req.raw.signal,
      onError: ({ error }) => {
        console.error(
          `[gm-chat] stream error: ${deepSpaceAgentErrorSummary(error, {
            profile: 'application',
            provider: selectedModel.provider,
            modelId: selectedModel.modelId,
          })}`,
        )
      },
      onEnd: ({ text, responseMessages }) =>
        persistAssistant(text, responseMessages as ModelMessage[]),
      // The AI SDK skips `onEnd` on abort; keep the steps that completed.
      onAbort: ({ steps }) => {
        const last = steps.at(-1)
        if (!last) return
        return persistAssistant(
          last.text,
          steps.flatMap((step) => step.response.messages) as ModelMessage[],
        )
      },
    })

    return createUIMessageStreamResponse({
      headers: { 'X-Asst-Id': asstId },
      stream: toUIMessageStream({
        stream: result.stream,
        // Reasoning chunks are passed through by the SDK but not rendered; opt
        // out at the boundary so a thinking model does not show a stuck spinner.
        sendReasoning: false,
        onError: (error: unknown): string => {
          // The return value is the user-visible error text; log full detail.
          console.error(`[gm-chat] response error: ${loggableError(error)}`)
          return error instanceof Error ? error.message : String(error)
        },
      }),
    })
  })
}
