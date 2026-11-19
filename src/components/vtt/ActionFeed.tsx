/**
 * Action feed — the table's dice log. Renders entries in the order given
 * (newest first) and stamps only the first one in.
 *
 * `P4.11` feeds it live `roll-logs` rows: `home.tsx` reads the collection and
 * hands down the record envelopes plus the read status. Nothing here rolls,
 * writes, or subscribes — `rollSkillCheck` is the only roll authority (`P4.4`) —
 * and newest first comes from the record layer (`_created_at DESC`, ADR 0003),
 * so this component never sorts.
 */

import { Dices } from 'lucide-react'
import type { RecordData } from 'deepspace'
import { Badge, Button, EmptyState, type BadgeProps } from '@/components/ui'
import type { QueryStatus } from '@/components/CharacterSheetPanel'
import { formatModifierSpaced } from '@/lib/d20'
import type { RollLogRow } from '@/lib/preview-data'

const OUTCOME_VARIANTS: Record<string, BadgeProps['variant']> = {
  critical_success: 'success',
  success: 'success',
  failure: 'warning',
  critical_failure: 'destructive',
  info: 'secondary',
}

const OUTCOME_LABELS: Record<string, string> = {
  critical_success: 'Critical success',
  success: 'Success',
  failure: 'Failure',
  critical_failure: 'Critical failure',
  info: 'Info',
}

const ENTRY_LABELS: Record<string, string> = {
  action: 'Action',
  gm_event: 'Game Master',
  combat: 'Combat',
}

/** Rows shown before the expand toggle. A display cap only: the query reads the
 *  whole collection, so "show all" means every row the table has (`P4.18`). */
const RECENT_COUNT = 5

export function ActionFeed({
  entries,
  status,
  expanded,
  onToggleExpanded,
}: {
  entries: RecordData<RollLogRow>[]
  status: QueryStatus
  /** Owned by `/home`, because the column's heights depend on it: minimised the
   *  feed is its content height and the GM console takes the rest, expanded the
   *  feed takes the column and scrolls (`P4.14`, `P4.19`). */
  expanded: boolean
  onToggleExpanded: () => void
}) {
  const collapsible = entries.length > RECENT_COUNT
  const visible = collapsible && !expanded ? entries.slice(0, RECENT_COUNT) : entries

  return (
    <section
      data-testid="action-feed"
      className="flex h-full min-h-0 flex-col gap-2 overflow-hidden"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-3 pt-3">
        <h2 className="font-pixel text-[10px] uppercase text-muted-foreground">Table feed</h2>
        <div className="flex items-center gap-2">
          {status === 'ready' && (
            <span
              data-testid="feed-count"
              className="pixel-numeral text-[10px] text-muted-foreground"
            >
              {visible.length}/{entries.length}
            </span>
          )}
          {status === 'ready' && collapsible && (
            <Button
              variant="outline"
              size="sm"
              data-testid="feed-expand"
              aria-expanded={expanded}
              className="h-6 px-2 font-pixel text-[10px] uppercase"
              onClick={onToggleExpanded}
            >
              {expanded ? 'Recent' : `All ${String(entries.length)}`}
            </Button>
          )}
        </div>
      </header>

      {status === 'loading' && <FeedSkeleton />}
      {status === 'error' && <FeedReadError />}
      {status === 'ready' && entries.length === 0 && <FeedEmpty />}
      {status === 'ready' && entries.length > 0 && (
        <ol
          data-testid="feed-list"
          className="flex min-h-0 flex-col overflow-y-auto pb-2 lg:flex-1"
        >
          {visible.map((entry, index) => {
            const row = entry.data
            const isRoll = row.entryType === 'roll'
            return (
              <li
                // Live rows can share a `rolledAt` by accident (same millisecond),
                // and an index in the key would remount every row on each insert.
                key={entry.recordId}
                data-testid="feed-entry"
                className={
                  index === 0
                    ? 'roll-tick border-b border-border px-3 py-2.5'
                    : 'border-b border-border px-3 py-2.5'
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-pixel text-[10px] uppercase text-muted-foreground">
                    {isRoll
                      ? row.statName.toUpperCase() || 'Roll'
                      : (ENTRY_LABELS[row.entryType] ?? row.entryType)}
                  </span>
                  <span className="text-xs text-foreground">{row.characterName}</span>
                  {isRoll && (
                    <Badge
                      variant={OUTCOME_VARIANTS[row.outcome] ?? 'secondary'}
                      className="font-pixel text-[10px] uppercase"
                    >
                      {OUTCOME_LABELS[row.outcome] ?? row.outcome}
                    </Badge>
                  )}
                </div>

                {isRoll && (
                  <p className="pixel-numeral mt-1 text-sm text-foreground">
                    d20({row.rawRoll}) {formatModifierSpaced(row.modifier)} = {row.total} vs DC{' '}
                    {row.targetDc}
                  </p>
                )}

                <p className="mt-1 text-xs text-muted-foreground">{row.summary}</p>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

/**
 * Four placeholder rows with a real row's padding, so the feed does not jump
 * when the first `roll-logs` read lands.
 */
function FeedSkeleton() {
  return (
    <div
      data-testid="feed-skeleton"
      aria-busy="true"
      aria-label="Loading the table feed"
      className="flex flex-col"
    >
      {[0, 1, 2, 3].map((index) => (
        <div key={index} aria-hidden="true" className="border-b border-border px-3 py-2.5">
          <div className="h-2.5 w-1/3 animate-pulse rounded-sm bg-muted" />
          <div className="mt-2 h-2 w-2/3 animate-pulse rounded-sm bg-muted" />
        </div>
      ))}
    </div>
  )
}

/** Same voice as the sheet's read notice: one label, one reason, reload. */
function FeedReadError() {
  return (
    <div data-testid="feed-read-error" className="px-3 pb-3">
      <span className="font-pixel text-[10px] uppercase text-destructive">Unavailable</span>
      <p className="mt-1 text-xs text-muted-foreground">
        The table feed could not be read. Reload to try again.
      </p>
    </div>
  )
}

/** Ready and empty — a real table with no rolls in it yet, not a failed read. */
function FeedEmpty() {
  return (
    <EmptyState
      icon={<Dices />}
      title="No rolls yet"
      description="Rolls land here as the party makes them."
      className="px-3 py-10"
    />
  )
}
