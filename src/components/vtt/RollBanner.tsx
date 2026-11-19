/**
 * Roll banner — the authoritative result, stamped across the table (`P4.10`).
 *
 * Presentational and self-dismissing: it renders whatever `roll` it is given and
 * holds no state of its own beyond the timer, because the numbers must be the
 * action's numbers and nothing here may recompute them (ADR 0005). The roller
 * gets it from the action result in `CharacterSheetPanel`, peers from the
 * presence payload through `freshRolls` — both paths hand this component the
 * same six fields, so the toast, the banner and the `roll-logs` row cannot
 * disagree.
 *
 * The timer keys off `rollLogId`, not the object or the mount: a new roll
 * restarts the six seconds, and the same roll arriving again never keeps a stale
 * banner alive. `onDismiss` goes through a ref so a parent's inline callback
 * (which is a new function on every render) does not reset the timer.
 */

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Badge, Button, type BadgeProps } from '@/components/ui'
import { D20Mark } from '@/components/vtt/D20Mark'
import { formatModifier, type RollOutcome } from '@/lib/d20'

/** One roll as it is announced: the action's payload plus who rolled it. */
export interface AnnouncedRoll {
  characterName: string
  statName: string
  rawRoll: number
  modifier: number
  total: number
  targetDc: number
  outcome: RollOutcome
  rollLogId: string
}

const OUTCOME_VARIANTS: Record<RollOutcome, BadgeProps['variant']> = {
  critical_success: 'success',
  success: 'success',
  failure: 'warning',
  critical_failure: 'destructive',
}

const OUTCOME_LABELS: Record<RollOutcome, string> = {
  critical_success: 'Critical success',
  success: 'Success',
  failure: 'Failure',
  critical_failure: 'Critical failure',
}

/** How long the banner stays up. Long enough to read a line, short enough to
 *  stop covering the feed. */
const BANNER_DISMISS_MS = 6000

export function RollBanner({
  roll,
  onDismiss,
}: {
  roll: AnnouncedRoll | null
  onDismiss: () => void
}) {
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  const rollLogId = roll?.rollLogId ?? null
  useEffect(() => {
    // No roll, no timer: a dismissed banner must not schedule another dismiss.
    if (rollLogId === null) return
    const timer = setTimeout(() => {
      onDismissRef.current()
    }, BANNER_DISMISS_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [rollLogId])

  if (roll === null) return null

  return (
    <div
      data-testid="roll-banner"
      role="status"
      aria-live="polite"
      className="pixel-frame roll-tick pointer-events-none fixed inset-x-0 top-3 z-50 mx-auto flex max-w-2xl items-center gap-3 bg-card px-3 py-2"
    >
      <D20Mark className="size-12 shrink-0 text-primary" />

      <div className="min-w-0 flex-1">
        <p className="pixel-numeral text-sm leading-snug text-foreground">
          {roll.characterName} rolled {roll.statName.toUpperCase()}: d20({roll.rawRoll}){' '}
          {formatModifier(roll.modifier)} = {roll.total} vs DC {roll.targetDc}
        </p>
        <Badge
          data-testid="roll-banner-outcome"
          variant={OUTCOME_VARIANTS[roll.outcome]}
          size="sm"
          className="pixel-numeral mt-1 uppercase tracking-wider"
        >
          {OUTCOME_LABELS[roll.outcome]}
        </Badge>
      </div>

      <Button
        variant="ghost"
        size="icon"
        aria-label="Dismiss the roll banner"
        className="pointer-events-auto size-8 shrink-0"
        onClick={onDismiss}
      >
        <X aria-hidden />
      </Button>
    </div>
  )
}
