/**
 * Party presence — the guard and join between an ephemeral presence payload and
 * the durable `characters` rows (`P4.1`, `P4.3`, `P4.5`).
 *
 * Presence is the one place a browser sends state about itself, so nothing that
 * arrives over the socket is trusted: `peerCharacterId` validates the one key
 * this build reads. The payload carries **identity only** (`characterId`,
 * `characterName`, `archetype`) — HP always comes from the `characters` query
 * row, which is already live through the record room, so a peer cannot claim a
 * different hit-point total (`P4.5`), and a roll never travels this way at all
 * (the banner reads the `roll-logs` row, ADR 0021).
 *
 * Pure: no React, no DOM, no network, no clock.
 */

import { isAnonymousUserId, type RecordData } from 'deepspace'
import type { AbilityScores } from '@/lib/d20'
import type { CharacterRow } from '@/lib/preview-data'

/** The six stat cards, as keys. */
export type AbilityScoreKey = keyof AbilityScores

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * The one key this build reads out of a peer's payload: which `characters` row
 * to render for them. A peer that broadcasts a different shape, an empty id, or
 * nothing at all is present but has no sheet (`hasCharacter: false`) — never a
 * partially rendered member.
 */
export function peerCharacterId(state: Record<string, unknown>): string | null {
  if (!isRecord(state)) return null
  return isNonEmptyString(state.characterId) ? state.characterId : null
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

    const characterId = peerCharacterId(peer.state)
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
