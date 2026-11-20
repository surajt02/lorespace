import { describe, expect, it } from 'vitest'
import type { RecordData } from 'deepspace'
import {
  GM_CHIPS,
  buildOpeningPrompt,
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

  it('never writes the speaker prefix itself (attribution is a route field)', () => {
    // The console sends `characterName` beside the content and the route adds
    // the model-side prefix, so a chip that also prefixed would reach the model
    // as "Ash: Ash inspects the room".
    for (const kind of kinds) {
      expect(buildQuickPrompt(kind, { latestRoll: KAELEN_DOOR.data })).not.toMatch(/^\w+: /)
    }
  })

  it('carries the latest roll numbers for resolve', () => {
    const prompt = buildQuickPrompt('resolve', {
      latestRoll: KAELEN_DOOR.data,
    })
    expect(prompt).toContain('d20(14)')
    expect(prompt).toContain('+3')
    expect(prompt).toContain('= 17')
    expect(prompt).toContain('DC 12')
    expect(prompt).toContain('success')
  })

  it('narrates an attack in the first person instead of ordering one (ADR 0024)', () => {
    const prompt = buildQuickPrompt('attack', {
      enemyName: 'Runebound Sentinel',
    })
    expect(prompt).toContain('I move to strike Runebound Sentinel')
    expect(prompt).toMatch(/tell me what to roll/)
    // Narration, not a menu: no verb-first order, and no dice line before the
    // GM has called for a check.
    expect(prompt).not.toMatch(/^attack/i)
    expect(prompt).not.toMatch(/d20\(/)
  })

  it('names a generic enemy when the scene has none, and never a placeholder', () => {
    for (const enemyName of [undefined, null, '', '   ']) {
      const prompt = buildQuickPrompt('attack', { enemyName })
      expect(prompt).toContain('I move to strike the enemy')
      expect(prompt).not.toContain('undefined')
      expect(prompt).not.toContain('null')
    }
    // Readable on its own: the sentence still stands without any context.
    const anonymous = buildQuickPrompt('attack', { enemyName: 'Runebound Sentinel' })
    expect(anonymous.startsWith('I move to strike Runebound Sentinel')).toBe(true)
  })

  it('asks for a check instead of referencing a roll it does not have', () => {
    const prompt = buildQuickPrompt('resolve')
    expect(prompt).toContain('roll-logs')
    expect(prompt).not.toMatch(/d20\(/)
  })

  it('never emits a placeholder for a missing roll', () => {
    for (const kind of kinds) {
      for (const ctx of [{}, { latestRoll: null }]) {
        const prompt = buildQuickPrompt(kind, ctx)
        expect(prompt).not.toContain('undefined')
        expect(prompt).not.toContain('null')
        expect(prompt.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('says the same thing for every kind with no context at all', () => {
    // A missing roll or enemy must not change the action the chip performs.
    expect(buildQuickPrompt('rest')).toContain('rest')
    expect(buildQuickPrompt('inspect')).toMatch(/inspect the room/i)
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
