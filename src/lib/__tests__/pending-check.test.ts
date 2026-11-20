import { describe, expect, it } from 'vitest'
import {
  dcDisplay,
  pendingLabel,
  pendingOf,
  statCardState,
  type PendingCheck,
} from '@/lib/pending-check'
import type { AbilityScoreKey } from '@/lib/party-presence'

/**
 * Unit tests for the pending-check display rules (`P5.19`, `P5.20`, `P5.31`).
 *
 * The server (`rollSkillCheck`) is the authority; these tests pin the client's
 * half — which card highlights, which are inert, and which number the banner
 * shows — so the two halves cannot disagree about one character row. Since ADR
 * 0030 the gate is two columns on the character itself, so every fixture here is
 * a character row and there is no cross-character matching left to test.
 */

const STATS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const

const pending = (overrides: Partial<PendingCheck> = {}): PendingCheck => ({
  stat: 'dex',
  dc: 14,
  ...overrides,
})

describe('pendingOf', () => {
  it('reads a complete character row', () => {
    expect(pendingOf({ pendingStat: 'dex', pendingDc: 14 })).toEqual({ stat: 'dex', dc: 14 })
  })

  it('treats a missing, null or empty row as nothing pending', () => {
    expect(pendingOf(null)).toBeNull()
    expect(pendingOf(undefined)).toBeNull()
    expect(pendingOf({})).toBeNull()
  })

  it('tolerates a half-written or hand-edited row', () => {
    // Unknown ability key, the empty default, a junk value: no request.
    for (const pendingStat of ['', 'luck', null, undefined, 7]) {
      expect(pendingOf({ pendingStat, pendingDc: 14 })).toBeNull()
    }
    // A DC that is not a positive number is not a request either.
    for (const pendingDc of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, '12', null]) {
      expect(pendingOf({ pendingStat: 'dex', pendingDc })).toBeNull()
    }
  })

  it('reads only the row it is given, so one sheet cannot answer for another', () => {
    // Two characters owe different things — or nothing — in the same campaign.
    const ash = { pendingStat: 'dex', pendingDc: 14 }
    const joeblo = { pendingStat: 'wis', pendingDc: 9 }
    const quiet = { pendingStat: '', pendingDc: 0 }

    expect(pendingOf(ash)).toEqual({ stat: 'dex', dc: 14 })
    expect(pendingOf(joeblo)).toEqual({ stat: 'wis', dc: 9 })
    expect(pendingOf(quiet)).toBeNull()
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
    for (const stat of STATS) {
      expect(statCardState({ pending: null, stat })).toBe('waiting')
    }
  })

  it('highlights exactly the pending stat on the sheet that owes it', () => {
    const states = STATS.map((stat) => statCardState({ pending: pending(), stat }))
    expect(states.filter((state) => state === 'rollable')).toEqual(['rollable'])
    expect(states.filter((state) => state === 'waiting')).toHaveLength(5)
  })

  it('gates each sheet independently', () => {
    // Ash owes DEX; Joeblo owes nothing. The same WIS card reads differently
    // because the pending check is read from each character's own row.
    const ash = pendingOf({ pendingStat: 'dex', pendingDc: 14 })
    const joeblo = pendingOf({ pendingStat: '', pendingDc: 0 })

    expect(statCardState({ pending: ash, stat: 'dex' })).toBe('rollable')
    expect(statCardState({ pending: ash, stat: 'wis' })).toBe('waiting')
    for (const stat of STATS) {
      expect(statCardState({ pending: joeblo, stat })).toBe('waiting')
    }
  })
})

describe('pendingLabel', () => {
  it('says the GM has not asked for anything yet', () => {
    expect(pendingLabel(null)).toBe('Waiting on the GM…')
  })

  it('reads as an instruction on the roller’s own sheet', () => {
    expect(pendingLabel(pending({ stat: 'wis', dc: 12 }))).toBe('Roll WIS against 12')
  })

  it('upper-cases the stat', () => {
    expect(pendingLabel(pending({ stat: 'con', dc: 9 }))).toBe('Roll CON against 9')
  })
})

describe('a narrated-but-unregistered roll (fallback)', () => {
  const pending: PendingCheck = { stat: 'dex', dc: 14 }

  it('makes the named stat rollable with nothing pending', () => {
    const state = (stat: AbilityScoreKey) =>
      statCardState({ pending: null, stat, fallbackStat: 'wis' })
    expect(state('wis')).toBe('rollable')
    expect(state('str')).toBe('waiting')
  })

  it('leaves every card inert without a fallback', () => {
    expect(statCardState({ pending: null, stat: 'wis', fallbackStat: null })).toBe('waiting')
  })

  it('never widens a real pending check', () => {
    // A pending DEX check wins: the fallback WIS card stays inert.
    expect(statCardState({ pending, stat: 'wis', fallbackStat: 'wis' })).toBe('waiting')
    expect(statCardState({ pending, stat: 'dex', fallbackStat: 'wis' })).toBe('rollable')
  })

  it('labels the fallback ask', () => {
    expect(pendingLabel(null, 'wis')).toBe('The GM asked for WIS — roll it')
    expect(pendingLabel(null)).toBe('Waiting on the GM…')
  })
})
