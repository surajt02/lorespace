import { describe, expect, it } from 'vitest'
import type { RecordData } from 'deepspace'
import { toAnnouncedRoll, unseenRolls } from '@/lib/roll-announcements'
import { PREVIEW_ROLLS, type RollLogRow } from '@/lib/preview-data'

/**
 * Unit tests for the banner's source of truth (`P4.13`, ADR 0021).
 *
 * The banner may only announce a `roll-logs` row: these pin that a non-roll row
 * (GM event, combat) never becomes a dice line, that a row missing its numbers
 * is ignored instead of rendering `d20(undefined)`, and that a row is announced
 * once per window — the baseline/timestamp problem is the caller's, but the
 * filtering is here.
 */

function row(overrides: Partial<RollLogRow> = {}, recordId = 'roll-1'): RecordData<RollLogRow> {
  return {
    recordId,
    data: {
      userId: 'user-alice',
      campaignId: 'default-campaign',
      characterName: 'Kaelen',
      entryType: 'roll',
      statName: 'dex',
      rawRoll: 14,
      modifier: 3,
      total: 17,
      targetDc: 12,
      outcome: 'success',
      summary: 'DEX check: d20(14) +3 = 17 vs DC 12 — success',
      rolledAt: 1_800_000_000_000,
      ...overrides,
    },
  } as RecordData<RollLogRow>
}

describe('toAnnouncedRoll', () => {
  it('maps a roll row to the banner shape, keeping the record id', () => {
    expect(toAnnouncedRoll(row({}, 'roll-42'))).toEqual({
      rollLogId: 'roll-42',
      characterName: 'Kaelen',
      statName: 'dex',
      rawRoll: 14,
      modifier: 3,
      total: 17,
      targetDc: 12,
      outcome: 'success',
    })
  })

  it('refuses a row that is not a roll', () => {
    expect(toAnnouncedRoll(row({ entryType: 'gm_event' }))).toBeNull()
    expect(toAnnouncedRoll(row({ entryType: 'combat' }))).toBeNull()
    expect(toAnnouncedRoll(row({ entryType: 'action' }))).toBeNull()
  })

  it('refuses a roll row with no dice numbers rather than rendering a hole', () => {
    expect(
      toAnnouncedRoll(row({ rawRoll: undefined as unknown as number })),
    ).toBeNull()
    expect(toAnnouncedRoll(row({ total: undefined as unknown as number }))).toBeNull()
    expect(toAnnouncedRoll(row({ modifier: undefined as unknown as number }))).toBeNull()
    expect(toAnnouncedRoll(row({ targetDc: undefined as unknown as number }))).toBeNull()
  })

  it('refuses a row with no outcome or character name', () => {
    expect(toAnnouncedRoll(row({ outcome: undefined as unknown as string }))).toBeNull()
    expect(toAnnouncedRoll(row({ characterName: undefined as unknown as string }))).toBeNull()
  })

  it('keeps an empty statName instead of dropping the roll', () => {
    // The banner falls back to `CHECK`; an unnamed stat is not a broken roll.
    expect(toAnnouncedRoll(row({ statName: '' }))?.statName).toBe('')
  })
})

describe('unseenRolls', () => {
  it('returns only ids the window has not seen, in the order given', () => {
    const newest = row({}, 'roll-c')
    const middle = row({}, 'roll-b')
    const oldest = row({}, 'roll-a')
    const seen = new Set(['roll-b'])

    expect(unseenRolls([newest, middle, oldest], seen).map((entry) => entry.recordId)).toEqual([
      'roll-c',
      'roll-a',
    ])
  })

  it('never mutates the caller set', () => {
    const seen = new Set<string>()
    unseenRolls([row({}, 'roll-1')], seen)
    expect(seen.size).toBe(0)
  })

  it('returns nothing when every row is already known', () => {
    const entries = [row({}, 'roll-1'), row({}, 'roll-2')]
    expect(unseenRolls(entries, new Set(['roll-1', 'roll-2']))).toEqual([])
  })

  it('does not announce the fixture table by accident', () => {
    // A signed-out window passes the live `roll-logs` read here, never
    // `PREVIEW_ROLLS`; the baseline is whatever the first ready snapshot held.
    const baseline = new Set(PREVIEW_ROLLS.map((entry) => entry.recordId))
    expect(unseenRolls(PREVIEW_ROLLS, baseline)).toEqual([])
  })
})
