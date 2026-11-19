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
 *
 * It also holds the four Forge presets and the one meaning each item category
 * carries (ADR 0016):
 *
 * - `weapon` — the character's attack weapon. No attack roll exists; the GM
 *   narrates hits.
 * - `armor` — light or heavy armor. Its bonus is already baked into
 *   `characters.ac` at Forge; it is carried, not equipped.
 * - `consumable` — drink or bind to restore HP. The server applies the heal and
 *   spends a charge (`useItem`, ADR 0015); the amount lives in
 *   `CONSUMABLE_EFFECTS` below, never in the request.
 * - `quest` — a quest object (key, sigil): no mechanical effect, not usable.
 */

export type ArchetypeName = 'Vanguard' | 'Shadowblade' | 'Arcanist' | 'Marksman'

export type ItemCategory = 'weapon' | 'armor' | 'consumable' | 'quest'

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

/**
 * The same number with air around the sign: `0` → `'+ 0'`, `-1` → `'- 1'`.
 *
 * Used where the roll line is read as a sentence rather than scanned as a
 * column — the roll banner and the feed entry — while the sheet's stat cards
 * keep the tight `formatModifier` so six of them still fit three to a row.
 * One line of arithmetic, two registers.
 */
export function formatModifierSpaced(modifier: number): string {
  return modifier >= 0 ? `+ ${modifier}` : `- ${Math.abs(modifier)}`
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
    blurb: 'Front-line fighter. High STR and CON, heavy mail, the most HP.',
    armorBonus: 5,
    maxHp: 24,
    scores: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 11 },
    starterItems: [
      {
        itemName: 'Ashen Longsword',
        category: 'weapon',
        description: 'One-handed sword. Your main weapon in a fight.',
        quantity: 1,
      },
      {
        itemName: 'Cracked Buckler',
        category: 'armor',
        description: 'Small shield. +5 to your AC',
        quantity: 1,
      },
    ],
  },
  Shadowblade: {
    name: 'Shadowblade',
    blurb: 'Stealth and close work. High DEX and CHA, light armor.',
    armorBonus: 1,
    maxHp: 17,
    scores: { str: 10, dex: 17, con: 12, int: 12, wis: 10, cha: 14 },
    starterItems: [
      {
        itemName: 'Whisper Dagger',
        category: 'weapon',
        description: 'Light blade for close work. Your main weapon.',
        quantity: 1,
      },
      {
        itemName: 'Grave-Linen Cloak',
        category: 'armor',
        description: 'Light armor. Its +1 is already in your AC.',
        quantity: 1,
      },
    ],
  },
  Arcanist: {
    name: 'Arcanist',
    blurb: 'Magic user. High INT and WIS, warded robes, a healing vial.',
    armorBonus: 2,
    maxHp: 18,
    scores: { str: 8, dex: 14, con: 12, int: 16, wis: 13, cha: 10 },
    starterItems: [
      {
        itemName: 'Emberwood Staff',
        category: 'weapon',
        description: 'Two-handed focus for casting. Your main weapon.',
        quantity: 1,
      },
      {
        itemName: 'Sunfire Vial',
        category: 'consumable',
        description: 'Drink to restore 6 HP, up to your maximum. One use.',
        quantity: 2,
      },
    ],
  },
  Marksman: {
    name: 'Marksman',
    blurb: 'Ranged attacker. High DEX and WIS, a longbow and a field dressing.',
    armorBonus: 2,
    maxHp: 19,
    scores: { str: 10, dex: 16, con: 12, int: 10, wis: 14, cha: 11 },
    starterItems: [
      {
        itemName: 'Yew Longbow',
        category: 'weapon',
        description: 'Ranged weapon for attacks at a distance. Your main weapon.',
        quantity: 1,
      },
      {
        itemName: 'Field Dressing',
        category: 'consumable',
        description: 'Bind a wound to restore 4 HP, up to your maximum. One use.',
        quantity: 1,
      },
    ],
  },
}

/** Forge button order. */
export const ARCHETYPE_ORDER: readonly ArchetypeName[] = [
  'Vanguard',
  'Shadowblade',
  'Arcanist',
  'Marksman',
]

/** What a consumable does when used. The `heal` amount is the server's. */
export interface ConsumableEffect {
  heal: number
}

/**
 * Server-owned item effects, keyed by item name (ADR 0016).
 *
 * `useItem` reads the heal from here, never from the request, and refuses an
 * unknown consumable instead of silently spending a charge — the same trust
 * model as rolls (ADR 0005, ADR 0015). A new consumable needs an entry here
 * before it does anything, including one the GM grants (`P5.3`).
 */
export const CONSUMABLE_EFFECTS: Record<string, ConsumableEffect> = {
  'Sunfire Vial': { heal: 6 },
  'Field Dressing': { heal: 4 },
}
