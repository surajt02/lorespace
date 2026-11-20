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
 *
 * The pacing rule itself is `shouldStreamGmTurn`: the GM answers a whole round,
 * so a real player's message is recorded and only the message that closes the
 * round calls the model.
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
  /** `rolledOver` is the route's cue: true means this turn closed the round. */
  | { marked: true; roundNumber: number; nextRound: number; rolledOver: boolean }

/**
 * Whether this turn calls the model (ADR 0031, amended 2026-11-20).
 *
 * The GM answers **once per completed round**: a real player's message is
 * persisted and marks them as acted, but the model is only called when the
 * round closes — so at a two-player table the last message carries both actions
 * and gets one turn, and an extra message from someone who already acted waits
 * in the batch.
 *
 * An engine beat is not a move: the opening, a resolved roll, the missed-check
 * correction and a scene advance each get an immediate turn, whether or not a
 * round is open. This is a pure decision — the route does the I/O.
 */
export function shouldStreamGmTurn(input: {
  synthetic: boolean
  transient: boolean
  roundComplete: boolean
}): boolean {
  if (input.synthetic || input.transient) return true
  return input.roundComplete
}

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
  if (!everyoneActed) return { marked: true, roundNumber, nextRound: roundNumber, rolledOver: false }

  const nextRound = roundNumber + 1
  try {
    const advance = await tools.update('campaigns', DEFAULT_CAMPAIGN_ID, { roundNumber: nextRound })
    if (!advance.success) {
      // The mark stands; the round simply stays open until the next turn.
      console.error(`[round] roundNumber write failed: ${advance.error}`)
      return { marked: true, roundNumber, nextRound: roundNumber, rolledOver: false }
    }
  } catch (error) {
    console.error(`[round] roundNumber write threw: ${String(error)}`)
    return { marked: true, roundNumber, nextRound: roundNumber, rolledOver: false }
  }
  return { marked: true, roundNumber, nextRound, rolledOver: true }
}
