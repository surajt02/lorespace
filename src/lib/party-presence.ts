/**
 * Party presence — the guard and join between an ephemeral presence payload and
 * the durable `characters` rows (`P4.1`, `P4.3`, `P4.5`).
 *
 * Presence is the one place a browser sends state about itself, so nothing that
 * arrives over the socket is trusted: `parsePresenceState` validates every field
 * and drops a malformed `lastRoll` rather than letting half a payload render.
 * The payload carries **identity only** (`characterId`, `characterName`,
 * `archetype`, optionally the last roll) — HP always comes from the `characters`
 * query row, which is already live through the record room, so a peer cannot
 * claim a different hit-point total (`P4.5`).
 *
 * Pure: no React, no DOM, no network, no clock. `freshRolls` takes `mountedAt`
 * from the caller so a roll older than this mount is never announced — a peer
 * joining mid-session does not replay history, and `updateState` merging means
 * `lastRoll` outlives the roll itself.
 */

import { isAnonymousUserId, type RecordData } from 'deepspace'
import type { AbilityScores, RollOutcome } from '@/lib/d20'
import type { CharacterRow } from '@/lib/preview-data'

/** The six stat cards, as keys. */
export type AbilityScoreKey = keyof AbilityScores

/**
 * The roll half of the presence payload: the action's authoritative numbers,
 * plus the id of the `roll-logs` row they were written to and when the client
 * announced them.
 */
export type PresenceRoll = {
  rollLogId: string
  statName: AbilityScoreKey
  rawRoll: number
  modifier: number
  total: number
  targetDc: number
  outcome: RollOutcome
  at: number
}

/** One row of the roster: a person at the table, joined to their character. */
export interface PartyMember {
  userId: string
  name: string
  archetype: string
  hp: number
  maxHp: number
  isSelf: boolean
  hasCharacter: boolean
}

/** What a peer without a resolvable character row renders as. */
const NO_ADVENTURER = 'No adventurer'

const ABILITY_SCORE_KEYS: readonly AbilityScoreKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']

const ROLL_OUTCOMES: readonly RollOutcome[] = [
  'critical_success',
  'success',
  'failure',
  'critical_failure',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isAbilityScoreKey(value: unknown): value is AbilityScoreKey {
  return isNonEmptyString(value) && (ABILITY_SCORE_KEYS as readonly string[]).includes(value)
}

function isRollOutcome(value: unknown): value is RollOutcome {
  return isNonEmptyString(value) && (ROLL_OUTCOMES as readonly string[]).includes(value)
}

/** A whole `lastRoll`, or `null` — never a partially filled one. */
function parseRoll(value: unknown): PresenceRoll | null {
  if (!isRecord(value)) return null
  const { rollLogId, statName, rawRoll, modifier, total, targetDc, outcome, at } = value
  if (!isNonEmptyString(rollLogId)) return null
  if (!isAbilityScoreKey(statName)) return null
  if (!isRollOutcome(outcome)) return null
  if (
    !isFiniteNumber(rawRoll) ||
    !isFiniteNumber(modifier) ||
    !isFiniteNumber(total) ||
    !isFiniteNumber(targetDc) ||
    !isFiniteNumber(at)
  ) {
    return null
  }
  return { rollLogId, statName, rawRoll, modifier, total, targetDc, outcome, at }
}

/**
 * The presence payload, guarded. A bad `characterId` does not poison a good
 * `lastRoll` and vice versa: each half is validated on its own, so a peer with a
 * broken roll still shows as a member (and one with no character still counts as
 * present).
 */
export function parsePresenceState(state: Record<string, unknown>): {
  characterId: string | null
  lastRoll: PresenceRoll | null
} {
  return {
    characterId: isNonEmptyString(state.characterId) ? state.characterId : null,
    lastRoll: parseRoll(state.lastRoll),
  }
}

/**
 * The roster: self first from `myCharacter`, then peers in the order presence
 * sent them.
 *
 * Self cannot come from `peers` — the SDK excludes self and clears the list on
 * connect and on every reconnect, so a peer-derived roster would flash empty. A
 * peer is skipped when the id is anonymous (`anon-…`, a signed-out visitor on a
 * preview scope) or already listed, and joined to a `characters` row through
 * `state.characterId`. A peer whose character is not readable is shown, not
 * hidden: they are present, they just have no sheet yet.
 */
export function buildParty({
  peers,
  characters,
  myCharacter,
  myUserId,
}: {
  peers: { userId: string; state: Record<string, unknown> }[]
  characters: RecordData<CharacterRow>[]
  myCharacter: RecordData<CharacterRow> | null
  myUserId: string
}): PartyMember[] {
  const members: PartyMember[] = []
  const listed = new Set<string>()

  if (myCharacter) {
    members.push({
      userId: myUserId,
      name: myCharacter.data.name,
      archetype: myCharacter.data.archetype,
      // HP from the row, never from a payload (P4.5).
      hp: myCharacter.data.hp,
      maxHp: myCharacter.data.maxHp,
      isSelf: true,
      hasCharacter: true,
    })
    listed.add(myUserId)
  }

  for (const peer of peers) {
    if (isAnonymousUserId(peer.userId)) continue
    if (listed.has(peer.userId)) continue
    listed.add(peer.userId)

    const { characterId } = parsePresenceState(peer.state)
    const row =
      characterId === null
        ? undefined
        : characters.find((record) => record.recordId === characterId)

    if (!row) {
      members.push({
        userId: peer.userId,
        name: NO_ADVENTURER,
        archetype: '',
        hp: 0,
        maxHp: 0,
        isSelf: false,
        hasCharacter: false,
      })
      continue
    }

    members.push({
      userId: peer.userId,
      name: row.data.name,
      archetype: row.data.archetype,
      hp: row.data.hp,
      maxHp: row.data.maxHp,
      isSelf: false,
      hasCharacter: true,
    })
  }

  return members
}

/**
 * Rolls worth announcing, newest first.
 *
 * `seen` is the caller's memory across renders and is mutated here: every
 * announced `rollLogId` is added, so a roll flashes once even though the payload
 * keeps carrying it. `mountedAt` is the mount's epoch ms — a `lastRoll` at or
 * before it predates this session and is silently skipped.
 */
export function freshRolls({
  peers,
  mountedAt,
  seen,
}: {
  peers: { userId: string; state: Record<string, unknown> }[]
  mountedAt: number
  seen: Set<string>
}): { userId: string; roll: PresenceRoll }[] {
  const fresh: { userId: string; roll: PresenceRoll }[] = []

  for (const peer of peers) {
    if (isAnonymousUserId(peer.userId)) continue
    const { lastRoll } = parsePresenceState(peer.state)
    if (!lastRoll) continue
    if (lastRoll.at <= mountedAt) continue
    if (seen.has(lastRoll.rollLogId)) continue

    seen.add(lastRoll.rollLogId)
    fresh.push({ userId: peer.userId, roll: lastRoll })
  }

  return fresh.sort((a, b) => b.roll.at - a.roll.at)
}
