/**
 * Roll banner layer — turns new `roll-logs` rows into one announced roll
 * (`P4.13`, ADR 0021).
 *
 * The banner is driven by the record room, not by presence: the action writes
 * the row before anything is broadcast, so the row is the announcement, and the
 * banner cannot disagree with the feed or show a total no row holds (ADR 0005).
 * That is also why this renders for signed-out viewers — `roll-logs` is readable
 * by the anonymous `viewer` role (ADR 0014), while the presence room stays
 * membership-gated (ADR 0006).
 *
 * The baseline is the **first `ready` snapshot**, not a timestamp: whatever
 * existed when the window arrived was history and is never replayed, and no two
 * browsers' clocks have to agree. New rows are announced once each, newest
 * first, and a later roll replaces the banner already on screen.
 *
 * It is a fixed overlay, so it lives outside the three-column grid and covers
 * nothing that scrolls.
 */

import { useEffect, useRef, useState } from 'react'
import type { RecordData } from 'deepspace'
import { RollBanner } from '@/components/vtt/RollBanner'
import type { QueryStatus } from '@/components/CharacterSheetPanel'
import { toAnnouncedRoll, unseenRolls, type AnnouncedRoll } from '@/lib/roll-announcements'
import type { RollLogRow } from '@/lib/preview-data'

export function RollBannerLayer({
  entries,
  status,
}: {
  entries: RecordData<RollLogRow>[]
  status: QueryStatus
}) {
  // `null` until the first ready snapshot has been taken as the baseline. A ref
  // rather than state: the memory must survive renders, and changing it must not
  // re-render anything.
  const seen = useRef<Set<string> | null>(null)
  const [active, setActive] = useState<AnnouncedRoll | null>(null)

  useEffect(() => {
    if (status !== 'ready') return

    if (seen.current === null) {
      seen.current = new Set(entries.map((entry) => entry.recordId))
      return
    }

    const fresh = unseenRolls(entries, seen.current)
    if (fresh.length === 0) return
    for (const entry of fresh) seen.current.add(entry.recordId)

    // Newest first, so the first row that is actually a roll wins; a GM event
    // landing in the same batch must not swallow the dice line.
    const announced = fresh
      .map(toAnnouncedRoll)
      .filter((roll): roll is AnnouncedRoll => roll !== null)
    if (announced.length > 0) setActive(announced[0] ?? null)
  }, [entries, status])

  return (
    <RollBanner
      roll={active}
      onDismiss={() => {
        setActive(null)
      }}
    />
  )
}
