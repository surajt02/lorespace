import { describe, expect, it } from 'vitest'
import type { RecordData } from 'deepspace'
import {
  buildCheckFixPrompt,
  buildOpeningPrompt,
  buildRollPrompt,
  requestsRoll,
  statNamedInText,
  unresolvedRolls,
} from '@/lib/gm-prompts'
import { PREVIEW_ROLLS, type RollLogRow } from '@/lib/preview-data'

/**
 * Unit tests for the GM prompt builders (`P5.7`).
 *
 * The automatic turn must carry the `roll-logs` numbers verbatim with a stable
 * payload (ADR 0009 — the model verifies, it does not invent). `unresolvedRolls`
 * is the whole one-turn-per-roll cap (ADR 0012), so its filters are asserted
 * directly. The missed-check correction is the other thing worth pinning: it is
 * the only net under a model that narrates a roll without registering it.
 *
 * No snapshots, no jsdom, no network.
 */

/** `PREVIEW_ROLLS` are both `entryType: 'roll'`; the door roll is the Kaelen one. */
const KAELEN_DOOR = PREVIEW_ROLLS.find(
  (row) => row.data.characterName === 'Kaelen',
) as RecordData<RollLogRow>

function row(
  recordId: string,
  data: Partial<RollLogRow>,
  createdAt: string,
): RecordData<RollLogRow> {
  return {
    recordId,
    createdBy: 'preview',
    createdAt,
    updatedAt: createdAt,
    data: {
      ...KAELEN_DOOR.data,
      ...data,
    },
  }
}

describe('buildRollPrompt', () => {
  const prompt = buildRollPrompt(KAELEN_DOOR)

  it('carries the roller, the dice line and the outcome', () => {
    expect(prompt).toContain('Kaelen')
    expect(prompt).toContain('STR')
    expect(prompt).toContain('d20(14)')
    expect(prompt).toContain('= 17 vs DC 12')
    expect(prompt).toContain('success')
  })

  it('carries all five payload fields', () => {
    const payload = prompt.slice(prompt.indexOf('{"'))
    expect(JSON.parse(payload.slice(0, payload.indexOf('}') + 1))).toEqual({
      rawRoll: 14,
      modifier: 3,
      total: 17,
      targetDc: 12,
      outcome: 'success',
    })
  })

  it('names the row it must be verified against', () => {
    expect(prompt).toContain(KAELEN_DOOR.recordId)
    expect(prompt).toContain('roll-logs')
  })
})

describe('buildOpeningPrompt', () => {
  const prompt = buildOpeningPrompt('Act I · Scene 2 of 5')

  it('opens at the act and scene the engine reports', () => {
    expect(prompt).toContain('Act I · Scene 2 of 5')
    expect(prompt).toMatch(/^Begin the campaign at /)
  })

  it('asks for the narration and then a decision or a check', () => {
    expect(prompt).toMatch(/[Nn]arrate/)
    expect(prompt).toMatch(/decision or check/)
    expect(prompt).toContain('campaigns row')
  })

  it('never invents a roll', () => {
    expect(prompt).not.toMatch(/d20/)
    expect(prompt).not.toMatch(/\bDC \d+/)
    expect(prompt).not.toMatch(/success|failure|critical/i)
    expect(prompt).toMatch(/[Dd]o not roll/)
  })

  it('names the scene title when one is passed, and stays readable without it', () => {
    expect(buildOpeningPrompt('Act II · Scene 3 of 5', 'The Sentinel')).toContain(
      'Act II · Scene 3 of 5 (The Sentinel)',
    )
    // A blank label must not become an empty sentence or a placeholder.
    for (const label of ['', '   ']) {
      const blank = buildOpeningPrompt(label)
      expect(blank).toContain('the opening scene')
    }
    expect(buildOpeningPrompt('Act I · Scene 1 of 5', '  ')).not.toContain('()')
  })
})

describe('unresolvedRolls', () => {
  const rows: RecordData<RollLogRow>[] = [
    row('roll-old', { characterName: 'Kaelen', rawRoll: 4 }, '2026-11-19T10:00:00.000Z'),
    row(
      'roll-combat',
      { entryType: 'combat', characterName: 'Kaelen', summary: 'Kaelen takes 6 damage' },
      '2026-11-19T10:05:00.000Z',
    ),
    row('roll-new', { characterName: 'Vesper', rawRoll: 11 }, '2026-11-19T10:10:00.000Z'),
  ]

  it('returns only unannounced roll rows, newest first', () => {
    expect(unresolvedRolls(rows, new Set()).map((entry) => entry.recordId)).toEqual([
      'roll-new',
      'roll-old',
    ])
  })

  it('excludes announced ids', () => {
    expect(
      unresolvedRolls(rows, new Set(['roll-new'])).map((entry) => entry.recordId),
    ).toEqual(['roll-old'])
    expect(unresolvedRolls(rows, new Set(['roll-new', 'roll-old']))).toEqual([])
  })

  it('never treats the GM\'s own evidence rows as rolls', () => {
    const ids = unresolvedRolls(rows, new Set()).map((entry) => entry.recordId)
    expect(ids).not.toContain('roll-combat')
  })

  it('does not mutate the caller\'s announced set', () => {
    const announced = new Set(['roll-old'])
    unresolvedRolls(rows, announced)
    expect([...announced]).toEqual(['roll-old'])
  })
})

describe('a roll the GM narrated without registering', () => {
  it('reads the ability out of the requesting sentence', () => {
    expect(statNamedInText('Roll WIS against 14 to see through the glamour.')).toBe('wis')
    expect(statNamedInText('Give me a Wisdom check, Joeblo.')).toBe('wis')
    expect(statNamedInText('Test your Strength or the door wins.')).toBe('str')
    // Long forms and abbreviations both count, case-insensitively.
    expect(statNamedInText('roll dex')).toBe('dex')
  })

  it('ignores prose that is not asking for a roll', () => {
    expect(statNamedInText('The knife at your belt is cold steel.')).toBeNull()
    expect(statNamedInText('')).toBeNull()
  })

  it('uses the last requesting sentence, not an earlier one', () => {
    const text = 'Roll DEX to cross. Then the shrine asks: roll WIS against 12.'
    expect(statNamedInText(text)).toBe('wis')
  })

  it('refuses to guess when one sentence names two abilities', () => {
    expect(statNamedInText('Roll STR or DEX — your call.')).toBeNull()
  })

  it('does not mistake a recap for a request', () => {
    expect(requestsRoll('You rolled WIS and the glamour broke.')).toBe(false)
    expect(statNamedInText('You rolled WIS against 14 — the rune dims.')).toBeNull()
  })

  it('detects a roll request in prose', () => {
    expect(requestsRoll('Roll WIS against 14.')).toBe(true)
    expect(requestsRoll('Make a check for me.')).toBe(true)
    expect(requestsRoll('The hall is silent.')).toBe(false)
  })

  it('writes a correction that names the character and the ability', () => {
    const prompt = buildCheckFixPrompt('wis', 'Ash')
    expect(prompt).toContain('Ash')
    expect(prompt).toContain('request_check')
    expect(prompt).toContain('wis')
  })
})
