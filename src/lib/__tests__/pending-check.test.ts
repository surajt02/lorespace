import { describe, expect, it } from 'vitest'
import {
  dcDisplay,
  pendingLabel,
  pendingOf,
  statCardState,
  type PendingCheck,
} from '@/lib/pending-check'

/**
 * Unit tests for the pending-check display rules (`P5.19`, `P5.20`).
 *
 * The server (`rollSkillCheck`) is the authority; these tests pin the client's
 * half — which card highlights, which are inert, and which number the banner
 * shows — so the two halves cannot disagree about one campaign row.
 */

const ASH = 'char-ash'
const JOEBLO = 'char-joeblo'

const pending = (overrides: Partial<PendingCheck> = {}): PendingCheck => ({
  characterId: ASH,
  stat: 'dex',
  dc: 14,
  ...overrides,
})

describe('pendingOf', () => {
  it('reads a complete row', () => {
    expect(
      pendingOf({ pendingCharacterId: ASH, pendingStat: 'dex', pendingDc: 14 }),
    ).toEqual({ characterId: ASH, stat: 'dex', dc: 14 })
  })

  it('treats a missing, null or empty campaign as nothing pending', () => {
    expect(pendingOf(null)).toBeNull()
    expect(pendingOf(undefined)).toBeNull()
    expect(pendingOf({})).toBeNull()
  })

  it('tolerates a half-written or hand-edited row', () => {
    // Unknown ability key, the empty default, a junk value: no request.
    for (const pendingStat of ['', 'luck', null, undefined, 7]) {
      expect(pendingOf({ pendingCharacterId: ASH, pendingStat, pendingDc: 14 })).toBeNull()
    }
    // A DC that is not a positive number is not a request either.
    for (const pendingDc of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, '12', null]) {
      expect(pendingOf({ pendingCharacterId: ASH, pendingStat: 'dex', pendingDc })).toBeNull()
    }
    // A non-string character id degrades to "anyone may roll it", not to a throw.
    expect(
      pendingOf({ pendingCharacterId: 42, pendingStat: 'wis', pendingDc: 12 }),
    ).toEqual({ characterId: '', stat: 'wis', dc: 12 })
  })
})

describe('dcDisplay', () => {
  it('shows the pending check’s DC while a roll is owed', () => {
    expect(dcDisplay(pending({ dc: 17 }), 12)).toBe(17)
  })

  it('falls back to the scene DC with nothing pending', () => {
    expect(dcDisplay(null, 12)).toBe(12)
  })
})

describe('statCardState', () => {
  it('makes every card inert with nothing pending', () => {
    for (const characterId of [ASH, JOEBLO]) {
      for (const stat of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
        expect(statCardState({ pending: null, characterId, stat })).toBe('waiting-other')
      }
    }
  })

  it('highlights exactly the pending stat of the pending character', () => {
    const states = (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((stat) =>
      statCardState({ pending: pending(), characterId: ASH, stat }),
    )
    expect(states.filter((state) => state === 'rollable')).toEqual(['rollable'])
    expect(states.filter((state) => state === 'waiting-self')).toHaveLength(5)
    expect(states).not.toContain('waiting-other')
  })

  it('gives another character’s sheet no rollable card', () => {
    for (const stat of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      expect(statCardState({ pending: pending(), characterId: JOEBLO, stat })).toBe(
        'waiting-other',
      )
    }
  })

  it('lets anyone roll a check that names no character', () => {
    const unassigned = pending({ characterId: '' })
    expect(statCardState({ pending: unassigned, characterId: JOEBLO, stat: 'dex' })).toBe(
      'rollable',
    )
    expect(statCardState({ pending: unassigned, characterId: ASH, stat: 'dex' })).toBe(
      'rollable',
    )
    expect(statCardState({ pending: unassigned, characterId: ASH, stat: 'str' })).toBe(
      'waiting-self',
    )
  })
})

describe('pendingLabel', () => {
  it('says the GM has not asked for anything yet', () => {
    expect(pendingLabel(null)).toBe('Waiting on the GM…')
  })

  it('names the character the check belongs to', () => {
    expect(pendingLabel(pending(), 'Ash')).toBe('Ash must roll DEX')
  })

  it('reads as an instruction on the roller’s own sheet', () => {
    expect(pendingLabel(pending({ stat: 'wis', dc: 12 }))).toBe('Roll WIS against 12')
  })

  it('ignores a blank name and upper-cases the stat', () => {
    expect(pendingLabel(pending({ stat: 'con', dc: 9 }), '   ')).toBe('Roll CON against 9')
  })
})
