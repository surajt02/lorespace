/**
 * The one pending check, as the client reads it (`P5.19`, `P5.20`).
 *
 * The GM asks for a check through `request_check`, which stores it on the
 * campaign row (`pendingCharacterId` / `pendingStat` / `pendingDc`). That row is
 * the single source: the sheet cannot highlight a stat the engine did not
 * record, and it cannot enable one the engine would refuse. `rollSkillCheck`
 * enforces the same rule on the server, so this module is the *display* half of
 * one decision, not a second opinion.
 *
 * Tolerance matches the action (`pendingCheckOf`): a half-written row — an
 * unknown ability key, a non-positive or non-finite DC — is "nothing pending"
 * rather than an unsatisfiable gate. A row a player cannot satisfy is worse than
 * a row nobody set.
 *
 * Pure: no React, no SDK, no network.
 */

import type { AbilityScoreKey } from '@/lib/party-presence'

/** The one check the GM has asked for and the table has not rolled yet. */
export interface PendingCheck {
  /** `''` when the request does not name a character; any caller may then roll it. */
  characterId: string
  stat: AbilityScoreKey
  dc: number
}

/**
 * The `campaigns` columns a pending check occupies. A live row carries them, but
 * `CampaignRow` predates them (they are additive), so the reader takes `unknown`
 * and validates every field — a hand-edited row must not become a gate no player
 * can satisfy.
 */
export interface PendingSource {
  pendingCharacterId?: unknown
  pendingStat?: unknown
  pendingDc?: unknown
}

/** The six ability keys, in schema order — `campaigns.pendingStat`'s options. */
const ABILITY_KEYS: readonly AbilityScoreKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbilityKey(value: unknown): value is AbilityScoreKey {
  return typeof value === 'string' && (ABILITY_KEYS as readonly string[]).includes(value)
}

/**
 * The campaign row's pending check, or `null` when nothing is pending.
 *
 * A campaign that is missing, `null`, or half-written reads as "nothing
 * pending": the sheet then shows the scene's DC and no stat is highlighted,
 * exactly as it did before the gate existed.
 */
export function pendingOf(campaign: unknown): PendingCheck | null {
  if (!isRecord(campaign)) return null
  const row = campaign as PendingSource
  if (!isAbilityKey(row.pendingStat)) return null
  const dc = row.pendingDc
  if (typeof dc !== 'number' || !Number.isFinite(dc) || dc < 1) return null
  return {
    characterId:
      typeof row.pendingCharacterId === 'string' ? row.pendingCharacterId.trim() : '',
    stat: row.pendingStat,
    dc,
  }
}

/**
 * The number the banner shows: the pending check's own DC while a roll is owed,
 * the scene's baseline otherwise. This is what makes a risky jump (17) and a
 * heavy lever (12) different numbers inside one scene.
 */
export function dcDisplay(pending: PendingCheck | null, sceneDc: number): number {
  return pending ? pending.dc : sceneDc
}

export type StatCardState = 'rollable' | 'waiting-self' | 'waiting-other'

/**
 * What one stat card may do right now.
 *
 * `rollable` is the pending stat of the character the check belongs to (or of
 * any character, when the request named none). That character's other stats are
 * `waiting-self`; every other character's sheet — and every sheet, when nothing
 * is pending — is `waiting-other`, i.e. inert. The table can only roll what the
 * GM asked for, which is also all `rollSkillCheck` will accept.
 */
export function statCardState({
  pending,
  characterId,
  stat,
}: {
  pending: PendingCheck | null
  characterId: string
  stat: AbilityScoreKey
}): StatCardState {
  if (!pending) return 'waiting-other'
  if (pending.characterId !== '' && pending.characterId !== characterId) return 'waiting-other'
  return pending.stat === stat ? 'rollable' : 'waiting-self'
}

/**
 * A short line for the sheet: what the table is waiting on.
 *
 * `characterName` is the name the check belongs to, when the caller knows it —
 * the panel only holds the viewer's own row, so it passes nothing while the
 * viewer is the one rolling ("Roll DEX against 14") and a stand-in when the
 * check belongs to someone else ("Another adventurer must roll DEX").
 */
export function pendingLabel(pending: PendingCheck | null, characterName?: string): string {
  if (!pending) return 'Waiting on the GM…'
  const stat = pending.stat.toUpperCase()
  const name = characterName?.trim() ?? ''
  if (name.length > 0) return `${name} must roll ${stat}`
  return `Roll ${stat} against ${pending.dc}`
}
