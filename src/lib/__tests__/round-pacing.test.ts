import { describe, expect, it, vi } from 'vitest'
import { recordRoundTurn, shouldStreamGmTurn } from '@/lib/round-pacing'
import { DEFAULT_CAMPAIGN_ID } from '@/constants'

/**
 * Round pacing (`P5.32`, ADR 0031).
 *
 * The engine's half of "the GM stages the table": a player's turn marks their
 * own character, and the round increments only when every character *online*
 * has acted. These tests pin the three claims that make that enforceable —
 * rollover needs the whole online table, single-player closes its round on
 * every turn, and an engine beat is not a turn — plus the rule that a failed
 * bookkeeping write never costs a player their message.
 */

type RoundTools = Parameters<typeof recordRoundTurn>[0]

interface Row {
  recordId: string
  name: string
  userId: string
  actedRound: number
}

function row(recordId: string, name: string, actedRound: number, userId = `user-${name}`): Row {
  return { recordId, name, userId, actedRound }
}

function fakeTools(characters: Row[], roundNumber: number) {
  const updates: Array<{ collection: string; recordId: string; data: Record<string, unknown> }> = []
  const query = vi.fn(async (collection: string) => {
    if (collection === 'characters') {
      return {
        success: true as const,
        data: {
          records: characters.map((character) => ({
            collection: 'characters',
            recordId: character.recordId,
            createdBy: character.userId,
            createdAt: '',
            updatedAt: '',
            data: {
              userId: character.userId,
              name: character.name,
              actedRound: character.actedRound,
            },
          })),
          count: characters.length,
        },
      }
    }
    if (collection === 'campaigns') {
      return {
        success: true as const,
        data: {
          records: [
            {
              collection: 'campaigns',
              recordId: DEFAULT_CAMPAIGN_ID,
              createdBy: 'owner',
              createdAt: '',
              updatedAt: '',
              data: { roundNumber },
            },
          ],
          count: 1,
        },
      }
    }
    return { success: false as const, code: 'not_found', error: `${collection} not found` }
  })
  const update = vi.fn(async (collection: string, recordId: string, data: Record<string, unknown>) => {
    updates.push({ collection, recordId, data })
    return { success: true as const, data: { recordId } }
  })
  return { tools: { query, update } as unknown as RoundTools, updates, query }
}

