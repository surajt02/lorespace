/**
 * Preview fixture — the signed-out table (ADR 0014, `P1.9`).
 *
 * Row shapes are the four registered collections' exact columns (no invented
 * fields) and each array is `RecordData<T>[]`, the type `useQuery` returns, so
 * Phase 3 swaps `preview` for `records` without touching markup.
 *
 * `PREVIEW_CAMPAIGN` is the **threshold** state of ADR 0011's arc and is the
 * same row `P2.3` must seed — the drift guard. Values are literal and
 * deterministic: fixed ISO stamps and fixed epoch `rolledAt`, never
 * `Date.now()`, because this module is rendered in the prerender pass too.
 */

import type { RecordData } from 'deepspace'
import type { GmMessage } from '@/components/GmConsolePanel'
import { DEFAULT_CAMPAIGN_ID } from '@/constants'
import { DEFAULT_CAMPAIGN_SEED, type CampaignRow } from './campaign-seed'

// The row shape and the seeded scene live in `campaign-seed.ts` so the live
// seed and this fixture cannot drift. Re-exported here because call sites
// import `CampaignRow` from the fixture module.
export type { CampaignRow } from './campaign-seed'

/** `characters` — 15 columns. `userId` is `userBound` on the server. */
export interface CharacterRow {
  userId: string
  campaignId: string
  name: string
  archetype: string
  hp: number
  maxHp: number
  ac: number
  str: number
  dex: number
  con: number
  int: number
  wis: number
  cha: number
  /** The check this character owes (`P5.31`): `''` stat / `0` DC is none. */
  pendingStat?: string
  pendingDc?: number
}

/** `inventory` — 7 columns. `characterId` holds a character **recordId**. */
export interface InventoryRow {
  userId: string
  characterId: string
  campaignId: string
  itemName: string
  category: string
  description: string
  quantity: number
}

/**
 * `roll-logs` — 12 columns. `rolledAt` is a datetime (epoch ms); `statName` is
 * the lower-case ability key the select declares, so the fixture and a live row
 * are the same shape and the UI upper-cases both for display.
 */
export interface RollLogRow {
  userId: string
  campaignId: string
  characterName: string
  entryType: string
  statName: string
  rawRoll: number
  modifier: number
  total: number
  targetDc: number
  outcome: string
  summary: string
  rolledAt: number
}

const CAMPAIGN_CREATED_AT = '2026-11-18T00:00:00.000Z'
const CHARACTER_CREATED_AT = '2026-11-18T00:05:00.000Z'
const INVENTORY_CREATED_AT = '2026-11-18T00:10:00.000Z'
const ROLL_CREATED_AT = '2026-11-18T19:20:00.000Z'

/** Envelope shared by every fixture row — the fixture is not a write. */
const ENVELOPE = { createdBy: 'preview' } as const

export const PREVIEW_CAMPAIGN: RecordData<CampaignRow> = {
  recordId: DEFAULT_CAMPAIGN_ID,
  data: DEFAULT_CAMPAIGN_SEED,
  ...ENVELOPE,
  createdAt: CAMPAIGN_CREATED_AT,
  updatedAt: CAMPAIGN_CREATED_AT,
}

export const PREVIEW_CHARACTERS: RecordData<CharacterRow>[] = [
  {
    recordId: 'char-kaelen',
    data: {
      userId: 'preview-kaelen',
      campaignId: DEFAULT_CAMPAIGN_ID,
      name: 'Kaelen',
      archetype: 'Vanguard',
      hp: 22,
      maxHp: 24,
      ac: 16,
      str: 16,
      dex: 12,
      con: 14,
      int: 8,
      wis: 10,
      cha: 11,
    },
    ...ENVELOPE,
    createdAt: CHARACTER_CREATED_AT,
    updatedAt: CHARACTER_CREATED_AT,
  },
  {
    recordId: 'char-vesper',
    data: {
      userId: 'preview-vesper',
      campaignId: DEFAULT_CAMPAIGN_ID,
      name: 'Vesper',
      archetype: 'Shadowblade',
      hp: 17,
      maxHp: 17,
      ac: 14,
      str: 10,
      dex: 17,
      con: 12,
      int: 12,
      wis: 10,
      cha: 14,
    },
    ...ENVELOPE,
    createdAt: CHARACTER_CREATED_AT,
    updatedAt: CHARACTER_CREATED_AT,
  },
]

