import { describe, expect, it } from 'vitest'
import type { RecordData } from 'deepspace'
import {
  buildCheckFixPrompt,
  buildOpeningPrompt,
  buildRollBatchPrompt,
  buildContinuePrompt,
  isDuplicateRollBatch,
  requestsRoll,
  statNamedInText,
  unresolvedRolls,
} from '@/lib/gm-prompts'
import { PREVIEW_ROLLS, type RollLogRow } from '@/lib/preview-data'

/**
 * Unit tests for the GM prompt builders (`P5.7`).
 *
 * A roll turn carries **every** roll resolved since the last one (ADR 0031,
 * amended 2026-11-20): both row ids, both rollers, and the rule that a character
 * whose roll is not in the batch is not narrated. `unresolvedRolls` is only the
 * console's dedupe now, so its filters are asserted directly. The missed-check
 * correction is the other thing worth pinning: it is the only net under a model
 * that narrates a roll without registering it.
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

describe('buildRollBatchPrompt', () => {
  const batch = buildRollBatchPrompt([
    {
      recordId: 'roll-wis',
      data: {
        characterName: 'Kaelen',
        statName: 'wis',
        rawRoll: 14,
        modifier: 3,
        total: 17,
        targetDc: 12,
        outcome: 'success',
      },
    },
    {
      recordId: 'roll-dex',
      data: {
        characterName: 'Vesper',
        statName: 'dex',
        rawRoll: 4,
        modifier: 1,
        total: 5,
        targetDc: 13,
        outcome: 'failure',
      },
    },
  ])

  it('lists every roll with both row ids and both rollers', () => {
    expect(batch).toContain('roll-wis')
    expect(batch).toContain('roll-dex')
    expect(batch).toContain('Kaelen')
    expect(batch).toContain('Vesper')
    expect(batch).toContain('2 rolls resolved')
  })

  it('carries each roll\'s own numbers, not the newest one twice', () => {
    expect(batch).toContain('WIS d20(14) +3 = 17 vs DC 12 — success')
    expect(batch).toContain('DEX d20(4) +1 = 5 vs DC 13 — failure')
    // Two rows, two lines, in the order given.
    expect(batch.indexOf('Kaelen')).toBeLessThan(batch.indexOf('Vesper'))
  })

  it('attributes each roll to its own roller and forbids the rest of the table', () => {
    expect(batch).toContain('attribute it to its own roller only')
    expect(batch).toContain(
      'Never narrate, resolve or advance a character whose roll is not listed here',
    )
  })

  it('keeps the engine-owned numbers and the row to verify against', () => {
    expect(batch).toContain('`roll-logs`')
    expect(batch).toContain('do not roll again')
    expect(batch).toContain('`damage_enemy`')
  })

  it('reads one roll as one, not as a batch of one', () => {
    expect(buildRollBatchPrompt([{ recordId: 'roll-solo', data: {} }])).toContain(
      'One roll resolved',
    )
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

describe('isDuplicateRollBatch', () => {
  const prompt = 'One roll resolved since your last turn: 1. Ash — WIS d20(4) = 4.'

  it('refuses an identical batch written moments ago', () => {
    expect(
      isDuplicateRollBatch({ prompt, previousContent: prompt, previousAgeMs: 1_200 }),
    ).toBe(true)
  })

  it('allows the same text once the window has passed', () => {
    expect(
      isDuplicateRollBatch({ prompt, previousContent: prompt, previousAgeMs: 60_000 }),
    ).toBe(false)
  })

  it('allows a different batch', () => {
    expect(
      isDuplicateRollBatch({ prompt, previousContent: 'something else', previousAgeMs: 500 }),
    ).toBe(false)
  })

  it('allows when there is no previous row or no readable age', () => {
    expect(isDuplicateRollBatch({ prompt, previousContent: null, previousAgeMs: 10 })).toBe(false)
    expect(isDuplicateRollBatch({ prompt, previousContent: prompt, previousAgeMs: null })).toBe(false)
  })
})

describe('buildContinuePrompt', () => {
  it('is a first-person move, not an instruction to the GM', () => {
    const prompt = buildContinuePrompt()
    expect(prompt).toMatch(/^I /)
    // Attribution is a field on the request; the text never carries a name.
    expect(prompt).not.toContain(':')
  })
})
