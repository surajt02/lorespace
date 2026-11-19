import { describe, expect, it } from 'vitest'
import {
  ABILITY_SCORES,
  ARCHETYPE_ORDER,
  ARCHETYPE_PRESETS,
  CONSUMABLE_EFFECTS,
  calculateArmorClass,
  classifyRoll,
  formatModifier,
  getModifier,
  type AbilityScores,
  type ArchetypeName,
  type ItemCategory,
} from '@/lib/d20'
import { PREVIEW_CHARACTERS, PREVIEW_INVENTORY } from '@/lib/preview-data'

/**
 * Unit tests for the pure d20 rules (`P3.2`).
 *
 * These pin the arithmetic the sheet renders and, more importantly, the shape of
 * the four Forge presets: the fixture builds (Vanguard AC 16, Shadowblade AC 14)
 * must be reproducible from preset data alone, or the signed-out table and a
 * forged character drift apart. Values are asserted directly — no snapshots, no
 * jsdom, no randomness: `classifyRoll` is given its d20.
 */

const VALID_CATEGORIES: readonly ItemCategory[] = ['weapon', 'armor', 'consumable', 'quest']

const SCORE_KEYS: readonly (keyof AbilityScores)[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']

describe('getModifier', () => {
  it('floors, so 9 is -1 while 10 and 11 are +0', () => {
    // (score - 10) / 2 floored: odd scores below 10 fall into the lower band.
    expect(getModifier(1)).toBe(-5)
    expect(getModifier(2)).toBe(-4)
    expect(getModifier(9)).toBe(-1)
    expect(getModifier(10)).toBe(0)
    expect(getModifier(11)).toBe(0)
    expect(getModifier(12)).toBe(1)
    expect(getModifier(20)).toBe(5)
  })
})

describe('formatModifier', () => {
  it('always carries a sign and never pads', () => {
    expect(formatModifier(0)).toBe('+0')
    expect(formatModifier(5)).toBe('+5')
    expect(formatModifier(-5)).toBe('-5')
  })

  it('prefixes positive values with a plus', () => {
    expect(formatModifier(3).startsWith('+')).toBe(true)
    expect(formatModifier(0).startsWith('+')).toBe(true)
    expect(formatModifier(-1).startsWith('-')).toBe(true)
  })
})

describe('calculateArmorClass', () => {
  it('is 10 plus the DEX modifier plus the armor bonus', () => {
    expect(calculateArmorClass(10, 0)).toBe(10)
    expect(calculateArmorClass(12, 5)).toBe(16)
    expect(calculateArmorClass(17, 1)).toBe(14)
  })

  it('does not clamp: a negative DEX modifier takes AC below 10', () => {
    expect(calculateArmorClass(1, 0)).toBe(5)
  })
})

describe('ARCHETYPE_PRESETS', () => {
  const names = Object.keys(ARCHETYPE_PRESETS) as ArchetypeName[]

  it('has four archetypes', () => {
    expect(names.sort()).toEqual(['Arcanist', 'Marksman', 'Shadowblade', 'Vanguard'])
  })

  it.each(names)('%s is a forge-ready row', (name) => {
    const preset = ARCHETYPE_PRESETS[name]

    expect(preset.name).toBe(name)
    expect(Number.isInteger(preset.armorBonus)).toBe(true)
    expect(preset.armorBonus).toBeGreaterThan(0)
    expect(preset.maxHp).toBeGreaterThan(0)
    expect(preset.blurb.length).toBeGreaterThan(0)

    for (const key of SCORE_KEYS) {
      expect(Number.isFinite(preset.scores[key])).toBe(true)
    }

    expect(preset.starterItems).toHaveLength(2)
    for (const item of preset.starterItems) {
      expect(item.itemName.length).toBeGreaterThan(0)
      expect(item.description.length).toBeGreaterThan(0)
      expect(VALID_CATEGORIES).toContain(item.category)
      expect(Number.isInteger(item.quantity)).toBe(true)
      expect(item.quantity).toBeGreaterThan(0)
    }
  })

  it('reproduces the signed-out fixture builds', () => {
    // `PREVIEW_CHARACTERS` in `src/lib/preview-data.ts` — Kaelen and Vesper.
    const vanguard = ARCHETYPE_PRESETS.Vanguard
    const shadowblade = ARCHETYPE_PRESETS.Shadowblade

    expect(calculateArmorClass(vanguard.scores.dex, vanguard.armorBonus)).toBe(16)
    expect(calculateArmorClass(shadowblade.scores.dex, shadowblade.armorBonus)).toBe(14)
    expect(vanguard.maxHp).toBe(24)
    expect(shadowblade.maxHp).toBe(17)
  })

  it('matches every fixture score, AC and HP, not just the armor class', () => {
    // The drift guard: a forged Vanguard must render the same numbers as the
    // signed-out Kaelen (and a Shadowblade the same as Vesper). Pinning only AC
    // would let a changed STR or CON split the two tables silently.
    for (const archetype of ['Vanguard', 'Shadowblade'] as const) {
      const fixture = PREVIEW_CHARACTERS.find((record) => record.data.archetype === archetype)
      expect(fixture).toBeDefined()
      const row = fixture!.data
      const preset = ARCHETYPE_PRESETS[archetype]
      const scores = {
        str: row.str,
        dex: row.dex,
        con: row.con,
        int: row.int,
        wis: row.wis,
        cha: row.cha,
      }

      expect(scores).toEqual(preset.scores)
      expect(row.maxHp).toBe(preset.maxHp)
      expect(row.ac).toBe(calculateArmorClass(preset.scores.dex, preset.armorBonus))
      expect(row.hp).toBeLessThanOrEqual(preset.maxHp)
    }
  })

  it('seeds the Vanguard starter pair that the fixture shows', () => {
    const kaelen = PREVIEW_CHARACTERS.find((record) => record.data.archetype === 'Vanguard')
    expect(kaelen).toBeDefined()
    const carried = PREVIEW_INVENTORY.filter(
      (record) => record.data.characterId === kaelen!.recordId,
    ).slice(0, 2)

    expect(
      carried.map((record) => ({
        itemName: record.data.itemName,
        category: record.data.category,
        description: record.data.description,
        quantity: record.data.quantity,
      })),
    ).toEqual(ARCHETYPE_PRESETS.Vanguard.starterItems)
  })

  it('gives Marksman AC 15 and a blurb that describes no spellcaster', () => {
    const marksman = ARCHETYPE_PRESETS.Marksman

    expect(calculateArmorClass(marksman.scores.dex, marksman.armorBonus)).toBe(15)
    expect(marksman.blurb).not.toMatch(/cleric|magic|spell/i)
  })

  it('stocks only weapon, armor and consumable starters — never a quest item', () => {
    // ADR 0016: a quest item is story, not a starting kit.
    for (const name of names) {
      const categories = ARCHETYPE_PRESETS[name].starterItems.map((item) => item.category)
      expect(categories).not.toContain('quest')
      for (const category of categories) {
        expect(['weapon', 'armor', 'consumable']).toContain(category)
      }
    }
  })

  it('gives every consumable starter a positive server-owned heal', () => {
    for (const name of names) {
      for (const item of ARCHETYPE_PRESETS[name].starterItems) {
        if (item.category !== 'consumable') continue

        const effect = CONSUMABLE_EFFECTS[item.itemName]
        expect(effect).toBeDefined()
        expect(effect.heal).toBeGreaterThan(0)
      }
    }
  })

  it('has no effect entry for a non-consumable starter', () => {
    // An effect on a sword would promise a mechanic the build does not have.
    for (const name of names) {
      for (const item of ARCHETYPE_PRESETS[name].starterItems) {
        if (item.category === 'consumable') continue
        expect(CONSUMABLE_EFFECTS[item.itemName]).toBeUndefined()
      }
    }
  })

  it('spells the buckler bonus and every consumable heal in the description', () => {
    const buckler = ARCHETYPE_PRESETS.Vanguard.starterItems[1]
    expect(buckler.description).toBe('Small shield. +5 to your AC')

    // Copy and effect must agree for every consumable: a player reads the row.
    for (const name of names) {
      for (const item of ARCHETYPE_PRESETS[name].starterItems) {
        if (item.category !== 'consumable') continue
        const effect = CONSUMABLE_EFFECTS[item.itemName]
        expect(item.description).toContain(`${effect.heal} HP`)
      }
    }
  })

  it('pins the shipped AC and HP of all four presets', () => {
    const expected = {
      Vanguard: { ac: 16, hp: 24 },
      Shadowblade: { ac: 14, hp: 17 },
      Arcanist: { ac: 14, hp: 18 },
      Marksman: { ac: 15, hp: 19 },
    } as const

    for (const name of names) {
      const preset = ARCHETYPE_PRESETS[name]
      expect(calculateArmorClass(preset.scores.dex, preset.armorBonus)).toBe(expected[name].ac)
      expect(preset.maxHp).toBe(expected[name].hp)
    }
  })
})

describe('classifyRoll', () => {
  it('lets a natural 20 win even against an unreachable DC', () => {
    expect(classifyRoll(20, 1, 99)).toBe('critical_success')
  })

  it('lets a natural 1 lose even when the total clears the DC', () => {
    expect(classifyRoll(1, 99, 0)).toBe('critical_failure')
  })

  it('treats meeting the DC exactly as a success', () => {
    expect(classifyRoll(19, 10, 10)).toBe('success')
    expect(classifyRoll(10, 12, 12)).toBe('success')
  })

  it('fails below the DC', () => {
    expect(classifyRoll(2, 9, 10)).toBe('failure')
  })
})

describe('ABILITY_SCORES', () => {
  it('is the six cards in STR..CHA order', () => {
    expect(ABILITY_SCORES.map((ability) => ability.label)).toEqual([
      'STR',
      'DEX',
      'CON',
      'INT',
      'WIS',
      'CHA',
    ])
  })

  it('names keys that exist on a preset', () => {
    const presetScoreKeys = Object.keys(ARCHETYPE_PRESETS.Vanguard.scores)

    for (const ability of ABILITY_SCORES) {
      expect(presetScoreKeys).toContain(ability.key)
    }
  })
})

describe('ARCHETYPE_ORDER', () => {
  it('covers every preset exactly once', () => {
    const presetNames = Object.keys(ARCHETYPE_PRESETS) as ArchetypeName[]

    expect([...ARCHETYPE_ORDER].sort()).toEqual(presetNames.sort())
    expect(new Set(ARCHETYPE_ORDER).size).toBe(ARCHETYPE_ORDER.length)
  })
})