export const PREVIEW_INVENTORY: RecordData<InventoryRow>[] = [
  {
    recordId: 'item-ashen-longsword',
    data: {
      userId: 'preview-kaelen',
      characterId: 'char-kaelen',
      campaignId: DEFAULT_CAMPAIGN_ID,
      itemName: 'Ashen Longsword',
      category: 'weapon',
      description: 'One-handed sword. Your main weapon in a fight.',
      quantity: 1,
    },
    ...ENVELOPE,
    createdAt: INVENTORY_CREATED_AT,
    updatedAt: INVENTORY_CREATED_AT,
  },
  {
    recordId: 'item-cracked-buckler',
    data: {
      userId: 'preview-kaelen',
      characterId: 'char-kaelen',
      campaignId: DEFAULT_CAMPAIGN_ID,
      itemName: 'Cracked Buckler',
      category: 'armor',
      description: 'Small shield. +5 to your AC',
      quantity: 1,
    },
    ...ENVELOPE,
    createdAt: INVENTORY_CREATED_AT,
    updatedAt: INVENTORY_CREATED_AT,
  },
  {
    recordId: 'item-sunfire-vial',
    data: {
      userId: 'preview-kaelen',
      characterId: 'char-kaelen',
      campaignId: DEFAULT_CAMPAIGN_ID,
      itemName: 'Sunfire Vial',
      category: 'consumable',
      description: 'Drink to restore 6 HP, up to your maximum. One use.',
      quantity: 2,
    },
    ...ENVELOPE,
    createdAt: INVENTORY_CREATED_AT,
    updatedAt: INVENTORY_CREATED_AT,
  },
]

/** Newest first — `ActionFeed` renders in the order given. */
export const PREVIEW_ROLLS: RecordData<RollLogRow>[] = [
  {
    recordId: 'roll-kaelen-door',
    data: {
      userId: 'preview-kaelen',
      campaignId: DEFAULT_CAMPAIGN_ID,
      characterName: 'Kaelen',
      entryType: 'roll',
      statName: 'str',
      rawRoll: 14,
      modifier: 3,
      total: 17,
      targetDc: 12,
      outcome: 'success',
      summary: 'Kaelen shoulders the sealed door and it grinds open.',
      rolledAt: 1795030920000,
    },
    ...ENVELOPE,
    createdAt: ROLL_CREATED_AT,
    updatedAt: ROLL_CREATED_AT,
  },
  {
    recordId: 'roll-vesper-ash',
    data: {
      userId: 'preview-vesper',
      campaignId: DEFAULT_CAMPAIGN_ID,
      characterName: 'Vesper',
      entryType: 'roll',
      statName: 'dex',
      rawRoll: 1,
      modifier: 3,
      total: 4,
      targetDc: 12,
      outcome: 'critical_failure',
      summary: 'Ash gives way under Vesper. The causeway answers with a crack.',
      rolledAt: 1795030740000,
    },
    ...ENVELOPE,
    createdAt: ROLL_CREATED_AT,
    updatedAt: ROLL_CREATED_AT,
  },
  {
    recordId: 'roll-gm-brazier',
    data: {
      userId: 'preview-gm',
      campaignId: DEFAULT_CAMPAIGN_ID,
      characterName: 'Game Master',
      entryType: 'gm_event',
      statName: '',
      rawRoll: 0,
      modifier: 0,
      total: 0,
      targetDc: 0,
      outcome: 'info',
      summary: 'Green fire gutters in the braziers. Beyond the door, something shifts.',
      rolledAt: 1795030260000,
    },
    ...ENVELOPE,
    createdAt: ROLL_CREATED_AT,
    updatedAt: ROLL_CREATED_AT,
  },
  {
    recordId: 'roll-combat-rubble',
    data: {
      userId: 'preview-kaelen',
      campaignId: DEFAULT_CAMPAIGN_ID,
      characterName: 'Kaelen',
      entryType: 'combat',
      statName: '',
      rawRoll: 0,
      modifier: 0,
      total: 0,
      targetDc: 0,
      outcome: 'info',
      summary: 'A lintel collapses behind the party. Rubble seals the way back.',
      rolledAt: 1795029840000,
    },
    ...ENVELOPE,
    createdAt: ROLL_CREATED_AT,
    updatedAt: ROLL_CREATED_AT,
  },
]

/**
 * Static GM stream for the preview table. `GmConsolePanel` renders these in
 * order; the GM console replaces the list with the real `/api/gm/chat` stream, so the
 * shape is the component's `GmMessage`, not a record row.
 */
export const PREVIEW_GM_MESSAGES: GmMessage[] = [
  {
    id: 'gm-threshold-1',
    role: 'gm',
    text: 'The causeway narrows. Green fire turns the drifting ash to glass underfoot.',
  },
  {
    id: 'gm-threshold-2',
    role: 'player',
    text: 'Kaelen sets one shoulder against the sealed door and waits for the party.',
  },
  {
    id: 'gm-threshold-3',
    role: 'gm',
    text: 'The door gives a handwidth. On the far side, something breathes and does not move.',
  },
]
