/**
 * d20 rules — pure, deterministic, zero imports (`P3.1`).
 *
 * This module is the single home for the arithmetic the character sheet renders
 * and the one classifier the Cloudflare Worker imports in `P4.4` to settle a
 * server-side roll. It therefore imports nothing, touches no browser global and
 * generates no randomness: the caller supplies the d20's raw result, so the
 * browser never computes a roll (ADR 0005).
 *
 * Armor class is display-only in this build — nothing attacks it, and no monster
 * or damage roll exists (ADR 0010, ADR 0011).
 */

export type ArchetypeName = 'Vanguard' | 'Shadowblade' | 'Arcanist' | 'Cleric'

export type ItemCategory = 'weapon' | 'armor' | 'consumable' | 'relic' | 'quest'

export interface AbilityScores {
  str: number
  dex: number
  con: number
  int: number
  wis: number
  cha: number
}

/** One starter `inventory` row, minus the ids the write path adds (`P3.4`). */
export interface StarterItem {
  itemName: string
  category: ItemCategory
  description: string
  quantity: number
}

export interface ArchetypePreset {
  name: ArchetypeName
  blurb: string
  armorBonus: number
  maxHp: number
  scores: AbilityScores
  starterItems: [StarterItem, StarterItem]
}

export type RollOutcome = 'critical_success' | 'success' | 'failure' | 'critical_failure'

/** The sheet's six cards, in render order. */
export const ABILITY_SCORES: readonly { key: keyof AbilityScores; label: string }[] = [
  { key: 'str', label: 'STR' },
  { key: 'dex', label: 'DEX' },
  { key: 'con', label: 'CON' },
  { key: 'int', label: 'INT' },
  { key: 'wis', label: 'WIS' },
  { key: 'cha', label: 'CHA' },
]

/** (score - 10) / 2, rounded down — so 10 and 11 give +0, and 9 gives -1. */
export function getModifier(score: number): number {
  return Math.floor((score - 10) / 2)
}

/** `0` → `'+0'`, `-1` → `'-1'`. Always signed, never zero-padded. */
export function formatModifier(modifier: number): string {
  return modifier >= 0 ? `+${modifier}` : `${modifier}`
}

/** Unarmored base 10 plus the DEX modifier plus the preset's armor bonus. */
export function calculateArmorClass(dexScore: number, armorBonus: number): number {
  return 10 + getModifier(dexScore) + armorBonus
}

/**
 * Nat 20 and nat 1 override the total: a natural 20 is a critical success even
 * against a DC it could not reach, and a natural 1 fails even when the total
 * clears. Otherwise the total decides, and meeting the DC exactly succeeds.
 */
export function classifyRoll(rawRoll: number, total: number, targetDc: number): RollOutcome {
  if (rawRoll === 20) return 'critical_success'
  if (rawRoll === 1) return 'critical_failure'
  return total >= targetDc ? 'success' : 'failure'
}

/**
 * The four Forge presets. Scores are 5e-shaped (10–11 is the +0 band) and the
 * Vanguard/Shadowblade pairs reproduce `PREVIEW_CHARACTERS` exactly, so the
 * signed-out table and a forged character cannot drift.
 */
export const ARCHETYPE_PRESETS: Record<ArchetypeName, ArchetypePreset> = {
  Vanguard: {
    name: 'Vanguard',
    blurb: 'Holds the line in mail and takes the hit others cannot.',
    armorBonus: 5,
    maxHp: 24,
    scores: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 11 },
    starterItems: [
      {
        itemName: 'Ashen Longsword',
        category: 'weapon',
        description: 'Pitted steel, still warm. The grip is wrapped in grave-linen.',
        quantity: 1,
      },
      {
        itemName: 'Cracked Buckler',
        category: 'armor',
        description: 'A knuckle-shaped dent from something that did not stop at the shield.',
        quantity: 1,
      },
    ],
  },
  Shadowblade: {
    name: 'Shadowblade',
    blurb: 'Strikes from the dark and is gone before the shouting starts.',
    armorBonus: 1,
    maxHp: 17,
    scores: { str: 10, dex: 17, con: 12, int: 12, wis: 10, cha: 14 },
    starterItems: [
      {
        itemName: 'Whisper Dagger',
        category: 'weapon',
        description: 'Short, black, and quieter than the hand that holds it.',
        quantity: 1,
      },
      {
        itemName: 'Grave-Linen Cloak',
        category: 'armor',
        description:
          'Stitched from winding sheets. It does not keep out the cold, only the notice.',
        quantity: 1,
      },
    ],
  },
  Arcanist: {
    name: 'Arcanist',
    blurb: 'Reads what was never meant to be written and pays for every word.',
    armorBonus: 2,
    maxHp: 18,
    scores: { str: 8, dex: 14, con: 12, int: 16, wis: 13, cha: 10 },
    starterItems: [
      {
        itemName: 'Cinder Focus',
        category: 'relic',
        description: 'A thumb of obsidian that warms when a word is left unspoken.',
        quantity: 1,
      },
      {
        itemName: 'Sunfire Vial',
        category: 'consumable',
        description: 'Sealed glass of noon. Burns the dark off a wound.',
        quantity: 2,
      },
    ],
  },
  Cleric: {
    name: 'Cleric',
    blurb: 'Carries a candle into the crypt and does not look away.',
    armorBonus: 4,
    maxHp: 22,
    scores: { str: 12, dex: 10, con: 15, int: 10, wis: 16, cha: 11 },
    starterItems: [
      {
        itemName: 'Reliquary Maul',
        category: 'weapon',
        description: 'Iron worn smooth by hands that prayed before they swung.',
        quantity: 1,
      },
      {
        itemName: 'Vigil Candle',
        category: 'consumable',
        description: 'It burns without being lit, for as long as someone is watching.',
        quantity: 2,
      },
    ],
  },
}

/** Forge button order. */
export const ARCHETYPE_ORDER: readonly ArchetypeName[] = [
  'Vanguard',
  'Shadowblade',
  'Arcanist',
  'Cleric',
]
