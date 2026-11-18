/**
 * Action feed — the table's dice log. Renders entries in the order given
 * (newest first) and stamps only the first one in.
 *
 * Prop-driven (`P1.10`): `P4.4` passes live `roll-logs` rows. Nothing here
 * rolls, writes, or subscribes — Phase 3/4 own the d20 and the broadcast.
 */

import { Badge, type BadgeProps } from '@/components/ui'
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

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value)
}

export function ActionFeed({ entries }: { entries: RollLogRow[] }) {
  return (
    <section data-testid="action-feed" className="flex flex-col gap-2">
      <header className="flex items-center justify-between px-3 pt-3">
        <h2 className="font-pixel text-[10px] uppercase text-muted-foreground">Table feed</h2>
        <span className="pixel-numeral text-[10px] text-muted-foreground">{entries.length}</span>
      </header>

      <ol className="flex flex-col">
        {entries.map((entry, index) => {
          const isRoll = entry.entryType === 'roll'
          return (
            <li
              key={`${entry.rolledAt}-${index}`}
              className={
                index === 0
                  ? 'roll-tick border-b border-border px-3 py-2.5'
                  : 'border-b border-border px-3 py-2.5'
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-pixel text-[10px] uppercase text-muted-foreground">
                  {isRoll ? entry.statName || 'Roll' : (ENTRY_LABELS[entry.entryType] ?? entry.entryType)}
                </span>
                <span className="text-xs text-foreground">{entry.characterName}</span>
                {isRoll && (
                  <Badge
                    variant={OUTCOME_VARIANTS[entry.outcome] ?? 'secondary'}
                    className="font-pixel text-[10px] uppercase"
                  >
                    {OUTCOME_LABELS[entry.outcome] ?? entry.outcome}
                  </Badge>
                )}
              </div>

              {isRoll && (
                <p className="pixel-numeral mt-1 text-sm text-foreground">
                  d20({entry.rawRoll}) {signed(entry.modifier)} = {entry.total} vs DC {entry.targetDc}
                </p>
              )}

              <p className="mt-1 text-xs text-muted-foreground">{entry.summary}</p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
