/**
 * Game Master console — the center column's narrative stream (`P5.7`).
 *
 * Signed in, the frame embeds the installed SDK `ChatPanel` and the GM is live:
 * four quick chips send a prompt built by `src/lib/gm-prompts.ts`, a resolved
 * `roll-logs` row fires exactly one automatic turn (ADR 0012), and the
 * composer's emptiness is reported upward so the roster can show typing presence
 * (`P5.9`). Billing is the app owner's (ADR 0004) and everything the model can
 * write leaves a feed row (ADR 0009, `P5.10`).
 *
 * The GM also opens the story (`P5.17`): `openBeatId` is the page's "a new game
 * just started" signal, and it queues one opening turn built from the engine's
 * act/scene label (ADR 0023). Three moments of GM initiative and no more — a
 * click that starts the game, a scene advance, and a resolved roll — each
 * attributable to a record, never to a clock.
 *
 * Signed out it is the preview it has always been: the `PREVIEW_GM_MESSAGES`
 * list in the same frame, the same disabled input that says what it is, no
 * socket and no network — a live-looking box that swallows keystrokes reads as a
 * broken feature.
 *
 * Layout note: `ChatPanel` owns its composer. The hooks it takes are additive —
 * `queuedPrompt` / `onDraftChange` for the automatic turn and typing presence,
 * plus `emptyState`, `placeholder` and `roleLabels` for the console's voice and
 * its pixel register — and there is still no slot between the message list and
 * the input. The chip bar therefore sits directly under the composer, inside the
 * same pinned footer region, rather than forking the panel.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { listDeepSpaceAgentModels, type RecordData } from 'deepspace'
import { Send } from 'lucide-react'
import { ChatPanel, type ModelOption } from '@/components/ChatPanel'
import { Badge } from '@/components/ui'
import {
  GM_CHIPS,
  buildOpeningPrompt,
  buildQuickPrompt,
  buildRollPrompt,
  unresolvedRolls,
  type GmChipKind,
} from '@/lib/gm-prompts'
import { newestFirst } from '@/lib/roll-announcements'
import type { RollLogRow } from '@/lib/preview-data'
import { cn } from '@/lib/utils'

export interface GmMessage {
  id: string
  role: 'gm' | 'player'
  text: string
}

/**
 * The console's default model (`P5.13`): the cheapest one the free plan
 * actually answers. `claude-opus-5-5` leads the SDK catalog and returns 402
 * Payment Required, so a first turn on a fresh console failed until the player
 * opened the picker.
 */
const CONSOLE_DEFAULT_MODEL_ID = 'claude-haiku-5-5'

/**
 * The SDK catalog with the default moved to the front — a reorder, not an
 * allowlist: the `ai-chat` feature warns against a second allowlist, and every
 * model must stay selectable. Built exactly as `ChatPanel`'s `DEFAULT_MODELS`
 * is (id, label, provider label), so the picker's grouping is unchanged and
 * only the order differs. `/assistant` keeps the catalog order of its own.
 */
const CONSOLE_MODELS: ModelOption[] = reorderDefault(
  listDeepSpaceAgentModels('application').map((model) => ({
    id: model.id,
    label: model.label,
    provider: model.providerLabel,
  })),
  CONSOLE_DEFAULT_MODEL_ID,
)

function reorderDefault(models: ModelOption[], defaultId: string): ModelOption[] {
  const index = models.findIndex((model) => model.id === defaultId)
  if (index <= 0) return models
  const [pinned] = models.splice(index, 1)
  models.unshift(pinned)
  return models
}

export interface GmConsolePanelProps {
  /** Signed in, the panel is live; signed out it is the fixture list. */
  signedIn: boolean
  /** The viewer, used to scope the panel's own `ai-messages` read. */
  userId?: string
  /** The viewer's character, when they have one: names the chip prompts. */
  character?: { name: string; recordId: string } | null
  /** Live `roll-logs` rows; the automatic turn watches them (ADR 0012). */
  rolls: RecordData<RollLogRow>[]
  /** The signed-out script. */
  preview: GmMessage[]
  /**
   * "A new game just started" (ADR 0023): a non-null value that changes queues
   * one opening turn. The page mints it on a successful reset, so the narration
   * is a consequence of the click and never of a mount or a timer.
   */
  openBeatId?: string | null
  /** The engine's act/scene label (`progressLabel`), used by the opening turn. */
  progress?: string
  /** The campaign's current enemy, so the `attack` chip can name it (ADR 0024). */
  enemyName?: string
  /** The composer went between empty and non-empty (typing presence). */
  onDraftChange?: (hasText: boolean) => void
}

