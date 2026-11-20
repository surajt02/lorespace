/**
 * Round pacing (ADR 0031) — the engine's half of "the GM stages the table".
 *
 * "Waiting for each player" is a fact about state, not a tone of voice, so the
 * round lives in two columns: `campaigns.roundNumber` is the round, and
 * `characters.actedRound` is the last round that character acted in. A player's
 * turn stamps their own row **before** the model is called, so the snapshot the
 * GM reads already shows this speaker as done; when every character who is at
 * the table has acted, the round increments and the GM stages the next one in
 * the same reply.
 *
 * Three rules this file keeps:
 *
 * 1. **Only a real player's turn marks anything.** An engine beat (the opening,
 *    the turn after a resolved roll) and a transient correction are speech from
 *    the app, not an action by a character, so neither advances a round.
 * 2. **The table is who is online** (ADR 0029). The panel reports the online
 *    character names with every turn; a character whose owner is not connected
 *    cannot hold a round open. With no usable list the round falls back to the
 *    caller alone — single-player, where every turn closes its round.
 * 3. **Bookkeeping never costs a player their message.** Every read and write
 *    here logs and returns; nothing throws across the route.
 */

import type { ActionTools } from 'deepspace/worker'
import { DEFAULT_CAMPAIGN_ID } from '../constants.js'

/** Characters read to find the caller and the online party; no table is larger. */
const ROSTER_LIMIT = 200

/** The record tools this module needs — the owner-credential ones the route has. */
type RoundTools = Pick<ActionTools, 'query' | 'update'>

export interface RoundTurn {
  /** The verified caller, matched against `characters.userId`. */
  userId: string
  /** Characters the panel reports as online, plus the speaker. */
  onlineCharacterNames?: readonly string[]
  /** False for a synthetic beat or a transient correction. */
  playerTurn: boolean
}

export type RoundOutcome =
  | { marked: false; reason: 'not_a_player_turn' | 'no_character' | 'read_failed' | 'write_failed' }
  | { marked: true; roundNumber: number; nextRound: number }

/** The character columns this module reads, as the record room returns them. */
interface CharacterRoundData {
  [key: string]: unknown
  userId?: unknown
  name?: unknown
  actedRound?: unknown
}

/** One row at the table: the id to write, and the three fields the round needs. */
interface CharacterRoundRow {
  recordId: string
  userId: unknown
  name: unknown
  actedRound: unknown
}

/** A missing or hand-edited number reads as the column's default. */
function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function rowName(row: CharacterRoundRow): string {
  return typeof row.name === 'string' ? row.name.trim().toLowerCase() : ''
}

/**
 * The rows at the table this turn: those the panel reported as online, always
 * including the caller — they just acted, so they are here by definition. An
 * empty or absent list is the caller-only case (single-player).
 */
function onlineRows(
  rows: CharacterRoundRow[],
  caller: CharacterRoundRow,
  names?: readonly string[],
): CharacterRoundRow[] {
  const wanted = new Set(
    (names ?? []).map((name) => name.trim().toLowerCase()).filter((name) => name.length > 0),
  )
  if (wanted.size === 0) return [caller]
  const online = rows.filter((row) => wanted.has(rowName(row)))
  return online.some((row) => row.recordId === caller.recordId) ? online : [...online, caller]
}

/**
 * Marks the caller as having acted in the campaign's current round, then rolls
 * the round over when everyone at the table has acted.
 *
 * The order is load-bearing: the mark lands first, so the snapshot the GM is
 * about to read shows this character as done — and the rollover sees the mark,
 * so a single-player turn closes its round rather than leaving it open.
 */
export async function recordRoundTurn(
  tools: RoundTools,
  turn: RoundTurn,
): Promise<RoundOutcome> {
  if (!turn.playerTurn) return { marked: false, reason: 'not_a_player_turn' }

  let roster
  try {
    roster = await tools.query<CharacterRoundData>('characters', {
      where: { campaignId: DEFAULT_CAMPAIGN_ID },
      limit: ROSTER_LIMIT,
    })
  } catch (error) {
    console.error(`[round] roster read threw: ${String(error)}`)
    return { marked: false, reason: 'read_failed' }
  }
  if (!roster.success) {
    console.error(`[round] roster read failed: ${roster.error}`)
    return { marked: false, reason: 'read_failed' }
  }
  const rows: CharacterRoundRow[] = roster.data.records.map((record) => ({
    recordId: record.recordId,
    userId: record.data?.userId,
    name: record.data?.name,
    actedRound: record.data?.actedRound,
  }))
  const caller = rows.find((row) => row.userId === turn.userId)
  if (!caller) {
    // No sheet, no round: the caller may be a viewer reading the table.
    console.warn(`[round] no character for caller ${turn.userId}`)
    return { marked: false, reason: 'no_character' }
  }

  let campaign
  try {
    campaign = await tools.query<{ roundNumber?: unknown }>('campaigns', {
      where: { recordId: DEFAULT_CAMPAIGN_ID },
      limit: 1,
    })
  } catch (error) {
    console.error(`[round] campaign read threw: ${String(error)}`)
    return { marked: false, reason: 'read_failed' }
  }
  if (!campaign.success) {
    console.error(`[round] campaign read failed: ${campaign.error}`)
    return { marked: false, reason: 'read_failed' }
  }
  const roundNumber = asNumber(campaign.data.records[0]?.data?.roundNumber, 1)

  try {
    const mark = await tools.update('characters', caller.recordId, { actedRound: roundNumber })
    if (!mark.success) {
      console.error(`[round] actedRound write failed: ${mark.error}`)
      return { marked: false, reason: 'write_failed' }
    }
  } catch (error) {
    console.error(`[round] actedRound write threw: ${String(error)}`)
    return { marked: false, reason: 'write_failed' }
  }

  // Everyone at the table has acted this round -> the next one starts, and the
  // GM stages it. The caller's row carries the mark just written.
  const table = onlineRows(rows, caller, turn.onlineCharacterNames)
  const everyoneActed = table.every((row) =>
    row.recordId === caller.recordId ? true : asNumber(row.actedRound, 0) >= roundNumber,
  )
  if (!everyoneActed) return { marked: true, roundNumber, nextRound: roundNumber }

  const nextRound = roundNumber + 1
  try {
    const advance = await tools.update('campaigns', DEFAULT_CAMPAIGN_ID, { roundNumber: nextRound })
    if (!advance.success) {
      // The mark stands; the round simply stays open until the next turn.
      console.error(`[round] roundNumber write failed: ${advance.error}`)
      return { marked: true, roundNumber, nextRound: roundNumber }
    }
  } catch (error) {
    console.error(`[round] roundNumber write threw: ${String(error)}`)
    return { marked: true, roundNumber, nextRound: roundNumber }
  }
  return { marked: true, roundNumber, nextRound }
}
