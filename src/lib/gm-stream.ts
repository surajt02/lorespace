/**
 * Client half of the shared table thread: one streamed GM turn (`P5.20`).
 *
 * Transport only. The thread itself lives in `gm-messages` and is read with
 * `useQuery` by the console, so this hook owns exactly three things:
 *
 * - **The POST.** `send` calls `POST /api/gm/chat` with the caller's bearer
 *   token, the speaker's `characterName`, and `synthetic` for an engine beat
 *   (the opening, a resolved roll). The Worker writes both sides of the thread;
 *   the browser never persists a GM message (`gm-messages-schema.ts`).
 *   A **202** is a queued turn, not an error: the message is in the thread and
 *   the GM answers once the round closes (ADR 0031 amended).
 * - **The decode.** The body is the AI SDK's SSE stream; the wire decoding is
 *   the SDK's (`parseSseLine` + `decodeAiStreamChunk`), and this file keeps only
 *   the text deltas. Reasoning chunks decode to `null` and are dropped, so a
 *   thinking model cannot leave a spinner stuck on nothing.
 * - **The abort.** `stop` cancels the request; the route's `onAbort` then saves
 *   the steps that completed, which is why an abort is not an error here.
 *
 * `streamedText` is the in-flight overlay. The caller decides when it is
 * redundant — the console clears it once the persisted assistant row carrying
 * the same text arrives, so the turn never flashes out and back in.
 *
 * Mirrors `ChatPanel.stream.ts` deliberately: same decoder, same reader loop,
 * same "a local abort does not deliver an SSE event" handling.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { decodeAiStreamChunk, getAuthToken, parseSseLine } from 'deepspace'

/** A roll turn retries once: the server hands an un-narrated batch back. */
const ROLL_TURN_ATTEMPTS = 2
const ROLL_TURN_RETRY_MS = 1_500

export interface GmTurnRequest {
  content: string
  /** The speaker, persisted on the user row and sent to the model as a prefix. */
  characterName?: string
  /** The speaker's `characters` record id, when they have a sheet. */
  characterId?: string
  /**
   * An engine beat rather than a player's line: the opening narration or the
   * turn after a resolved roll. The row is persisted hidden and the model gets
   * it without a speaker prefix.
   */
  synthetic?: boolean
  /**
   * A resolved-roll turn (`ADR 0031`, amended 2026-11-20). The route builds the
   * batch itself from `roll-logs` and claims it with the campaign cursor, so
   * `content` is only a placeholder and two windows cannot both produce a turn.
   */
  rollTurn?: boolean
  /**
   * An instruction for this call only (`P5.30`): not persisted, not replayed.
   * Reserved for the correction sent when the GM narrates a roll it never
   * registered — storing it would teach the model to stop writing prose.
   */
  transient?: boolean
  /** The selected model id (`localStorage['deepspace-ai-model']`). */
  modelId?: string
  /**
   * The characters playing right now (you plus present peers, `P5.28`). The
   * route filters the GM's snapshot to this set, so an offline character is a
   * name on the roster and nothing more.
   */
  onlineCharacterNames?: string[]
}

export interface GmStream {
  send: (turn: GmTurnRequest) => Promise<void>
  /** Abort the in-flight turn. The route persists what completed. */
  stop: () => void
  isLoading: boolean
  error: Error | null
  /** The visible text of the turn that is streaming now. */
  streamedText: string
  /** Drop the overlay; the caller calls this once the row is persisted. */
  reset: () => void
}

export interface UseGmStreamOptions {
  /** Fired when a turn settles (completed, failed or aborted), never per delta. */
  onTurnEnd?: () => void
}

