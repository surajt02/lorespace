/**
 * GM prompts — the automatic turn a resolved roll fires (`P5.7`).
 *
 * Everything the GM receives as a *user* message is built here, so the strings
 * are testable without a socket and the panel stays a container. Two rules ride
 * on that:
 *
 * - **The engine owns the numbers** (ADR 0009). `buildRollBatchPrompt` copies
 *   the `roll-logs` rows — raw die, modifier, total, DC, outcome — and names
 *   each row id, so the GM verifies against the records instead of inventing a
 *   d20.
 * - **Rolls batch, and the server owns the turn** (ADR 0031, amended
 *   2026-11-20). `unresolvedRolls` is only the console's per-window dedupe now:
 *   it decides *when to ask*, while the route decides *what the turn carries*.
 *   One turn covers every roll resolved since the last one, each attributed to
 *   its own roller.
 * - **The GM opens the story** (ADR 0023). `buildOpeningPrompt` is the click's
 *   message, and the only one that is not a reply: it names the act and scene so
 *   the opening narration is attributable to "Start campaign" rather than a
 *   mount timer.
 * - **Combat is narration** (ADR 0024). There is no attack affordance: the
 *   player types what they do and asks what to roll. The chat is the interface,
 *   so an action is prose, never a one-click button.
 * - **Attribution is not in the text** (`P5.20`). The console sends the speaker's
 *   name as its own field on `POST /api/gm/chat`; the route prefixes the model's
 *   copy and the panel labels the row from `characterName`. So no builder here
 *   writes `"Name: "` — a prompt that did would reach the model as
 *   `"Ash: Ash inspects the room"`.
 *
 * Pure: no React, no network, no clock.
 */

import type { RecordData } from 'deepspace'
import type { AbilityScoreKey } from '@/lib/party-presence'
import { formatModifier } from '@/lib/d20'
import type { RollLogRow } from '@/lib/preview-data'
import { newestFirst } from '@/lib/roll-announcements'

/** `critical_failure` → `critical failure`. The row's own word, unembellished. */
function outcomeWords(outcome: string): string {
  return outcome.replace(/_/g, ' ')
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
    'This first turn sets the scene and nothing else: describe where the party is, what they can see, what they can hear and what waits for them, in three or four sentences.',
    'Do not call request_check, do not ask anyone for a roll, do not resolve an action and do not write to any record - this turn is the world before the players touch it.',
    'End by asking the party what they do.',
  ].join(' ')
}


/**
 * One roll as the route selects it out of `roll-logs`: the row id to verify
 * against, and the numbers the GM must not recompute. Fields are optional
 * because a hand-edited row can be missing them; a missing number reads as `0`
 * rather than printing `undefined` at the table.
 */
export interface RollBatchRow {
  recordId: string
  data: {
    characterName?: string
    statName?: string
    rawRoll?: number
    modifier?: number
    total?: number
    targetDc?: number
    outcome?: string
  }
}

/** A number from a row that may not carry one. */
function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * One roll turn for **every** roll resolved since the previous one (ADR 0031,
 * amended 2026-11-20).
 *
 * The turn is built on the server from `roll-logs`, not by whichever window saw
 * the row first, so two open windows cannot produce two turns and a batch is
 * never split across replies. Each line names its roller and its row id, so the
 * same roll is attributed the same way every time, and the instruction is
 * explicit that a character absent from the list is not part of this turn —
 * that is the rule that stopped one player's roll advancing another's position.
 *
 * Not buildable from an empty batch: a turn with no rolls would be a turn with
 * nothing to resolve, so the caller answers `202` instead of calling this.
 */
export function buildRollBatchPrompt(rows: RollBatchRow[]): string {
  const lines = rows.map((row, index) => {
    const data = row.data
    const name = data.characterName?.trim() || 'An unnamed adventurer'
    const stat = data.statName?.trim() ? data.statName.trim().toUpperCase() : 'CHECK'
    const outcome = data.outcome?.trim() ? outcomeWords(data.outcome.trim()) : 'info'
    return `${index + 1}. ${name} — ${stat} d20(${asNumber(data.rawRoll)}) ${formatModifier(asNumber(data.modifier))} = ${asNumber(data.total)} vs DC ${asNumber(data.targetDc)} — ${outcome} (roll-logs row ${row.recordId})`
  })
  const rolls = rows.length === 1 ? 'One roll resolved' : `${rows.length} rolls resolved`
  return [
    `${rolls} since your last turn:`,
    ...lines,
    'Narrate each roll separately, in the order listed, and attribute it to its own roller only.',
    'Verify each one against its `roll-logs` row; do not roll again and do not invent a result.',
    'Apply each consequence in this turn with one write tool per roll — `damage_enemy` on a hit,',
    '`modify_character_hp` on a miss — then narrate what the table sees.',
    'Never narrate, resolve or advance a character whose roll is not listed here.',
  ].join('\n')
}

