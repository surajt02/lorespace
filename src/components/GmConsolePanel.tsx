/**
 * Game Master console — the center column's narrative stream. A static
 * container (`P1.10`): it takes its messages as props and does not talk to a
 * model, so `P5.1`–`P5.7` can mount a real `ChatPanel` inside this frame
 * without a rewrite.
 *
 * The input row is disabled on purpose — a live-looking box that swallows
 * keystrokes reads as a broken feature, so it says what it is: not yet wired.
 */

import { Send } from 'lucide-react'
import { Badge } from '@/components/ui'
import { cn } from '@/lib/utils'

export interface GmMessage {
  id: string
  role: 'gm' | 'player'
  text: string
}

export function GmConsolePanel({ messages }: { messages: GmMessage[] }) {
  return (
    <section data-testid="gm-stream" className="pixel-frame flex flex-col bg-card">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="font-pixel text-[10px] uppercase text-muted-foreground">Game Master</h2>
        <Badge variant="outline" className="font-pixel text-[10px] uppercase">
          MODEL
        </Badge>
      </header>

      <ol className="flex flex-col gap-2 px-3 py-3">
        {messages.map((message) => (
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

      <div className="mt-auto flex items-center gap-2 border-t border-border px-3 py-2">
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
