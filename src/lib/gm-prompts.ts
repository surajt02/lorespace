/**
 * GM prompts — the four quick chips and the automatic turn a resolved roll
 * fires (`P5.7`).
 *
 * Everything the GM receives as a *user* message is built here, so the strings
 * are testable without a socket and the panel stays a container. Two rules ride
 * on that:
 *
 * - **The engine owns the numbers** (ADR 0009). `buildRollPrompt` copies the
 *   `roll-logs` row — raw die, modifier, total, DC, outcome — and names the row
 *   id, so the GM verifies against the record instead of inventing a d20.
 * - **One automatic turn per roll** (ADR 0012). `unresolvedRolls` is the whole
 *   cap: it reports rows this window has not announced, and the panel marks
 *   every unseen id as announced when it sends, so a burst collapses to one turn
 *   and a row never fires twice.
 *
 * Pure: no React, no network, no clock.
 */

import type { RecordData } from 'deepspace'
import { formatModifier } from '@/lib/d20'
import type { RollLogRow } from '@/lib/preview-data'
import { newestFirst } from '@/lib/roll-announcements'

/** The four chips, in reading order. */
export type GmChipKind = 'inspect' | 'resolve' | 'attack' | 'rest'

export interface GmChip {
  kind: GmChipKind
  label: string
}

/**
 * Chip labels double as the panel's empty-state prompts, so they stay in the
 * table's voice: an action the player takes, not a feature name.
 */
export const GM_CHIPS: readonly GmChip[] = [
  { kind: 'inspect', label: 'Inspect the room' },
  { kind: 'resolve', label: 'Resolve my latest roll' },
  { kind: 'attack', label: 'Attack the active enemy' },
  { kind: 'rest', label: 'Take a short rest' },
]

export interface QuickPromptContext {
  /** The viewer's character name, when they have a sheet. */
  characterName?: string | null
  /** The viewer's newest `roll-logs` roll row, when one exists. */
  latestRoll?: RollLogRow | null
}

/** `critical_failure` → `critical failure`. The row's own word, unembellished. */
function outcomeWords(outcome: string): string {
  return outcome.replace(/_/g, ' ')
}

/**
 * `d20(14) + 3 = 17 vs DC 12 — success`. The one roll sentence both the chip
 * and the automatic turn carry, so the GM reads the same shape either way.
 */
function rollLine(row: RollLogRow): string {
  const stat = row.statName ? row.statName.toUpperCase() : 'check'
  return `${stat} d20(${row.rawRoll}) ${formatModifier(row.modifier)} = ${row.total} vs DC ${row.targetDc} — ${outcomeWords(row.outcome)}`
}

/**
 * A chip, as the message the GM receives.
 *
 * The character name prefixes the line when the viewer has a sheet; without one
 * the line simply starts with the action, because a placeholder like
 * `undefined inspects the room` is worse than no attribution. `resolve` and
 * `attack` carry the newest roll when there is one and say plainly that there
 * is not when there isn't — asking the GM to verify a roll it was never given is
 * exactly the fabrication ADR 0009 forbids.
 */
export function buildQuickPrompt(
  kind: GmChipKind,
  { characterName, latestRoll }: QuickPromptContext = {},
): string {
  const name = characterName?.trim() ?? ''
  const prefix = name.length > 0 ? `${name}: ` : ''
  const roll = latestRoll ?? null
  const rollSuffix = roll ? `\nMy latest roll: ${rollLine(roll)}.` : ''
  const noRollSuffix =
    '\nNo roll of mine is on the log yet — call for the check first, then verify it in roll-logs.'

  switch (kind) {
    case 'inspect':
      return `${prefix}inspect the room — what is here, and what is watching?`
    case 'resolve':
      return `${prefix}resolve my latest roll.${roll ? rollSuffix : noRollSuffix}`
    case 'attack':
      return `${prefix}attack the active enemy.${roll ? rollSuffix : noRollSuffix}`
    case 'rest':
      return `${prefix}take a short rest — what does the party recover, and what happens while we rest?`
  }
}

/**
 * The automatic turn after a resolved roll (`P5.7`, ADR 0012).
 *
 * Carries the human line and a compact JSON payload with the five numbers the
 * GM must not recompute: `rawRoll`, `modifier`, `total`, `targetDc`, `outcome`.
 * The row id is named in the sentence so the GM can read the same row back out
 * of `roll-logs`.
 */
export function buildRollPrompt(row: RecordData<RollLogRow>): string {
  const data = row.data
  const payload = JSON.stringify({
    rawRoll: data.rawRoll,
    modifier: data.modifier,
    total: data.total,
    targetDc: data.targetDc,
    outcome: data.outcome,
  })
  return [
    `${data.characterName} rolls ${rollLine(data)}.`,
    `Resolve it from the roll-logs row ${row.recordId}; do not roll again and do not invent a result.`,
    `Roll payload: ${payload}`,
  ].join('\n')
}

/**
 * The rolls this window still owes the GM a turn, newest first.
 *
 * Only `entryType: 'roll'` rows: a `combat` or `gm_event` row is the GM's own
 * evidence and must not trigger a turn. `announced` is the caller's memory — it
 * is read, never mutated, so the panel decides when a row counts as handled.
 */
export function unresolvedRolls(
  rows: RecordData<RollLogRow>[],
  announced: ReadonlySet<string>,
): RecordData<RollLogRow>[] {
  return newestFirst(rows).filter(
    (row) => row.data.entryType === 'roll' && !announced.has(row.recordId),
  )
}
