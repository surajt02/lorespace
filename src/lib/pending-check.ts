/**
 * One character's pending check, as the client reads it (`P5.19`, `P5.20`,
 * `P5.31`).
 *
 * The GM asks for a check through `request_check`, which stores it on **that
 * character's row** (`pendingStat` / `pendingDc`, ADR 0030). The row is the
 * single source: the sheet cannot highlight a stat the engine did not record,
 * and it cannot enable one the engine would refuse. `rollSkillCheck` enforces
 * the same rule on the server from the same row, so this module is the *display*
 * half of one decision, not a second opinion.
 *
 * Because the row IS the character, a pending check addressed to someone else is
 * invisible here: two players can owe a roll at once and neither can block or
 * overwrite the other. The panel only ever calls this with the viewer's own row.
 *
 * Tolerance matches the action (`pendingCheckOf`): a half-written row — an
 * unknown ability key, a non-positive or non-finite DC — is "nothing pending"
 * rather than an unsatisfiable gate. A row a player cannot satisfy is worse than
 * a row nobody set.
 *
 * Pure: no React, no SDK, no network.
 */

import type { AbilityScoreKey } from '@/lib/party-presence'

/** The check one character owes and has not rolled yet. */
export interface PendingCheck {
  stat: AbilityScoreKey
  dc: number
}

/**
 * The `characters` columns a pending check occupies. A live row carries them,
 * but `CharacterRow` treats them as optional (the columns are additive), so the
 * reader takes `unknown` and validates every field — a hand-edited row must not
 * become a gate no player can satisfy.
 */
export interface PendingSource {
  pendingStat?: unknown
  pendingDc?: unknown
}

/** The six ability keys, in schema order — `characters.pendingStat`'s options. */
const ABILITY_KEYS: readonly AbilityScoreKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbilityKey(value: unknown): value is AbilityScoreKey {
  return typeof value === 'string' && (ABILITY_KEYS as readonly string[]).includes(value)
}

/**
 * One character row's pending check, or `null` when nothing is pending.
 *
 * A row that is missing, `null`, or half-written reads as "nothing pending": the
 * sheet then shows the scene's DC and no stat is highlighted, exactly as it did
 * before the gate existed.
 */
export function pendingOf(character: unknown): PendingCheck | null {
  if (!isRecord(character)) return null
  const row = character as PendingSource
  if (!isAbilityKey(row.pendingStat)) return null
  const dc = row.pendingDc
  if (typeof dc !== 'number' || !Number.isFinite(dc) || dc < 1) return null
  return { stat: row.pendingStat, dc }
}

/**
 * The number the banner shows: the pending check's own DC while a roll is owed,
 * the scene's baseline otherwise. This is what makes a risky jump (17) and a
 * heavy lever (12) different numbers inside one scene.
 */
export function dcDisplay(pending: PendingCheck | null, sceneDc: number): number {
  return pending ? pending.dc : sceneDc
}

export type StatCardState = 'rollable' | 'waiting'

/**
 * What one of the viewer's stat cards may do right now.
 *
 * `rollable` is exactly the pending stat on this sheet; every other card —
 * including all six when nothing is pending — is `waiting`, i.e. inert. That is
 * all `rollSkillCheck` will accept from this character, and another character's
 * check never dims these cards, because it lives on their row, not this one.
 */
export function statCardState({
  pending,
  stat,
  fallbackStat = null,
}: {
  pending: PendingCheck | null
  stat: AbilityScoreKey
  /**
   * The ability the GM last named without registering a check (`P5.19`). A model
   * that narrates "roll WIS" without calling `request_check` would otherwise
   * strand the table with every card inert, so that one stat stays rollable and
   * resolves at the scene DC. It never overrides a real pending check.
   */
  fallbackStat?: AbilityScoreKey | null
}): StatCardState {
  if (!pending) return fallbackStat === stat ? 'rollable' : 'waiting'
  return pending.stat === stat ? 'rollable' : 'waiting'
}

/**
 * A short line for the sheet: what this character is waiting on.
 *
 * The panel only holds the viewer's own row, so the pending form is always an
 * instruction to them ("Roll DEX against 14"); there is no "another adventurer
 * must roll" line any more, because that check is on that adventurer's sheet.
 */
export function pendingLabel(
  pending: PendingCheck | null,
  fallbackStat?: AbilityScoreKey | null,
): string {
  if (!pending) {
    return fallbackStat ? `The GM asked for ${fallbackStat.toUpperCase()} — roll it` : 'Waiting on the GM…'
  }
  return `Roll ${pending.stat.toUpperCase()} against ${pending.dc}`
}