/**
 * The rolls this window still owes the GM a turn, newest first.
 *
 * The console's dedupe (`P5.7`, ADR 0031 amended): it reports the rows this
 * window has not yet asked about, so a reprocessed snapshot does not spam the
 * route and a reload does not re-ask for history. What the turn *contains* is
 * the route's decision now — this only says "there may be something new".
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

// ============================================================================
// The check the GM asked for without recording it
// ============================================================================

/** Ability words, as prose writes them. Abbreviations first, long forms too. */
const STAT_WORDS: readonly [AbilityScoreKey, RegExp][] = [
  ['str', /\b(str|strength)\b/i],
  ['dex', /\b(dex|dexterity)\b/i],
  ['con', /\b(con|constitution)\b/i],
  ['int', /\b(int|intelligence)\b/i],
  ['wis', /\b(wis|wisdom)\b/i],
  ['cha', /\b(cha|charisma)\b/i],
]

/**
 * Did the GM ask for a roll at all?
 *
 * Past-tense narration is excluded: "you rolled WIS" recaps a roll that already
 * happened, and treating it as a request would fire a pointless corrective turn
 * after every resolved check.
 */
export function requestsRoll(text: string): boolean {
  if (/\brolled\b/i.test(text)) return false
  return /\b(roll|rolls|rolling|check|test|save)\b/i.test(text)
}

/**
 * The one ability the GM named while asking for a roll, or `null`.
 *
 * This is the safety valve for a model that narrates a roll without calling
 * `request_check`: the sheet enables exactly that stat so the table cannot be
 * stranded, and the console sends one corrective beat. It reads the *last*
 * requesting sentence only, and returns `null` when that sentence names more
 * than one ability — guessing between two would enable the wrong roll.
 */
export function statNamedInText(text: string): AbilityScoreKey | null {
  if (/\brolled\b/i.test(text)) return null
  const sentences = text.split(/(?<=[.!?])\s+/)
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    const sentence = sentences[i]
    if (!requestsRoll(sentence)) continue
    const found = STAT_WORDS.filter(([, pattern]) => pattern.test(sentence))
    return found.length === 1 ? found[0][0] : null
  }
  return null
}

/**
 * One corrective beat, sent when the GM asks for a roll it never registered.
 * The gate is absolute (`rollSkillCheck` refuses anything unrequested), so the
 * only fix is to make the request real — never to loosen the gate. The check
 * lives on the character's own row (ADR 0030), so the beat also says to leave a
 * check that is already owed alone rather than re-arming it.
 */
export function buildCheckFixPrompt(stat: AbilityScoreKey, characterName: string): string {
  const name = characterName.trim()
  const who = name === '' ? 'the acting character' : name
  return `You asked ${who} to roll ${stat.toUpperCase()} but their sheet shows no check open, so the table cannot roll and the story has stopped. Call request_check for ${who} with stat ${JSON.stringify(stat)} and the DC you intended. If that check is already owed on their row, it is live — do not re-arm it or change its DC. Do not narrate: do not repeat, continue or re-describe the scene or your previous message. The tool call is the whole reply.`
}

/**
 * Did another window already fire this exact roll batch? (`P5.40`)
 *
 * The cursor claim is read-then-write, and the record room has no
 * compare-and-set, so two windows can both read the same fresh rolls and both
 * stream a turn. This is the cheap second line of defence: the batch prompt is
 * deterministic, so an identical beat written moments ago means someone else is
 * already narrating it.
 */
export function isDuplicateRollBatch({
  prompt,
  previousContent,
  previousAgeMs,
  windowMs = 10_000,
}: {
  prompt: string
  previousContent: string | null | undefined
  previousAgeMs: number | null
  windowMs?: number
}): boolean {
  if (typeof previousContent !== 'string') return false
  if (previousContent.trim() !== prompt.trim()) return false
  if (previousAgeMs === null || !Number.isFinite(previousAgeMs)) return false
  return previousAgeMs >= 0 && previousAgeMs <= windowMs
}

/**
 * The `CONTINUE` button's move (`P5.43`).
 *
 * A player who has nothing to add still has to act for the round to close. Rather
 * than typing "I wait to see the result" every time, one click sends this — a real
 * player turn, so it marks the round and the GM answers the batch. First person
 * and in-world, like every other move; the route attributes it by field.
 */
export function buildContinuePrompt(): string {
  return 'I hold back and watch what happens.'
}
