/**
 * Game Master console — the table's shared narrative thread (`P5.7`, `P5.20`).
 *
 * The conversation belongs to the **table**, not to the viewer: rows come from
 * `gm-messages`, which the Worker writes and every player (and the signed-out
 * window) reads. Two players watching one thread see one story; the GM's
 * narration is not two private paraphrases of the same roll.
 *
 * The panel therefore renders its own thread instead of embedding the SDK's
 * `ChatPanel`: the assistant's bubbles, history rail and per-user scoping are
 * the wrong shape for a table record. The register is the signed-out preview's
 * (square frames, Silkscreen micro-labels, an amber left rule on GM prose, one
 * full-width composer with a send arrow) because that is the console's own
 * style, not the assistant's.
 *
 * What is hidden: rows persisted under `characterName === '__beat__'` are engine
 * beats — the opening instruction, the turn after a resolved roll — that the GM
 * must receive and the table must not read (seeing the setup ruins the scene).
 * The same rule makes the thread's mechanics invisible: tool rows are not
 * rendered, because the feed is where mechanics live.
 *
 * Only an engine beat or the player's own words reach the model through
 * `useGmStream` (`src/lib/gm-stream.ts`); this file owns when a turn is due, not
 * how it travels. Three moments of GM initiative and no more (ADR 0023): a click
 * that starts the game, a resolved roll, and typing at the table.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { listDeepSpaceAgentModels, useQuery, type RecordData } from 'deepspace'
import { ArrowUp, Check, Square } from 'lucide-react'
import { Badge, Popover, PopoverContent, PopoverTrigger } from '@/components/ui'
import { DEFAULT_CAMPAIGN_ID } from '@/constants'
import {
  buildCheckFixPrompt,
  buildOpeningPrompt,
  requestsRoll,
  statNamedInText,
  unresolvedRolls,
} from '@/lib/gm-prompts'
import { useGmStream } from '@/lib/gm-stream'
import { ownsRollTurn } from '@/lib/turn-status'
import type { RollLogRow } from '@/lib/preview-data'
import { cn } from '@/lib/utils'

/** One row of `gm-messages` as the record room returns it. */
export interface GmMessageRow {
  campaignId: string
  role: string
  characterName: string
  content: string
  parts?: unknown
}

/** The signed-out script's shape (the fixture, not a record row). */
export interface GmMessage {
  id: string
  role: 'gm' | 'player'
  text: string
}

/**
 * The `characterName` an engine beat is persisted under (`gm-routes.ts`). A row
 * carrying it was never said by a person and is never rendered.
 */
const BEAT_SENTINEL = '__beat__'

const MODEL_STORAGE_KEY = 'deepspace-ai-model'

/** How recent a GM turn must be for its missed check to warrant a correction. */
const CHECK_FIX_WINDOW_MS = 3 * 60 * 1000

/** The cheapest model the free plan answers (`P5.13`): Opus 402s on a fresh console. */
const CONSOLE_DEFAULT_MODEL_ID = 'claude-haiku-5-5'

interface ConsoleModel {
  id: string
  label: string
  provider: string
}

/**
 * The SDK catalog with the default first — an order, not an allowlist: every
 * model stays selectable, `/assistant` keeps the catalog's own order.
 */
const CONSOLE_MODELS: ConsoleModel[] = reorderDefault(
  listDeepSpaceAgentModels('application').map((model) => ({
    id: model.id,
    label: model.label,
    provider: model.providerLabel,
  })),
  CONSOLE_DEFAULT_MODEL_ID,
)

function reorderDefault(models: ConsoleModel[], defaultId: string): ConsoleModel[] {
  const index = models.findIndex((model) => model.id === defaultId)
  if (index <= 0) return models
  const [pinned] = models.splice(index, 1)
  models.unshift(pinned)
  return models
}

/** The stored selection when it names a model this build offers, else the default. */
function initialModelId(): string {
  let saved: string | null = null
  try {
    saved = typeof window === 'undefined' ? null : window.localStorage.getItem(MODEL_STORAGE_KEY)
  } catch {
    // Storage can be unavailable in privacy modes; the default still works.
  }
  const known = CONSOLE_MODELS.some((model) => model.id === saved)
  return known && saved ? saved : (CONSOLE_MODELS[0]?.id ?? CONSOLE_DEFAULT_MODEL_ID)
}

/**
 * The placeholder content a roll turn sends. The route ignores it and builds the
 * batch prompt from `roll-logs` (ADR 0031, amended) — it exists only because a
 * POST body reads better with the field present.
 */
