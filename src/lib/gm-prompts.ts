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
 * - **The GM opens the story** (ADR 0023). `buildOpeningPrompt` is the click's
 *   message, and the only one that is not a reply: it names the act and scene so
 *   the opening narration is attributable to "Start campaign" rather than a
 *   mount timer.
 * - **Combat is narration** (ADR 0024). The `attack` chip writes the sentence a
 *   player would say — first person, naming the enemy, asking what to roll —
 *   instead of ordering an attack. The chat is the interface, so the chip is a
 *   writer of prose, not an action.
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
  /** The campaign's current enemy (`campaigns.enemyName`), when one is on the table. */
  enemyName?: string | null
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
 * `undefined inspects the room` is worse than no attribution. `resolve` carries
 * the newest roll when there is one and says plainly that there is not when
 * there isn't — asking the GM to verify a roll it was never given is exactly the
 * fabrication ADR 0009 forbids.
 *
 * `attack` is narration, not an order (ADR 0024): the player says what they do
 * in the first person and asks what to roll, and the GM answers with a DC. There
 * is deliberately no dice line — the check has not been called yet, and the
 * resolved roll arrives as its own automatic turn.
 */
export function buildQuickPrompt(
  kind: GmChipKind,
  { characterName, latestRoll, enemyName }: QuickPromptContext = {},
): string {
  const name = characterName?.trim() ?? ''
  const prefix = name.length > 0 ? `${name}: ` : ''
  const roll = latestRoll ?? null
  const rollSuffix = roll ? `\nMy latest roll: ${rollLine(roll)}.` : ''
  const noRollSuffix =
    '\nNo roll of mine is on the log yet — call for the check first, then verify it in roll-logs.'
  const enemy = enemyName?.trim() ?? ''

  switch (kind) {
    case 'inspect':
      return `${prefix}inspect the room — what is here, and what is watching?`
    case 'resolve':
      return `${prefix}resolve my latest roll.${roll ? rollSuffix : noRollSuffix}`
    case 'attack':
      return `${prefix}I move to strike ${enemy.length > 0 ? enemy : 'the enemy'} — set the stakes and tell me what to roll.`
    case 'rest':
      return `${prefix}take a short rest — what does the party recover, and what happens while we rest?`
  }
}

/**
 * The opening turn "Start campaign" sends (ADR 0023, `P5.17`).
 *
 * One user message that puts the GM at the top of the arc: it reads the record
 * and the party, narrates the scene, and stops where a story actually needs the
 * table — at the first decision or check. It names the act and scene from the
 * engine's label (`progressLabel`), so the GM opens where the row says the table
 * is, not where the model guesses it is.
 *
 * It must never contain a dice result: no roll has happened, and the whole point
 * of the boundary (ADR 0005, ADR 0009) is that the numbers come from
 * `roll-logs`. `announce` is the only thing the GM does for free here.
 */
export function buildOpeningPrompt(progress: string, sceneTitle?: string): string {
  const where = progress.trim().length > 0 ? progress.trim() : 'the opening scene'
  const title = sceneTitle?.trim() ?? ''
  const named = title.length > 0 ? ` (${title})` : ''
  return [
    `Begin the campaign at ${where}${named}.`,
    'Read the campaigns row and the party before you speak: the location, the atmosphere, the scene summary, the active DC and the character sheets.',
    'Narrate where the party is, what they can see and what is at stake in three or four sentences, then stop and say what the first decision or check is.',
    'Do not roll for anyone and do not state a dice result — the players roll, and you verify it in roll-logs.',
  ].join(' ')
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
    `This is the resolution of the check you asked ${data.characterName} for: attribute it to ${data.characterName}, not to another sheet.`,
    'Apply its consequence in this turn with one write tool — `damage_enemy` on a hit,',
    `\`modify_character_hp\` on a miss — and then narrate what the table sees.`,
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