export function useGmStream({ onTurnEnd }: UseGmStreamOptions = {}): GmStream {
  const [streamedText, setStreamedText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // A ref, not state: two sends in one tick must not both start.
  const loadingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  // The callback is read, never a dependency — `send` must keep its identity so
  // the console's queue effect does not re-fire on every render.
  const onTurnEndRef = useRef(onTurnEnd)

  useEffect(() => {
    onTurnEndRef.current = onTurnEnd
  }, [onTurnEnd])

  useEffect(() => () => abortRef.current?.abort(), [])

  const reset = useCallback(() => {
    setStreamedText('')
  }, [])

  const send = useCallback(async (turn: GmTurnRequest) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setIsLoading(true)
    setError(null)
    setStreamedText('')

    const controller = new AbortController()
    abortRef.current = controller

    const attemptOnce = async (): Promise<void> => {
      const token = await getAuthToken()
      if (!token) {
        throw new Error('You are signed out, so the Game Master cannot answer.')
      }

      const response = await fetch('/api/gm/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content: turn.content,
          characterName: turn.characterName ?? '',
          ...(turn.characterId ? { characterId: turn.characterId } : {}),
          ...(turn.synthetic ? { synthetic: true } : {}),
          ...(turn.rollTurn ? { rollTurn: true } : {}),
          ...(turn.transient ? { transient: true } : {}),
          ...(turn.modelId ? { modelId: turn.modelId } : {}),
          ...(turn.onlineCharacterNames && turn.onlineCharacterNames.length > 0
            ? { onlineCharacterNames: turn.onlineCharacterNames }
            : {}),
        }),
        signal: controller.signal,
      })
      // 202 (`P5.33`): the turn is recorded and the round is still open, so no
      // model was called and there is nothing to stream — the message waits in
      // the batch for the player whose move closes the round. Success, not a
      // failure: no error state, no text, and `finally` still clears the spinner.
      if (response.status === 202) {
        await response.json().catch(() => null)
        return
      }
      if (!response.ok || !response.body) {
        const detail = response.body ? await response.text().catch(() => '') : ''
        throw new Error(detail || `Request failed: ${String(response.status)}`)
      }

      await consumeStream(response.body, setStreamedText, setError)
    }

    try {
      // A roll turn is idempotent on the server (the cursor claim is handed back
      // when a turn produces nothing, `P5.40`), so a transient provider failure
      // can simply be retried: the retry re-claims the same batch and narrates it.
      // A player turn is not retried — a second message would double the table's
      // action.
      const attempts = turn.rollTurn ? ROLL_TURN_ATTEMPTS : 1
      let failure: unknown = null
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, ROLL_TURN_RETRY_MS))
        }
        try {
          await attemptOnce()
          failure = null
          break
        } catch (error) {
          failure = error
          if (error instanceof Error && error.name === 'AbortError') break
        }
      }
      if (failure !== null) throw failure
    } catch (cause) {
      const streamError = cause instanceof Error ? cause : new Error(String(cause))
      // An abort is the player stopping the turn, not a failure: the partial
      // text stays and the route saves it.
      if (streamError.name !== 'AbortError') {
        console.error('[gm] STREAM error', streamError.message)
        setError(streamError)
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      loadingRef.current = false
      setIsLoading(false)
      onTurnEndRef.current?.()
    }
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { send, stop, isLoading, error, streamedText, reset }
}

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  setStreamedText: (update: (previous: string) => string) => void,
  setError: (error: Error) => void,
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      applySseLine(line, setStreamedText, setError)
    }
  }

  buffer += decoder.decode()
  if (buffer.length > 0) applySseLine(buffer, setStreamedText, setError)
}

function applySseLine(
  line: string,
  setStreamedText: (update: (previous: string) => string) => void,
  setError: (error: Error) => void,
) {
  const chunk = parseSseLine(line)
  if (!chunk) return
  const action = decodeAiStreamChunk(chunk)
  // `null` is every chunk this surface does not render: lifecycle markers and
  // reasoning. Dropping them is what keeps `streamedText` prose only.
  if (!action) return

  switch (action.type) {
    case 'append-text':
      setStreamedText((previous) => previous + action.delta)
      return
    case 'stream-error':
      console.error('[gm] STREAM error', action.errorText)
      setError(new Error(action.errorText))
      return
    // Tool calls are mechanics, and the thread is narration: the console does
    // not render a tool row, so neither does this hook surface one.
    default:
      return
  }
}
