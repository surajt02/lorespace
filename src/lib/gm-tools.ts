/**
 * The AI GM's five tools as pure data: names, the chat-turn gate and the input
 * validators that map a model's arguments onto `applyGmMutation`'s wire shape.
 *
 * Nothing here touches the worker, a record or the AI SDK, so the gate and the
 * mapping are unit-testable on their own (`P5.11`, ADR 0022).
 *
 * Two rules this file exists to keep:
 *
 * 1. **Writes only inside the GM turn.** Every tool in the `ToolSet` is also
 *    auto-exposed over HTTP and MCP. The four write tools therefore refuse
 *    unless the request they were built for is the in-app chat turn; the
 *    read-only snapshot stays available everywhere, because the table is
 *    already readable by link (ADR 0014).
 * 2. **Never pass a raw model object through.** Every write tool validates its
 *    input with a zod object, which strips unknown keys, and then rebuilds the
 *    mutation field by field. A model cannot reach a column this file does not
 *    name.
 */

import { z } from 'zod/v4'

/** Read-only, available on every tool surface. */
export const GM_READ_TOOLS = ['get_campaign_snapshot'] as const

/** Owner-credentialed writes, confined to the in-app GM chat turn (ADR 0022). */
export const GM_WRITE_TOOLS = [
  'modify_character_hp',
  'grant_character_loot',
  'update_campaign_scene',
  'damage_enemy',
] as const

export const GM_TOOL_NAMES = [...GM_READ_TOOLS, ...GM_WRITE_TOOLS] as const

export type GmReadToolName = (typeof GM_READ_TOOLS)[number]
export type GmWriteToolName = (typeof GM_WRITE_TOOLS)[number]
export type GmToolName = (typeof GM_TOOL_NAMES)[number]

/** The one route whose request may run a GM write tool (ADR 0022). */
export const GM_CHAT_PATH = '/api/ai/chat'

/** `campaigns.atmosphereTag` options, in schema order. */
export const ATMOSPHERE_TAGS = ['exploration', 'combat', 'tavern', 'dungeon', 'boss'] as const

/** `inventory.category` options, in schema order (ADR 0016: no `relic`). */
export const ITEM_CATEGORIES = ['weapon', 'armor', 'consumable', 'quest'] as const

// ============================================================================
// Input schemas
// ============================================================================

/** `modify_character_hp` — a delta, never an absolute HP value. */
export const modifyCharacterHpInputSchema = z.object({
  characterId: z.string().min(1),
  delta: z.number().int(),
  // Optional narration for the `combat` evidence row (`P5.10`); capped by the
  // action's schema too.
  reason: z.string().max(200).optional(),
})

/** `grant_character_loot` — one item into one character's pack. */
export const grantCharacterLootInputSchema = z.object({
  characterId: z.string().min(1),
  itemName: z.string().min(1),
  category: z.enum(ITEM_CATEGORIES).optional(),
  description: z.string().max(500).optional(),
  quantity: z.number().int().positive().optional(),
})

/**
 * `update_campaign_scene` — the scene half of the campaign row, never `title`.
 * `sceneIndex` is the arc position (ADR 0023): the action refuses anything but
 * `current + 1` with the current scene's exit met, so a model can ask to
 * advance but cannot skip or rewind.
 */
export const updateCampaignSceneInputSchema = z.object({
  locationName: z.string().optional(),
  atmosphereTag: z.enum(ATMOSPHERE_TAGS).optional(),
  sceneSummary: z.string().optional(),
  activeThreatDc: z.number().optional(),
  enemyName: z.string().optional(),
  enemyHp: z.number().optional(),
  enemyMaxHp: z.number().optional(),
  sceneIndex: z.number().int().min(0).max(4).optional(),
})

/**
 * `damage_enemy` — one hit against the scene enemy (ADR 0024). An amount, never
 * an absolute HP value: the engine reads `enemyHp`, clamps and logs it.
 */
export const damageEnemyInputSchema = z.object({
  amount: z.number().int().min(1).max(50),
  reason: z.string().max(200).optional(),
})

