import { describe, expect, it } from 'vitest'
import type { RecordData } from 'deepspace'
import {
  GM_CHIPS,
  buildQuickPrompt,
  buildRollPrompt,
  unresolvedRolls,
  type GmChipKind,
} from '@/lib/gm-prompts'
import { PREVIEW_ROLLS, type RollLogRow } from '@/lib/preview-data'

/**
 * Unit tests for the GM prompt builders (`P5.7`).
 *
 * Two things are worth pinning without a browser: a chip prompt never degrades
 * into a placeholder (the GM would answer "undefined took a rest"), and the
 * automatic turn carries the `roll-logs` numbers verbatim with a stable payload
 * (ADR 0009 — the model verifies, it does not invent). `unresolvedRolls` is the
 * whole one-turn-per-roll cap (ADR 0012), so its filters are asserted directly.
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

describe('GM_CHIPS', () => {
  it('offers four distinct kinds with non-empty labels', () => {
    expect(GM_CHIPS).toHaveLength(4)
    expect(new Set(GM_CHIPS.map((chip) => chip.kind)).size).toBe(4)
    for (const chip of GM_CHIPS) {
      expect(chip.label.trim().length).toBeGreaterThan(0)
    }
  })

  it('names the four kinds the panel renders', () => {
    expect(GM_CHIPS.map((chip) => chip.kind)).toEqual([
      'inspect',
      'resolve',
      'attack',
      'rest',
    ])
  })
})

describe('buildQuickPrompt', () => {
  const kinds = GM_CHIPS.map((chip) => chip.kind) as GmChipKind[]

  it('names the character when one is known', () => {
    for (const kind of kinds) {
      expect(buildQuickPrompt(kind, { characterName: 'Vesper' })).toContain('Vesper')
    }
  })

  it('carries the latest roll numbers for resolve and attack', () => {
    for (const kind of ['resolve', 'attack'] as const) {
      const prompt = buildQuickPrompt(kind, {
        characterName: 'Kaelen',
        latestRoll: KAELEN_DOOR.data,
      })
      expect(prompt).toContain('d20(14)')
      expect(prompt).toContain('+3')
      expect(prompt).toContain('= 17')
      expect(prompt).toContain('DC 12')
      expect(prompt).toContain('success')
    }
  })

  it('asks for a check instead of referencing a roll it does not have', () => {
    const prompt = buildQuickPrompt('resolve', { characterName: 'Kaelen' })
    expect(prompt).toContain('roll-logs')
    expect(prompt).not.toMatch(/d20\(/)
  })

  it('never emits a placeholder for a missing name or roll', () => {
    for (const kind of kinds) {
      for (const ctx of [{}, { characterName: null }, { latestRoll: null }]) {
        const prompt = buildQuickPrompt(kind, ctx)
        expect(prompt).not.toContain('undefined')
        expect(prompt).not.toContain('null')
        expect(prompt.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('says the same thing for every kind with no context at all', () => {
    // An unknown name must not change the action the chip performs.
    expect(buildQuickPrompt('rest')).toContain('short rest')
    expect(buildQuickPrompt('inspect')).toContain('inspect the room')
  })
})

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