const ROLL_TURN_PLACEHOLDER = 'Resolve the rolls since your last turn.'

/** One turn waiting for the stream to be free: a player's line, or an engine beat. */
interface QueuedTurn {
  id: number
  content: string
  synthetic: boolean
  /** A one-call instruction: never persisted (`P5.30`). */
  transient?: boolean
  /** A resolved-roll turn: the route owns its content and its claim. */
  rollTurn?: boolean
}

/** A rendered turn, live or preview, in one shape so the markup has one branch. */
interface Turn {
  id: string
  role: 'gm' | 'player'
  speaker: string
  text: string
}

export interface GmConsolePanelProps {
  /** Signed in, the console can speak; signed out it is a read-only window. */
  signedIn: boolean
  /** The viewer's character, when they have one: names and attributes their lines. */
  character?: { name: string; recordId: string } | null
  /** Live `roll-logs` rows; this is when the console asks for a roll turn (ADR 0031, amended). */
  rolls: RecordData<RollLogRow>[]
  /** The signed-out script, rendered only while the live thread is empty. */
  preview: GmMessage[]
  /**
   * "A new game just started" (ADR 0023): a non-null value that changes queues
   * one opening turn, sent as a synthetic beat so it never renders.
   */
  openBeatId?: string | null
  /** The engine's act/scene label (`progressLabel`), used by the opening turn. */
  progress?: string
  /** The composer went between empty and non-empty (typing presence). */
  onDraftChange?: (hasText: boolean) => void
  /**
   * Somebody at the table already owes a check (`P5.19`, ADR 0030). When the GM
   * narrates a roll without registering one, the console sends a single
   * corrective beat — but only while nobody's row carries a check, so it can
   * never re-arm or overrule one that is already owed (on this sheet or any
   * other).
   */
  pendingCheck?: boolean
  /** The characters playing right now; the GM's snapshot is filtered to them. */
  onlineCharacterNames?: string[]
  /**
   * The viewer's sheet is behind the campaign's round (ADR 0031, amended): they
   * owe a move. The console says so, which is what lets the GM stop naming the
   * players who are waiting. False or absent renders nothing.
   */
  awaitingMove?: boolean
}

/**
 * `RecordData<RollLogRow>`, spelled locally to keep the import list short.
 */
