import { describe, expect, it } from 'vitest'
import type { RecordData } from 'deepspace'
import { newestFirst, toAnnouncedRoll, unseenRolls } from '@/lib/roll-announcements'
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

describe('newestFirst', () => {
  it('restores newest-first when a live insert arrives appended', () => {
    const old = row({}, 'roll-a')
    const middle = row({}, 'roll-b')
    const fresh = row({}, 'roll-c')
    // The client appends inserts, so the fresh row is last in the array.
    expect(newestFirst([old, middle, fresh]).map((entry) => entry.recordId)).toEqual([
      'roll-c',
      'roll-b',
      'roll-a',
    ])
  })

  it('uses the record envelope, not the row fields, for age', () => {
    const earlier = { ...row({}, 'roll-a'), createdAt: '2026-11-19T00:00:00.000Z' }
    const later = { ...row({}, 'roll-b'), createdAt: '2026-11-19T00:00:05.000Z' }
    expect(newestFirst([earlier, later]).map((entry) => entry.recordId)).toEqual([
      'roll-b',
      'roll-a',
    ])
  })

  it('breaks equal timestamps by id, newest id first, and never mutates', () => {
    const a = { ...row({}, 'roll-a'), createdAt: '2026-11-19T00:00:00.000Z' }
    const b = { ...row({}, 'roll-b'), createdAt: '2026-11-19T00:00:00.000Z' }
    const input = [a, b]
    expect(newestFirst(input).map((entry) => entry.recordId)).toEqual(['roll-b', 'roll-a'])
    expect(input.map((entry) => entry.recordId)).toEqual(['roll-a', 'roll-b'])
  })

  it('sorts a malformed createdAt last rather than first', () => {
    const bad = { ...row({}, 'roll-z'), createdAt: 'not-a-date' }
    const good = { ...row({}, 'roll-a'), createdAt: '2026-11-19T00:00:00.000Z' }
    expect(newestFirst([bad, good]).map((entry) => entry.recordId)).toEqual(['roll-a', 'roll-z'])
  })
})