export function GmConsolePanel({
  signedIn,
  userId,
  character,
  rolls,
  preview,
  openBeatId = null,
  progress,
  enemyName,
  onDraftChange,
}: GmConsolePanelProps) {
  // One queued prompt at a time: a chip, or the automatic roll turn. `ChatPanel`
  // sends it once and the id is what makes it once.
  const [queuedPrompt, setQueuedPrompt] = useState<{ id: string; content: string } | null>(null)
  const seq = useRef(0)
  // Roll ids this mount has already handled. The first non-empty snapshot is the
  // baseline — history is never replayed, the same rule the roll banner uses
  // (ADR 0021) — and a burst of rolls collapses to one turn.
  const announced = useRef<Set<string>>(new Set())
  const baselined = useRef(false)
  // The opening beat already queued. The id is the guard, the same shape as the
  // roll turn: a re-render with the same `openBeatId`, or a `progress` change
  // arriving with it, never re-sends the opening narration.
  const openedBeat = useRef<string | null>(null)

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
    // Newest unseen row drives the turn; every unseen id is marked, so a burst
    // is one turn and no row can fire twice.
    for (const row of pending) announced.current.add(row.recordId)
    const newest = pending[0]
    setQueuedPrompt({ id: `roll-${newest.recordId}`, content: buildRollPrompt(newest) })
  }, [rolls, signedIn])

  // The chip prompts cite the viewer's newest roll when there is one.
  const latestRoll = useMemo(() => {
    const rollsOnly = newestFirst(rolls).filter((row) => row.data.entryType === 'roll')
    const mine = character
      ? rollsOnly.find((row) => row.data.characterName === character.name)
      : undefined
    return (mine ?? rollsOnly[0])?.data ?? null
  }, [rolls, character])

  // "Start campaign" opens the story (ADR 0023, `P5.17`). Queued once per id;
  // the progress label is read at send time so the opening names the scene the
  // row says the table is in.
  useEffect(() => {
    if (!signedIn) return
    if (!openBeatId) return
    if (openedBeat.current === openBeatId) return
    openedBeat.current = openBeatId
    setQueuedPrompt({
      id: `opening-${openBeatId}`,
      content: buildOpeningPrompt(progress ?? ''),
    })
  }, [openBeatId, progress, signedIn])

  function sendChip(kind: GmChipKind) {
    seq.current += 1
    setQueuedPrompt({
      id: `chip-${kind}-${String(seq.current)}`,
      content: buildQuickPrompt(kind, {
        characterName: character?.name ?? null,
        latestRoll,
        enemyName,
      }),
    })
  }

  const header = (
    <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
      <h2 className="font-pixel text-[10px] uppercase text-muted-foreground">Game Master</h2>
      <Badge variant="outline" className="font-pixel text-[10px] uppercase">
        MODEL
      </Badge>
    </header>
  )

  if (!signedIn) {
    return (
      <section
        data-testid="gm-stream"
        className="pixel-frame flex min-h-0 flex-1 flex-col bg-card"
      >
        {header}

        {/* Scrolls when the panel is given the leftover column height (the feed
            minimised, `P4.19`); at its natural height this is just the list. */}
        <ol
          data-testid="gm-preview"
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3"
        >
          {preview.map((message) => (
            <li
              key={message.id}
              className={cn(
                'border-l-2 pl-2 text-xs',
                message.role === 'gm'
                  ? 'border-primary text-foreground'
                  : 'border-border text-muted-foreground',
              )}
            >
              <span className="mb-0.5 block font-pixel text-[10px] uppercase text-muted-foreground">
                {message.role === 'gm' ? 'Game Master' : 'You'}
              </span>
              {message.text}
            </li>
          ))}
        </ol>

        <div className="mt-auto flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
          <input
            type="text"
            disabled
            placeholder="Speak to the Game Master"
            aria-label="Speak to the Game Master"
            className="min-w-0 flex-1 border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          <button
            type="button"
            disabled
            aria-label="Send"
            className="inline-flex size-7 items-center justify-center border border-border text-muted-foreground disabled:cursor-not-allowed"
          >
            <Send className="size-3.5" aria-hidden />
          </button>
        </div>
      </section>
    )
  }

  return (
    <section
      data-testid="gm-stream"
      className="pixel-frame flex min-h-0 flex-1 flex-col overflow-hidden bg-card"
    >
      {header}

      {/* The panel fills the frame and its message list scrolls inside it; the
          chip bar and the composer stay pinned at the bottom.
          `ChatPanel`'s own root is `h-full`, so it needs a sized box of its own:
          given the whole `gm-live` column it would take 100% of it and paint its
          composer over the chip row below (the chips then look present and
          swallow every click). The wrapper is the flex item that actually owns
          the leftover height. */}
      <div data-testid="gm-live" className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ChatPanel
            chatId={null}
            userId={userId ?? ''}
            compact
            className="h-full"
            models={CONSOLE_MODELS}
            emptyState={<GmEmptyState />}
            placeholder="Speak to the Game Master"
            roleLabels={{ user: 'You', assistant: 'Game Master' }}
            queuedPrompt={queuedPrompt}
            onDraftChange={onDraftChange}
          />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1 border-t border-border px-3 py-1.5">
          {GM_CHIPS.map((chip) => (
            <button
              key={chip.kind}
              type="button"
              data-testid="gm-chip"
              onClick={() => {
                sendChip(chip.kind)
              }}
              className="border border-border bg-background px-2 py-1 font-pixel text-[10px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

/**
 * The console's empty state (`P5.7`): the table's voice, not a product's. No
 * prompt buttons — the chip row directly below the composer is the only
 * affordance, and printing the same four prompts twice reads as a bug.
 */
function GmEmptyState() {
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
