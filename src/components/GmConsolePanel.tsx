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
 * Signed out it is the preview it has always been: the `PREVIEW_GM_MESSAGES`
 * list in the same frame, the same disabled input that says what it is, no
 * socket and no network — a live-looking box that swallows keystrokes reads as a
 * broken feature.
 *
 * Layout note: `ChatPanel` owns its composer, and the only additive hook it
 * takes is `queuedPrompt` / `onDraftChange` — there is no slot between the
 * message list and the input. The chip bar therefore sits directly under the
 * composer, inside the same pinned footer region, rather than forking the panel.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RecordData } from 'deepspace'
import { Send } from 'lucide-react'
import { ChatPanel } from '@/components/ChatPanel'
import { Badge } from '@/components/ui'
import {
  GM_CHIPS,
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
  /** The composer went between empty and non-empty (typing presence). */
  onDraftChange?: (hasText: boolean) => void
}

const CHIP_LABELS = GM_CHIPS.map((chip) => chip.label)

export function GmConsolePanel({
  signedIn,
  userId,
  character,
  rolls,
  preview,
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

  function sendChip(kind: GmChipKind) {
    seq.current += 1
    setQueuedPrompt({
      id: `chip-${kind}-${String(seq.current)}`,
      content: buildQuickPrompt(kind, { characterName: character?.name ?? null, latestRoll }),
    })
  }

  const header = (
    <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
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
                {message.role === 'gm' ? 'Game Master' : 'Player'}
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
            emptyStatePrompts={CHIP_LABELS}
            queuedPrompt={queuedPrompt}
            onDraftChange={onDraftChange}
          />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-border px-3 py-2">
          {GM_CHIPS.map((chip) => (
            <button
              key={chip.kind}
              type="button"
              data-testid="gm-chip"
              onClick={() => {
                sendChip(chip.kind)
              }}
              className="border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