/** Model-facing input schema per write tool, for `tool({ inputSchema })`. */
export const gmWriteInputSchemas = {
  modify_character_hp: modifyCharacterHpInputSchema,
  grant_character_loot: grantCharacterLootInputSchema,
  update_campaign_scene: updateCampaignSceneInputSchema,
  damage_enemy: damageEnemyInputSchema,
} satisfies Record<GmWriteToolName, z.ZodType>

// ============================================================================
// The chat-turn gate (ADR 0022)
// ============================================================================

/**
 * Whether `toolName` may run for a request whose path is `pathname`.
 *
 * Writes are allowed only on the in-app GM chat turn. An unknown name is
 * refused, and the read-only snapshot is always allowed — a rename or a new
 * surface fails closed for writes, never open.
 */
export function gmToolAllowedForPath(toolName: string, pathname: string): boolean {
  if (toolName === GM_READ_TOOLS[0]) return true
  if (!(GM_WRITE_TOOLS as readonly string[]).includes(toolName)) return false
  return pathname === GM_CHAT_PATH
}

// ============================================================================
// Validation + mapping onto `applyGmMutation`
// ============================================================================

/** The `{ kind, ... }` payload `applyGmMutation` parses from `params.mutation`. */
export type GmMutation =
  | { kind: 'character_hp'; characterId: string; delta: number; reason?: string }
  | {
      kind: 'grant_loot'
      characterId: string
      item: {
        itemName: string
        category?: (typeof ITEM_CATEGORIES)[number]
        description?: string
        quantity?: number
      }
    }
  | {
      kind: 'update_scene'
      scene: {
        locationName?: string
        atmosphereTag?: (typeof ATMOSPHERE_TAGS)[number]
        sceneSummary?: string
        activeThreatDc?: number
        enemyName?: string
        enemyHp?: number
        enemyMaxHp?: number
        sceneIndex?: number
      }
    }
  | { kind: 'enemy_damage'; amount: number; reason?: string }

/**
 * Maps a model's tool call onto the action's mutation shape, or `null` when the
 * tool name is unknown or the arguments fail validation (unknown keys are
 * stripped, bad enums and over-long strings are refused).
 */
export function toGmMutation(toolName: string, args: unknown): GmMutation | null {
  const input = args ?? {}

  switch (toolName) {
    case 'modify_character_hp': {
      const parsed = modifyCharacterHpInputSchema.safeParse(input)
      if (!parsed.success) return null
      const { characterId, delta, reason } = parsed.data
      return reason === undefined
        ? { kind: 'character_hp', characterId, delta }
        : { kind: 'character_hp', characterId, delta, reason }
    }
    case 'grant_character_loot': {
      const parsed = grantCharacterLootInputSchema.safeParse(input)
      if (!parsed.success) return null
      const { characterId, itemName, category, description, quantity } = parsed.data
      return {
        kind: 'grant_loot',
        characterId,
        item: {
          itemName,
          ...(category === undefined ? {} : { category }),
          ...(description === undefined ? {} : { description }),
          ...(quantity === undefined ? {} : { quantity }),
        },
      }
    }
    case 'update_campaign_scene': {
      const parsed = updateCampaignSceneInputSchema.safeParse(input)
      if (!parsed.success) return null
      const {
        locationName,
        atmosphereTag,
        sceneSummary,
        activeThreatDc,
        enemyName,
        enemyHp,
        enemyMaxHp,
        sceneIndex,
      } = parsed.data
      return {
        kind: 'update_scene',
        scene: {
          ...(locationName === undefined ? {} : { locationName }),
          ...(atmosphereTag === undefined ? {} : { atmosphereTag }),
          ...(sceneSummary === undefined ? {} : { sceneSummary }),
          ...(activeThreatDc === undefined ? {} : { activeThreatDc }),
          ...(enemyName === undefined ? {} : { enemyName }),
          ...(enemyHp === undefined ? {} : { enemyHp }),
          ...(enemyMaxHp === undefined ? {} : { enemyMaxHp }),
          ...(sceneIndex === undefined ? {} : { sceneIndex }),
        },
      }
    }
    case 'damage_enemy': {
      const parsed = damageEnemyInputSchema.safeParse(input)
      if (!parsed.success) return null
      const { amount, reason } = parsed.data
      return reason === undefined
        ? { kind: 'enemy_damage', amount }
        : { kind: 'enemy_damage', amount, reason }
    }
    default:
      return null
  }
}
