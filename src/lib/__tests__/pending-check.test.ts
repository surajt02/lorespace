import { describe, expect, it } from 'vitest'
import {
  dcDisplay,
  owedElsewhere,
  owedElsewhereLabel,
  pendingLabel,
  pendingOf,
  statCardState,
  type OwedElsewhere,
  type PartyMemberSource,
  type PendingCheck,
} from '@/lib/pending-check'
import type { AbilityScoreKey } from '@/lib/party-presence'

/**
 * Unit tests for the pending-check display rules (`P5.19`, `P5.20`, `P5.31`).
 *
 * The server (`rollSkillCheck`) is the authority; these tests pin the client's
 * half — which card highlights, which are inert, and which number the banner
 * shows — so the two halves cannot disagree about one character row. Since ADR
 * 0030 the gate is two columns on the character itself, so the sheet's own ask is
 * read from its own row; `owedElsewhere` is the one table-wide read, and it only
 * ever *disables* cards, mirroring the server's `check_owed_by_other` refusal.
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

/**
 * Another sheet's outstanding check (`P5.31`, ADR 0030 amendment 2026-11-20).
 *
 * Storage stayed per character, but authorisation became table-wide: while any
 * other sheet owes a roll, the server refuses this character's with
 * `check_owed_by_other`. The sheet has to say the same thing, or a player presses
 * a card the server will reject.
 */
describe('owedElsewhere', () => {
  const kaelen = (data: Record<string, unknown>, recordId = 'char-kaelen'): PartyMemberSource => ({
    recordId,
    data: { name: 'Kaelen', ...data },
  })
  const joeblo = (data: Record<string, unknown>, recordId = 'char-joeblo'): PartyMemberSource => ({
    recordId,
    data: { name: 'Joeblo', ...data },
  })

  it('names the other character who owes a check', () => {
    const party = [
      kaelen({ pendingStat: '', pendingDc: 0 }),
      joeblo({ pendingStat: 'wis', pendingDc: 13 }),
    ]

    expect(owedElsewhere(party, 'char-kaelen')).toEqual({ name: 'Joeblo', stat: 'wis' })
  })

  it('ignores the viewer’s own row', () => {
    // Kaelen is asked for DEX, Joeblo for nothing: the sheet must not report
    // Kaelen's own check as someone else's, or it would disable its own card.
    const party = [
      kaelen({ pendingStat: 'dex', pendingDc: 17 }),
      joeblo({ pendingStat: '', pendingDc: 0 }),
    ]

    expect(owedElsewhere(party, 'char-kaelen')).toBeNull()
    // The same party read from Joeblo's window names Kaelen.
    expect(owedElsewhere(party, 'char-joeblo')).toEqual({ name: 'Kaelen', stat: 'dex' })
  })

  it('reads nothing owed as null', () => {
    const party = [
      kaelen({ pendingStat: '', pendingDc: 0 }),
      joeblo({ pendingStat: '', pendingDc: 0 }),
    ]

    expect(owedElsewhere(party, 'char-kaelen')).toBeNull()
    expect(owedElsewhere([], 'char-kaelen')).toBeNull()
  })

  it('ignores malformed rows instead of inventing a gate', () => {
    // Unknown ability, non-positive or non-numeric DC, no data at all: none of
    // these is a request, so none of them dims the viewer's cards.
    for (const data of [
      { pendingStat: 'luck', pendingDc: 14 },
      { pendingStat: 'wis', pendingDc: 0 },
      { pendingStat: 'wis', pendingDc: '13' },
    ]) {
      expect(owedElsewhere([joeblo(data)], 'char-kaelen')).toBeNull()
    }
    expect(owedElsewhere([{ recordId: 'char-joeblo' }], 'char-kaelen')).toBeNull()
    expect(owedElsewhere([{ recordId: 'char-joeblo', data: null }], 'char-kaelen')).toBeNull()
  })

  it('falls back to a generic name when the row cannot name its character', () => {
    // A row without a usable name still owes a roll; the line stays truthful
    // rather than rendering "undefined must roll WIS".
    for (const name of [undefined, '', '   ', 7]) {
      expect(owedElsewhere([{ recordId: 'char-x', data: { name, pendingStat: 'wis', pendingDc: 9 } }], 'char-kaelen')).toEqual(
        { name: 'Another adventurer', stat: 'wis' },
      )
    }
  })
})

describe('owedElsewhereLabel', () => {
  it('reads as a reason the viewer is not rolling', () => {
    const owed: OwedElsewhere = { name: 'Joeblo', stat: 'wis' }
    expect(owedElsewhereLabel(owed)).toBe('Joeblo must roll WIS')
  })

  it('has no line when nobody else owes a check', () => {
    expect(owedElsewhereLabel(null)).toBe('')
  })
})

describe('a card while another sheet owes a check', () => {
  it('disables the card the fallback would otherwise enable', () => {
    // The GM's narrated-but-unregistered WIS ask keeps WIS rollable... unless the
    // table is already waiting on another adventurer, where the server refuses.
    expect(statCardState({ pending: null, stat: 'wis', fallbackStat: 'wis' })).toBe('rollable')
    expect(
      statCardState({
        pending: null,
        stat: 'wis',
        fallbackStat: 'wis',
        owedElsewhere: { name: 'Joeblo', stat: 'dex' },
      }),
    ).toBe('waiting')
  })

  it('makes every card inert, not just the stat named', () => {
    const owedElsewhere: OwedElsewhere = { name: 'Joeblo', stat: 'wis' }
    for (const stat of STATS) {
      expect(
        statCardState({ pending: null, stat, fallbackStat: stat, owedElsewhere }),
      ).toBe('waiting')
    }
  })

  it('never overrides the viewer’s own pending check', () => {
    // Two asks can stand at once (ADR 0030): the sheet that owes still rolls its
    // own stat, because the server accepts it.
    const owedElsewhere: OwedElsewhere = { name: 'Joeblo', stat: 'wis' }
    expect(statCardState({ pending: pending(), stat: 'dex', owedElsewhere })).toBe('rollable')
    expect(statCardState({ pending: pending(), stat: 'wis', owedElsewhere })).toBe('waiting')
  })
})