describe('recordRoundTurn', () => {
  it('marks the speaker before the round is considered, and holds while another is waiting', async () => {
    // Two at the table, one has acted: Vesper still owes this round.
    const { tools, updates } = fakeTools(
      [row('char-ash', 'Ash', 0), row('char-vesper', 'Vesper', 0)],
      4,
    )

    const outcome = await recordRoundTurn(tools, {
      userId: 'user-Ash',
      onlineCharacterNames: ['Ash', 'Vesper'],
      playerTurn: true,
    })

    expect(outcome).toEqual({ marked: true, roundNumber: 4, nextRound: 4, rolledOver: false })
    // The mark is the only write: no rollover while someone is still waiting.
    expect(updates).toEqual([
      { collection: 'characters', recordId: 'char-ash', data: { actedRound: 4 } },
    ])
  })

  it('rolls the round over once every online character has acted', async () => {
    // Ash acted in round 4 on an earlier turn; Vesper's is this one.
    const { tools, updates } = fakeTools(
      [row('char-ash', 'Ash', 4), row('char-vesper', 'Vesper', 0)],
      4,
    )

    const outcome = await recordRoundTurn(tools, {
      userId: 'user-Vesper',
      onlineCharacterNames: ['Ash', 'Vesper'],
      playerTurn: true,
    })

    expect(outcome).toEqual({ marked: true, roundNumber: 4, nextRound: 5, rolledOver: true })
    // Mark first, then the new round: the rollover has to see the mark.
    expect(updates).toEqual([
      { collection: 'characters', recordId: 'char-vesper', data: { actedRound: 4 } },
      { collection: 'campaigns', recordId: DEFAULT_CAMPAIGN_ID, data: { roundNumber: 5 } },
    ])
  })

  it('does not let an offline character hold the round open', async () => {
    // The roster has three sheets; only Ash is online (ADR 0029).
    const { tools, updates } = fakeTools(
      [row('char-ash', 'Ash', 0), row('char-vesper', 'Vesper', 0), row('char-joeblo', 'joeblo', 0)],
      2,
    )

    const outcome = await recordRoundTurn(tools, {
      userId: 'user-Ash',
      onlineCharacterNames: ['Ash'],
      playerTurn: true,
    })

    expect(outcome).toEqual({ marked: true, roundNumber: 2, nextRound: 3, rolledOver: true })
    expect(updates.map((update) => update.collection)).toEqual(['characters', 'campaigns'])
  })

  it('rolls a single-player turn over every time, with no online list at all', async () => {
    for (const onlineCharacterNames of [[], ['Ash'], undefined]) {
      const { tools, updates } = fakeTools([row('char-ash', 'Ash', 1)], 1)

      const outcome = await recordRoundTurn(tools, {
        userId: 'user-Ash',
        onlineCharacterNames,
        playerTurn: true,
      })

      expect(outcome).toEqual({ marked: true, roundNumber: 1, nextRound: 2, rolledOver: true })
      expect(updates).toHaveLength(2)
    }
  })

  it('marks nothing for a synthetic beat or a transient correction', async () => {
    for (const label of ['synthetic', 'transient']) {
      const { tools, query } = fakeTools([row('char-ash', 'Ash', 0)], 3)

      const outcome = await recordRoundTurn(tools, {
        userId: 'user-Ash',
        onlineCharacterNames: ['Ash'],
        playerTurn: false,
      })

      // The app speaking is not a character acting: no read, no write.
      expect(outcome, label).toEqual({ marked: false, reason: 'not_a_player_turn' })
      expect(query).not.toHaveBeenCalled()
    }
  })

  it('leaves the round alone when the caller has no character at the table', async () => {
    const { tools, updates } = fakeTools([row('char-ash', 'Ash', 0)], 2)

    const outcome = await recordRoundTurn(tools, {
      userId: 'user-vesper',
      onlineCharacterNames: ['Ash'],
      playerTurn: true,
    })

    expect(outcome).toEqual({ marked: false, reason: 'no_character' })
    expect(updates).toEqual([])
  })

  it('logs and returns when the bookkeeping read fails, never throwing at the route', async () => {
    const tools = {
      query: vi.fn().mockResolvedValue({ success: false, code: 'room_error', error: 'room down' }),
      update: vi.fn(),
    } as unknown as RoundTools

    await expect(
      recordRoundTurn(tools, {
        userId: 'user-ash',
        onlineCharacterNames: ['Ash'],
        playerTurn: true,
      }),
    ).resolves.toEqual({ marked: false, reason: 'read_failed' })
    expect(tools.update).not.toHaveBeenCalled()
  })
})

/**
 * The pacing decision (`P5.33`, ADR 0031, amended 2026-11-20): the model answers
 * a whole round, so only the turn that closes one calls it. Every engine beat
 * answers immediately — a beat that waited on a round would strand the table,
 * which is the failure the amendment exists to avoid in the other direction.
 */
describe('shouldStreamGmTurn', () => {
  it('answers a real player turn only once the round is complete', () => {
    expect(shouldStreamGmTurn({ synthetic: false, transient: false, roundComplete: true })).toBe(
      true,
    )
    // Another player still owes a move: the message is recorded and waits.
    expect(shouldStreamGmTurn({ synthetic: false, transient: false, roundComplete: false })).toBe(
      false,
    )
  })

  it('always answers a synthetic beat or a transient correction', () => {
    expect(shouldStreamGmTurn({ synthetic: true, transient: false, roundComplete: false })).toBe(
      true,
    )
    expect(shouldStreamGmTurn({ synthetic: false, transient: true, roundComplete: false })).toBe(
      true,
    )
  })
})