export function GmConsolePanel({
  signedIn,
  character,
  rolls,
  preview,
  openBeatId = null,
  progress,
  onDraftChange,
  pendingCheck = false,
  onlineCharacterNames = [],
  awaitingMove = false,
}: GmConsolePanelProps) {
  const [input, setInput] = useState('')
  const [queue, setQueue] = useState<QueuedTurn[]>([])
  const [modelId, setModelId] = useState<string>(initialModelId)
  const { send, stop, isLoading, error, streamedText, reset } = useGmStream()

  const seq = useRef(0)
  // Roll ids this mount has already handled. The first non-empty snapshot is the
  // baseline — history is never replayed (ADR 0021) — and a burst of rolls
  // collapses to one turn.
  const announced = useRef<Set<string>>(new Set())
  const baselined = useRef(false)
  // The opening beat already queued, keyed by the page's one-shot id.
  const openedBeat = useRef<string | null>(null)
  // Assistant rows already checked for a narrated-but-unregistered roll: one
  // correction per GM turn, so a model that keeps forgetting cannot loop.
  const corrected = useRef<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  const { records } = useQuery<GmMessageRow>('gm-messages', {
    where: { campaignId: DEFAULT_CAMPAIGN_ID },
  })

  /**
   * The thread, oldest first, by the envelope's `createdAt` — the same ordering
   * rule the Worker uses when it hands the history to the model. Beats are
   * dropped here, so the setup text never reaches the player's view.
   */
  const threadRows = useMemo(
    () =>
      records
        .filter((record) => {
          const data = record.data
          return (
            data.characterName !== BEAT_SENTINEL &&
            typeof data.content === 'string' &&
            data.content.trim() !== ''
          )
        })
        .sort(
          (a, b) =>
            (Date.parse(a.createdAt ?? '') || 0) - (Date.parse(b.createdAt ?? '') || 0),
        ),
    [records],
  )

  const characterName = character?.name ?? ''

  /**
   * What to draw. Signed in, the live thread. Signed out with an empty thread,
   * the fixture — so the demo still has a table — in the same markup as a live
   * one, because a preview that renders differently from the real thing is a
   * promise the console cannot keep.
   */
  const turns = useMemo<Turn[]>(() => {
    if (!signedIn && threadRows.length === 0) return previewTurns(preview)
    return threadRows.map((record) => ({
      id: record.recordId,
      role: record.data.role === 'assistant' ? 'gm' : 'player',
      speaker:
        record.data.role === 'assistant'
          ? 'Game Master'
          : (record.data.characterName.trim() || 'Someone at the table'),
      text: record.data.content,
    }))
  }, [signedIn, threadRows, preview])

  // The overlay is redundant once the persisted row carrying the same text
  // lands: clear it then, so the turn never flashes out and back in.
  useEffect(() => {
    if (streamedText.trim() === '') return
    const persisted = threadRows.some(
      (record) =>
        record.data.role === 'assistant' &&
        record.data.content.trim() === streamedText.trim(),
    )
    if (persisted) reset()
  }, [threadRows, streamedText, reset])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [turns.length, streamedText, isLoading])

  const enqueue = (
    content: string,
    synthetic = false,
    transient = false,
    rollTurn = false,
  ) => {
    const trimmed = content.trim()
    if (trimmed === '') return
    seq.current += 1
    setQueue((pending) => [
      ...pending,
      { id: seq.current, content: trimmed, synthetic, transient, ...(rollTurn ? { rollTurn } : {}) },
    ])
  }

  // One turn at a time: an opening beat and a resolved roll can both be queued
  // in one window, and the stream answers them in order.
  useEffect(() => {
    if (!signedIn || isLoading || queue.length === 0) return
    const [next, ...rest] = queue
    setQueue(rest)
    void send({
      content: next.content,
      // Attribution is a field: the route prefixes the model's copy and the
      // thread labels the row from `characterName`.
      // The name travels even on a synthetic beat: it is never rendered (the
      // row is stored under the sentinel) but it tells the server who is at the
      // table, so the snapshot is filtered to real players instead of every
      // `characters` row (P5.26).
      characterName,
      ...(next.synthetic || !character?.recordId ? {} : { characterId: character.recordId }),
      synthetic: next.synthetic,
      ...(next.transient ? { transient: true } : {}),
      ...(next.rollTurn ? { rollTurn: true } : {}),
      modelId,
      onlineCharacterNames,
    })
  }, [queue, signedIn, isLoading, send, characterName, character?.recordId, modelId, onlineCharacterNames])

  // A resolved roll queues one roll turn (ADR 0031, amended 2026-11-20). The
  // window still owns *when to ask* — the first non-empty snapshot is the
  // baseline, every unseen id is marked, and a burst collapses to one request —
  // but not *what the turn says*: the route reads the batch out of `roll-logs`
  // and claims it with the campaign cursor, so a second window's identical
  // request finds nothing new. That is what stops two rolls producing several
  // out-of-order turns.
  useEffect(() => {
    if (!signedIn) return
    if (!baselined.current) {
      if (rolls.length === 0) return
      baselined.current = true
      for (const row of rolls) announced.current.add(row.recordId)
      return
    }
    const pending = unresolvedRolls(rolls, announced.current)
    if (pending.length === 0) return
    for (const row of pending) announced.current.add(row.recordId)
    // Only the roller's window asks (`P5.40`): every window sees the row, and two
    // simultaneous requests are what produced two model calls and the claim race.
    // The roller's window is open by definition, so the turn still happens.
    if (!ownsRollTurn({ newestRollName: pending[0]?.data.characterName, myName: characterName })) {
      return
    }
    // `enqueue` is stable in behaviour (it only appends to state); it is not a
    // dependency because re-running on it would re-queue the same turn.
    enqueue(ROLL_TURN_PLACEHOLDER, true, false, true)
  }, [rolls, signedIn, characterName])

  // A narrated roll with no request behind it is a dead end: the gate refuses
  // every unrequested stat, so the table can neither roll nor continue. Send one
  // hidden beat asking the GM to register the check it just described. The
  // sheet's `fallbackStat` is the second net — if this turn also fails, the named
  // stat is still rollable at the scene DC.
  useEffect(() => {
    if (!signedIn || isLoading || pendingCheck) return
    const lastAnswer = [...threadRows].reverse().find((row) => row.data.role === 'assistant')
    if (!lastAnswer) return
    if (corrected.current.has(lastAnswer.recordId)) return
    // Only a live mistake: a reload must not re-spend a turn correcting a turn
    // that ended minutes (or a session) ago.
    const answeredAt = Date.parse(lastAnswer.createdAt ?? '') || 0
    if (answeredAt !== 0 && Date.now() - answeredAt > CHECK_FIX_WINDOW_MS) return
    // An ask the dice already answered needs no correction: a resolved roll
    // after that message means the gate was satisfied, not forgotten.
    const newestRollAt = rolls.reduce(
      (newest, row) => Math.max(newest, Date.parse(row.createdAt ?? '') || 0),
      0,
    )
    if (newestRollAt > answeredAt) return
    const text = lastAnswer.data.content
    if (!requestsRoll(text)) return
    const stat = statNamedInText(text)
    if (!stat) return
    corrected.current.add(lastAnswer.recordId)
    // Transient, not a beat: it must never enter history (`P5.30`).
    enqueue(buildCheckFixPrompt(stat, characterName), false, true)
  }, [threadRows, pendingCheck, signedIn, isLoading, characterName, rolls])

  // "Start campaign" opens the story (ADR 0023): queued once per id, sent as an
  // engine beat so the instruction never renders.
  useEffect(() => {
    if (!signedIn) return
    if (!openBeatId) return
    if (openedBeat.current === openBeatId) return
    // The beat is the click's consequence, not the mount's: a remount (a hot
    // reload keeps this id) must not narrate the opening a second time, so an
    // answer written after the click already opened the story.
    const openedAt = Number(openBeatId)
    const alreadyOpened = threadRows.some(
      (row) =>
        row.data.role === 'assistant' &&
        (Date.parse(row.createdAt ?? '') || 0) > openedAt,
    )
    if (alreadyOpened) {
      openedBeat.current = openBeatId
      return
    }
    openedBeat.current = openBeatId
    enqueue(buildOpeningPrompt(progress ?? ''), true)
    // `enqueue` is stable in behaviour; see the roll effect above.
  }, [openBeatId, progress, signedIn, threadRows])

  function selectModel(id: string) {
    setModelId(id)
    try {
      window.localStorage.setItem(MODEL_STORAGE_KEY, id)
    } catch {
      // Storage can be unavailable in privacy modes; the selection still applies.
    }
  }

  const canSend = signedIn && input.trim().length > 0 && !isLoading

  function submit() {
    if (!canSend) return
    const content = input.trim()
    setInput('')
    // Sending empties the composer, so the typing flag clears with it.
    onDraftChange?.(false)
    enqueue(content)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter commits an active IME composition; it must not also send it.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const streaming = streamedText.trim() !== ''

  return (
    <section
      data-testid="gm-stream"
      className="pixel-frame flex min-h-0 flex-1 flex-col overflow-hidden bg-card"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <h2 className="font-pixel text-[10px] uppercase text-muted-foreground">Game Master</h2>
        {signedIn ? (
          <ModelMenu modelId={modelId} onSelect={selectModel} />
        ) : (
          <Badge variant="outline" className="font-pixel text-[10px] uppercase">
            MODEL
          </Badge>
        )}
      </header>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="Table conversation"
        data-testid="gm-thread"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3"
      >
        {turns.map((turn) => (
          <TurnBlock key={turn.id} turn={turn} />
        ))}

        {streaming && (
          <TurnBlock
            turn={{
              id: 'gm-streaming',
              role: 'gm',
              speaker: 'Game Master',
              text: streamedText,
            }}
            streaming
          />
        )}

        {isLoading && !streaming && (
          <p
            data-testid="gm-thinking"
            className="font-pixel text-[10px] uppercase text-muted-foreground"
          >
            The Game Master is thinking…
          </p>
        )}

        {turns.length === 0 && !isLoading && signedIn && <QuietTable />}
      </div>

      {error && (
        <div role="alert" className="shrink-0 border-t border-destructive/40 px-3 py-2">
          <p className="text-[12px] leading-relaxed text-destructive">{error.message}</p>
        </div>
      )}

      {/* Whose move it is (ADR 0031, amended): the interface says it once, above
          the composer, instead of the GM restating the table in prose. */}
      {signedIn && awaitingMove && (
        <p data-testid="awaiting-move" className="px-3 pt-1.5 font-pixel text-[10px] uppercase text-primary">
          awaiting your move…
        </p>
      )}

      {signedIn ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="shrink-0 border-t border-border px-3 py-2"
        >
          <div className="flex items-end gap-1.5 border border-border bg-background py-1 pl-2 pr-1 transition-colors focus-within:border-primary">
            {characterName !== '' && (
              <span className="shrink-0 pb-1 font-pixel text-[10px] uppercase text-muted-foreground">
                {characterName}
              </span>
            )}
            <textarea
              data-testid="gm-input"
              aria-label="Speak to the Game Master"
              rows={1}
              value={input}
              placeholder="Speak to the Game Master…"
              onChange={(event) => {
                setInput(event.target.value)
                onDraftChange?.(event.target.value.trim().length > 0)
              }}
              onKeyDown={handleKeyDown}
              className="block min-w-0 flex-1 resize-none bg-transparent py-1 text-[13px] leading-[1.4] text-foreground placeholder:text-muted-foreground/60 outline-none"
            />
            {isLoading ? (
              <button
                type="button"
                data-testid="gm-stop"
                onClick={stop}
                aria-label="Stop the Game Master"
                className="inline-flex size-7 shrink-0 items-center justify-center border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              >
                <Square className="h-3 w-3 fill-current" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                data-testid="gm-send"
                disabled={!canSend}
                aria-label="Send"
                className="inline-flex size-7 shrink-0 items-center justify-center border border-primary bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/60"
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </form>
      ) : (
        <p
          data-testid="gm-signin"
          className="shrink-0 border-t border-border px-3 py-2 font-pixel text-[10px] uppercase text-muted-foreground"
        >
          Sign in to speak at this table
        </p>
      )}
    </section>
  )
}

/** One turn: GM prose on an amber rule, a player's line in a framed block. */
function TurnBlock({ turn, streaming = false }: { turn: Turn; streaming?: boolean }) {
  if (turn.role === 'gm') {
    return (
      <article
        data-testid="gm-turn"
        data-role="gm"
        data-streaming={streaming ? 'true' : undefined}
        className="border-l-2 border-primary pl-3"
      >
        <span className="mb-1 block font-pixel text-[10px] uppercase text-muted-foreground">
          {turn.speaker}
        </span>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
          {turn.text}
        </p>
      </article>
    )
  }

  return (
    <article
      data-testid="gm-turn"
      data-role="player"
      className="border border-border bg-shell-panel px-3 py-2"
    >
      <span className="mb-1 block font-pixel text-[10px] uppercase text-muted-foreground">
        {turn.speaker}
      </span>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{turn.text}</p>
    </article>
  )
}

/** The signed-out script in the live thread's shape. `You` is the reader. */
function previewTurns(preview: GmMessage[]): Turn[] {
  return preview.map((message) => ({
    id: message.id,
    role: message.role === 'gm' ? 'gm' : 'player',
    speaker: message.role === 'gm' ? 'Game Master' : 'You',
    text: message.text,
  }))
}

/**
 * Signed in, nothing said yet: the table's voice, not a product's. The composer
 * is the only affordance, so this is an invitation rather than a menu.
 */
function QuietTable() {
  return (
    <div className="flex h-full flex-col justify-center gap-2 px-1 py-4">
      <p className="font-pixel text-[10px] uppercase text-muted-foreground">The table is quiet</p>
      <p className="max-w-[26rem] text-[13px] leading-relaxed text-muted-foreground">
        Ask a question, declare an action, or make a check. The GM reads the table
        before it answers.
      </p>
    </div>
  )
}

/** The `MODEL` control: the picker lives in the header so the composer is one row. */
function ModelMenu({ modelId, onSelect }: { modelId: string; onSelect: (id: string) => void }) {
  const selected = CONSOLE_MODELS.find((model) => model.id === modelId)

  return (
    <Popover>
      <PopoverTrigger
        data-testid="gm-model"
        aria-label="Choose the model"
        className="inline-flex items-center gap-1.5 border border-border bg-background px-2 py-1 font-pixel text-[10px] uppercase text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
      >
        MODEL
        <span className="max-w-[10rem] truncate normal-case text-foreground">
          {selected?.label ?? 'Default'}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 rounded-none border-border bg-card p-1">
        <ul className="flex max-h-72 flex-col overflow-y-auto">
          {CONSOLE_MODELS.map((model) => (
            <li key={model.id}>
              <button
                type="button"
                data-testid={`gm-model-${model.id}`}
                onClick={() => {
                  onSelect(model.id)
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-secondary',
                  model.id === modelId ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{model.label}</span>
                  <span className="block truncate font-pixel text-[10px] uppercase text-muted-foreground">
                    {model.provider}
                  </span>
                </span>
                {model.id === modelId && <Check className="size-3.5 shrink-0" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
