/**
 * Roll announcements — the banner's source of truth (`P4.13`).
 *
 * A `roll-logs` row is the only thing that may be announced: the action writes
 * it before anything is broadcast, so the record room *is* the announcement and
 * the banner can never show a total that no row holds (ADR 0005, ADR 0021).
 *
 * That also makes the banner public: `roll-logs` is readable by the anonymous
 * `viewer` role (ADR 0014), so a signed-out window watching the same table sees
 * the same roll without joining the presence room (which stays membership-gated,
 * ADR 0006).
 *
 * Pure: no React, no clock, no network. `unseenRolls` takes the caller's memory
 * as a `Set` and never mutates it, so the caller decides when a row counts as
 * seen — the mount baseline is seeded from the first ready snapshot rather than
 * from a timestamp, which keeps the two windows' clocks out of it.
 */

import type { RecordData } from 'deepspace'
import type { RollLogRow } from '@/lib/preview-data'

/** One roll as the banner renders it: a `roll-logs` row, narrowed. */
export interface AnnouncedRoll {
  rollLogId: string
  characterName: string
  statName: string
  rawRoll: number
  modifier: number
  total: number
  targetDc: number
  outcome: string
}

/**
 * The row as an announcement, or `null` when it is not a roll.
 *
 * `entryType: 'gm_event' | 'combat' | 'action'` rows share the collection and
 * belong in the feed, not in a dice banner. A row missing the numbers it needs
 * (hand-written, or a GM row that never had a d20) is not announced either:
 * `d20(undefined)` is worse than no banner.
 */
export function toAnnouncedRoll(entry: RecordData<RollLogRow>): AnnouncedRoll | null {
  const row = entry.data
  if (row.entryType !== 'roll') return null
  if (typeof row.rawRoll !== 'number' || typeof row.total !== 'number') return null
  if (typeof row.modifier !== 'number' || typeof row.targetDc !== 'number') return null
  if (typeof row.outcome !== 'string' || typeof row.characterName !== 'string') return null

  return {
    rollLogId: entry.recordId,
    characterName: row.characterName,
    statName: typeof row.statName === 'string' ? row.statName : '',
    rawRoll: row.rawRoll,
    modifier: row.modifier,
    total: row.total,
    targetDc: row.targetDc,
    outcome: row.outcome,
  }
}

/**
 * Newest first, by row age then by id.
 *
 * The initial read is already ordered `_created_at DESC`, but a **live insert**
 * arrives appended to the client's array: with a bounded read the store re-runs
 * the query and the order holds, and with the unbounded read the feed uses
 * (`P4.18`) it does not. Without this, a new roll lands at the bottom of a
 * 31-row list and never reaches the five-row window that is meant to show it —
 * and the banner announces the oldest row of a batch instead of the newest.
 *
 * `createdAt` is the record envelope's ISO timestamp (sortable as text, parsed
 * here so a malformed value sorts last rather than first), and a record id is a
 * ULID, so equal timestamps still have a stable, time-ordered tiebreak.
 */
export function newestFirst(
  entries: RecordData<RollLogRow>[],
): RecordData<RollLogRow>[] {
  return [...entries].sort((a, b) => {
    const at = Date.parse(a.createdAt ?? '') || 0
    const bt = Date.parse(b.createdAt ?? '') || 0
    if (at !== bt) return bt - at
    if (a.recordId === b.recordId) return 0
    return a.recordId < b.recordId ? 1 : -1
  })
}

/**
 * Entries this window has not announced yet, in the order given (callers pass
 * `newestFirst`, so the first entry is the newest).
 */
export function unseenRolls(
  entries: RecordData<RollLogRow>[],
  seen: ReadonlySet<string>,
): RecordData<RollLogRow>[] {
  return entries.filter((entry) => !seen.has(entry.recordId))
}
