import { z } from 'zod/v4'
import type { ActionContext, ActionHandler, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { DEFAULT_CAMPAIGN_ID } from '../constants'
import { DEFAULT_CAMPAIGN_SEED, isAtmosphereTag } from '../lib/campaign-seed'
import { ARCHETYPE_PRESETS, CONSUMABLE_EFFECTS, calculateArmorClass, classifyRoll, formatModifier, getModifier } from '../lib/d20'
import type { RollOutcome } from '../lib/d20'
import { rollD20FromBytes } from '../lib/rng'

/**
 * App server actions. Reached only over `POST /api/actions/:name`, which
 * requires a bearer token and hands each handler `tools` running with
 * per-record RBAC off (`src/server/action-routes.ts` states the trust model):
 * identity is established by the route, but **ownership is this file's job**.
 *
 * Members cannot write `characters` at all and can only update/delete their own
 * `inventory` rows (ADR 0015): the actions below are the only paths that create
 * characters or items. There is no player HP path (ADR 0020) — `hp` moves only
 * through `applyGmMutation`'s `character_hp` kind (ADR 0017) and `useItem`'s
 * bounded healing (ADR 0016). Each action therefore checks `userId` itself
 * before writing.
 *
 * There are no transactions across `tools.*` calls. Each action below writes in
 * a fixed order, stops at the first failure, and reports what already landed
 * instead of implying the change was atomic.
 */

/** The `characters` columns the actions read before writing (`userId` included). */
interface CharacterTarget {
  [key: string]: unknown
  userId: string
  campaignId: string
  // The name a GM mutation logs its `roll-logs` row under (`P5.10`).
  name: string
  hp: number
  maxHp: number
}

/** The `characters` columns Forge's "one character per player" check needs. */
interface MembershipRow {
  [key: string]: unknown
  userId: string
  campaignId: string
}

/**
 * The `characters` columns `rollSkillCheck` reads: ownership, the campaign the
 * row belongs to (never the caller's claim), the name the row is logged under,
 * and the six ability scores the modifier comes from.
 */
interface RollTarget extends CharacterTarget {
  name: string
  str: number
  dex: number
  con: number
  int: number
  wis: number
  cha: number
}

/** The one `campaigns` column a roll reads: the scene's DC. */
interface RollCampaignTarget {
  [key: string]: unknown
  activeThreatDc: number
}

/** `inventory.category`'s select options, in schema order (ADR 0016: no `relic`). */
const ITEM_CATEGORIES = ['weapon', 'armor', 'consumable', 'quest'] as const

/** Scene columns `update_scene` may write, in write order. */
const SCENE_COLUMNS = [
  'locationName',
  'atmosphereTag',
  'sceneSummary',
  'activeThreatDc',
  'enemyName',
  'enemyHp',
  'enemyMaxHp',
] as const

type SceneColumn = (typeof SCENE_COLUMNS)[number]

const itemSchema = z.object({
  itemName: z.string().min(1),
  category: z.enum(ITEM_CATEGORIES).optional(),
  description: z.string().optional(),
  quantity: z.number().int().positive().optional(),
})

// Unknown keys are stripped (zod's default), and `title` is not a key here at
// all — `update_scene` can never rename the campaign.
const sceneSchema = z.object({
  locationName: z.string().optional(),
  atmosphereTag: z
    .string()
    .refine(
      isAtmosphereTag,
      'atmosphereTag must be one of: exploration, combat, tavern, dungeon, boss',
    )
    .optional(),
  sceneSummary: z.string().optional(),
  activeThreatDc: z.number().optional(),
  enemyName: z.string().optional(),
  enemyHp: z.number().optional(),
  enemyMaxHp: z.number().optional(),
})

const gmMutationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('character_hp'),
    characterId: z.string().min(1),
    delta: z.number(),
    // Optional narration for the `combat` evidence row (`P5.10`): the GM says
    // why HP moved, and the feed keeps that sentence. Never required, so an
    // older caller that only sends `delta` still works.
    reason: z.string().trim().max(200).optional(),
  }),
  z.object({
    kind: z.literal('grant_loot'),
    characterId: z.string().min(1),
    item: itemSchema,
  }),
  z.object({
    kind: z.literal('update_scene'),
    scene: sceneSchema,
  }),
])

const applyGmMutationParamsSchema = z.object({ mutation: gmMutationSchema })

export interface EnsureDefaultCampaignData {
  campaignId: string
  created: boolean
}

/**
 * Whether the mutation left its `roll-logs` evidence row behind (`P5.10`).
 *
 * A mutation and its evidence row are two writes with no transaction between
 * them: when the second fails the first has already happened. So `logged: false`
 * is reported **on a successful mutation**, with `details.applied` naming the
 * record that was written and `logError` naming the failed evidence write — never
 * a failure that would imply the HP/loot/scene change did not land.
 */
export interface GmMutationLogReport {
  logged: boolean
  details?: { applied: string[]; logError?: string }
}

export type GmMutationData = GmMutationLogReport &
  (
    | {
        kind: 'character_hp'
        characterId: string
        hp: { before: number; after: number; maxHp: number; appliedDelta: number }
      }
    | {
        kind: 'grant_loot'
        characterId: string
        item: { recordId: string; itemName: string; quantity: number }
      }
    | { kind: 'update_scene'; scene: { applied: string[] } }
  )

/**
 * Seeds the one shared campaign (ADR 0007).
 *
 * Query-then-upsert: an existing row means no write at all, and the known-id
 * `create` is an upsert, so two tabs racing on an empty collection converge on
 * one row (both may report `created: true` — harmless, and cheaper than a
 * read-your-write round-trip).
 */
export async function ensureDefaultCampaign(
  ctx: ActionContext<Env>,
): Promise<ActionResult<EnsureDefaultCampaignData>> {
  // Look for the seeded row itself, not "any campaigns row": members may create
  // campaigns (`member: create: true`), and a stray row must never convince this
  // action the table is ready — `update_scene` would then target a record that
  // does not exist. `where.recordId` resolves to the row id (SDK 0.44.2).
  const existing = await ctx.tools.query('campaigns', {
    where: { recordId: DEFAULT_CAMPAIGN_ID },
    limit: 1,
  })
  if (!existing.success) {
    return { success: false, code: 'seed_failed', error: existing.error }
  }
  if (existing.data.records.length > 0) {
    return { success: true, data: { campaignId: DEFAULT_CAMPAIGN_ID, created: false } }
  }

  // All eight columns, not just the required `title`: the row is the seed, not
  // whatever the schema's defaults happen to be.
  const created = await ctx.tools.create(
    'campaigns',
    { ...DEFAULT_CAMPAIGN_SEED },
    DEFAULT_CAMPAIGN_ID,
  )
  if (!created.success) {
    return { success: false, code: 'seed_failed', error: created.error }
  }
  return { success: true, data: { campaignId: DEFAULT_CAMPAIGN_ID, created: true } }
}

function invalidParams(error: z.ZodError) {
  return {
    success: false as const,
    code: 'invalid_params',
    error: 'Invalid parameters',
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String),
      message: issue.message,
      code: issue.code,
    })),
  }
}

function writeFailed(stage: string, error: string, applied: string[]) {
  return {
    success: false as const,
    code: 'write_failed',
    error,
    details: { stage, applied },
  }
}

/**
 * The `combat` summary line for `character_hp` (`P5.10`).
 *
 * Reports the **applied** change, not the requested one: a heal at full HP is
 * "unchanged", because that is what the table saw happen. The before/after pair
 * carries the clamp, and the reason is the GM's narration when it supplied one.
 */
function hpSummary(
  name: string,
  change: { before: number; after: number; maxHp: number; applied: number; reason?: string },
): string {
  const { before, after, maxHp, applied, reason } = change
  const state = `(${before}/${maxHp} to ${after}/${maxHp})`
  const line =
    applied < 0
      ? `${name} takes ${-applied} damage ${state}`
      : applied > 0
        ? `${name} heals ${applied} ${state}`
        : `${name} HP unchanged ${state}`
  return reason === undefined ? line : `${line} — ${reason}`
}

/**
 * The `gm_event` summary line for `update_scene` (`P5.10`): where the table
 * moved to, or — when it only shifted atmosphere/threat — the first column that
 * changed, so the row is never a bare "scene updated".
 */
function sceneSummary(
  patch: Partial<Record<SceneColumn, string | number>>,
  applied: SceneColumn[],
): string {
  const location = patch.locationName
  if (typeof location === 'string' && location.trim() !== '') {
    return `The scene shifts to ${location}`
  }
  const column = applied[0]
  return `The scene shifts: ${column} is now ${String(patch[column])}`
}

/**
 * Writes the one `roll-logs` row a GM mutation is evidence of (ADR 0009,
 * `P5.10`): the mutation already happened by the time this runs, so a failed log
 * write never turns the result into a failure — it reports `logged: false` with
 * the write that landed and the log error.
 *
 * `campaignId` is required by the schema, `userId` is userBound and `rolledAt` is
 * the `summary` timestampTrigger's, so the action passes neither: it must not
 * claim who caused the row or when.
 */
async function logGmEvidence(
  tools: ActionContext<Env>['tools'],
  row: {
    campaignId: string
    characterName: string
    entryType: 'combat' | 'gm_event'
    summary: string
  },
  applied: string,
): Promise<GmMutationLogReport> {
  const created = await tools.create('roll-logs', { ...row, outcome: 'info' })
  if (created.success) return { logged: true }
  return { logged: false, details: { applied: [applied], logError: created.error } }
}

/**
 * The AI GM's privileged write path — HP, loot and scene only (ADR 0008).
 *
 * Authorization is the **app owner credential** (ADR 0017), stated once here
 * because `ctx.tools` runs with per-record RBAC **off**: `ctx.userId` must equal
 * `ctx.env.OWNER_USER_ID`. Anything else is `not_gm`, refused before params are
 * parsed and before any read or write — table membership is deliberately *not*
 * enough, because a player owns a character and must not be able to rewrite
 * their own HP (ADR 0020).
 *
 * The owner acts for the table, so it needs no character row of its own: the only
 * target rule is that the character must be in `DEFAULT_CAMPAIGN_ID`, keeping
 * one table's GM from reaching another's rows. Members cannot write `characters`
 * or `inventory` directly (ADR 0015), so this is the only cross-character write
 * path.
 *
 * Ordered best-effort, not atomic: with no transactions, each kind performs one
 * mutation and, after it succeeds, one `roll-logs` evidence row (`P5.10`,
 * ADR 0009). A failed mutation returns `details.stage` with `applied` empty
 * (`applied` is part of the wire shape so a future multi-write mutation does not
 * have to change it); a failed **evidence** write returns the successful
 * mutation, because it already happened, with `logged: false`.
 */
export async function applyGmMutation(
  ctx: ActionContext<Env>,
): Promise<ActionResult<GmMutationData>> {
  if (ctx.userId !== ctx.env.OWNER_USER_ID) {
    return {
      success: false,
      code: 'not_gm',
      error: 'Only the app owner credential may run GM mutations',
    }
  }

  const parsed = applyGmMutationParamsSchema.safeParse(ctx.params)
  if (!parsed.success) return invalidParams(parsed.error)
  const { mutation } = parsed.data
  const { tools } = ctx

  // The scene is one record on its own row: no target character to check.
  if (mutation.kind === 'update_scene') {
    const patch: Partial<Record<SceneColumn, string | number>> = {}
    const applied: SceneColumn[] = []
    for (const column of SCENE_COLUMNS) {
      const value = mutation.scene[column]
      if (value === undefined) continue
      patch[column] = value
      applied.push(column)
    }
    // Nothing whitelisted arrived (only stripped keys): no empty write, and
    // nothing to log — an evidence row for a no-op would be a false claim.
    if (applied.length === 0) {
      return {
        success: true,
        data: { kind: 'update_scene', scene: { applied }, logged: false, details: { applied: [] } },
      }
    }

    const updated = await tools.update('campaigns', DEFAULT_CAMPAIGN_ID, patch)
    if (!updated.success) {
      return writeFailed('update_scene', updated.error, [])
    }
    // The scene has no character of its own: the row is the GM's own event.
    const log = await logGmEvidence(
      tools,
      {
        campaignId: DEFAULT_CAMPAIGN_ID,
        characterName: 'Game Master',
        entryType: 'gm_event',
        summary: sceneSummary(patch, applied),
      },
      `campaigns:${DEFAULT_CAMPAIGN_ID}`,
    )
    return { success: true, data: { kind: 'update_scene', scene: { applied }, ...log } }
  }

  // Both remaining kinds target a character. It must be in the one campaign
  // this app serves, so a mutation cannot reach another table's rows.
  const target = await tools.get<CharacterTarget>('characters', mutation.characterId)
  if (!target.success) {
    return { success: false, code: 'character_not_found', error: target.error }
  }
  if (target.data.record.data.campaignId !== DEFAULT_CAMPAIGN_ID) {
    return {
      success: false,
      code: 'character_not_found',
      error: `Character ${JSON.stringify(mutation.characterId)} is not in campaign ${JSON.stringify(DEFAULT_CAMPAIGN_ID)}`,
    }
  }

  if (mutation.kind === 'character_hp') {
    const { hp: before, maxHp, name, campaignId } = target.data.record.data
    const after = Math.min(maxHp, Math.max(0, before + mutation.delta))
    // `characters.userId` is userBound + immutable: never part of an update.
    const updated = await tools.update('characters', mutation.characterId, { hp: after })
    if (!updated.success) {
      return writeFailed('character_hp', updated.error, [])
    }
    const log = await logGmEvidence(
      tools,
      {
        campaignId,
        characterName: name,
        entryType: 'combat',
        summary: hpSummary(name, {
          before,
          after,
          maxHp,
          applied: after - before,
          reason: mutation.reason,
        }),
      },
      `characters:${mutation.characterId}`,
    )
    return {
      success: true,
      data: {
        kind: 'character_hp',
        characterId: mutation.characterId,
        hp: { before, after, maxHp, appliedDelta: after - before },
        ...log,
      },
    }
  }

  const { item } = mutation
  // `campaignId` is forced, never read from params: the item belongs to this
  // campaign, not to whatever the caller typed.
  const quantity = item.quantity ?? 1
  const loot: Record<string, unknown> = {
    characterId: mutation.characterId,
    // The GM writes for the table; the row belongs to the player whose
    // character received it, so `inventory` ownership follows the target
    // character's owner, not the caller (ADR 0015).
    userId: target.data.record.data.userId,
    campaignId: DEFAULT_CAMPAIGN_ID,
    itemName: item.itemName,
    quantity,
  }
  if (item.category !== undefined) loot.category = item.category
  if (item.description !== undefined) loot.description = item.description

  const created = await tools.create('inventory', loot)
  if (!created.success) {
    return writeFailed('grant_loot', created.error, [])
  }
  // The evidence row follows the item, so the feed names the same character
  // the item went to.
  const log = await logGmEvidence(
    tools,
    {
      campaignId: DEFAULT_CAMPAIGN_ID,
      characterName: target.data.record.data.name,
      entryType: 'gm_event',
      summary: `${target.data.record.data.name} receives ${item.itemName} x${quantity}`,
    },
    `inventory:${created.data.recordId}`,
  )
  return {
    success: true,
    data: {
      kind: 'grant_loot',
      characterId: mutation.characterId,
      item: { recordId: created.data.recordId, itemName: item.itemName, quantity },
      ...log,
    },
  }
}

const forgeCharacterParamsSchema = z.object({
  name: z.string().trim().min(1).max(40),
  archetype: z.enum(['Vanguard', 'Shadowblade', 'Arcanist', 'Marksman']),
})

export interface ForgeCharacterData {
  characterId: string
  name: string
  archetype: string
  itemsMissing: string[]
}

/**
 * Creates the caller's character from a preset (ADR 0015).
 *
 * The browser sends only `{ name, archetype }`: the server reads the preset, so
 * `hp` (always `maxHp` on creation), `ac` and the ability scores cannot be
 * supplied by the client. Then it writes the preset's two starter items, each
 * stamped with the owner's `userId`.
 *
 * No transactions: if an item write fails the character still exists and the
 * failed item names are reported in `itemsMissing` instead of rolling back.
 */
export async function forgeCharacter(
  ctx: ActionContext<Env>,
): Promise<ActionResult<ForgeCharacterData>> {
  const parsed = forgeCharacterParamsSchema.safeParse(ctx.params)
  if (!parsed.success) return invalidParams(parsed.error)

  const { tools, userId } = ctx
  const existing = await tools.query<MembershipRow>('characters', {
    where: { userId, campaignId: DEFAULT_CAMPAIGN_ID },
    limit: 1,
  })
  if (!existing.success) {
    // Fail closed: being unable to prove there is no character is not permission.
    return writeFailed('membership', existing.error, [])
  }
  if (existing.data.records.length > 0) {
    return {
      success: false,
      code: 'already_forged',
      error: `Caller already has a character in campaign ${JSON.stringify(DEFAULT_CAMPAIGN_ID)} (one character per player)`,
    }
  }

  const preset = ARCHETYPE_PRESETS[parsed.data.archetype]
  const created = await tools.create('characters', {
    userId,
    campaignId: DEFAULT_CAMPAIGN_ID,
    name: parsed.data.name,
    archetype: parsed.data.archetype,
    hp: preset.maxHp,
    maxHp: preset.maxHp,
    ac: calculateArmorClass(preset.scores.dex, preset.armorBonus),
    ...preset.scores,
  })
  if (!created.success) {
    return writeFailed('create_character', created.error, [])
  }

  const characterId = created.data.recordId
  const itemsMissing: string[] = []
  for (const item of preset.starterItems) {
    const row = await tools.create('inventory', {
      userId,
      characterId,
      campaignId: DEFAULT_CAMPAIGN_ID,
      itemName: item.itemName,
      category: item.category,
      description: item.description,
      quantity: item.quantity,
    })
    if (!row.success) itemsMissing.push(item.itemName)
  }

  return {
    success: true,
    data: {
      characterId,
      name: parsed.data.name,
      archetype: parsed.data.archetype,
      itemsMissing,
    },
  }
}

const useItemParamsSchema = z.object({ itemId: z.string().min(1) })

/** The `inventory` columns `useItem` reads before writing. */
interface InventoryTarget {
  [key: string]: unknown
  userId: string
  characterId: string
  campaignId: string
  itemName: string
  category: string
  quantity: number
}

export interface UseItemData {
  itemId: string
  itemName: string
  heal: { requested: number; applied: number; hp: number; maxHp: number }
  /** `null` when the last one was used and the row was removed. */
  quantity: number | null
}

/**
 * Spends one charge of a consumable on the caller's own character (ADR 0015,
 * ADR 0016).
 *
 * The heal comes from `CONSUMABLE_EFFECTS`, keyed by item name — never from
 * `params` — and is clamped to `maxHp`. At full HP the action refuses without
 * writing, so a charge is never wasted. Unknown consumables are `no_effect`
 * rather than a silent no-op.
 *
 * Ordered: the character's `hp` lands first, then the inventory decrement (or
 * removal). With no transactions, a failure on the second write reports the
 * first as `details.applied`.
 */
export async function useItem(ctx: ActionContext<Env>): Promise<ActionResult<UseItemData>> {
  const parsed = useItemParamsSchema.safeParse(ctx.params)
  if (!parsed.success) return invalidParams(parsed.error)

  const { tools, userId } = ctx
  const { itemId } = parsed.data
  const found = await tools.get<InventoryTarget>('inventory', itemId)
  if (!found.success) {
    return { success: false, code: 'item_not_found', error: found.error }
  }
  const item = found.data.record.data
  if (item.campaignId !== DEFAULT_CAMPAIGN_ID) {
    return {
      success: false,
      code: 'item_not_found',
      error: `Item ${JSON.stringify(itemId)} is not in campaign ${JSON.stringify(DEFAULT_CAMPAIGN_ID)}`,
    }
  }
  if (item.userId !== userId) {
    return {
      success: false,
      code: 'not_owner',
      error: `Item ${JSON.stringify(itemId)} does not belong to the caller`,
    }
  }
  if (item.category !== 'consumable') {
    return {
      success: false,
      code: 'not_usable',
      error: `Only consumables can be used; ${JSON.stringify(item.category)} items are not usable`,
    }
  }
  const effect = CONSUMABLE_EFFECTS[item.itemName]
  if (!effect) {
    return {
      success: false,
      code: 'no_effect',
      error: `No server-side effect is registered for ${JSON.stringify(item.itemName)}`,
    }
  }

  // The character carries the stat block; the item only points at it.
  const target = await tools.get<CharacterTarget>('characters', item.characterId)
  if (!target.success) {
    return { success: false, code: 'character_not_found', error: target.error }
  }
  const character = target.data.record.data
  if (character.campaignId !== DEFAULT_CAMPAIGN_ID) {
    return {
      success: false,
      code: 'character_not_found',
      error: `Character ${JSON.stringify(item.characterId)} is not in campaign ${JSON.stringify(DEFAULT_CAMPAIGN_ID)}`,
    }
  }
  if (character.userId !== userId) {
    return {
      success: false,
      code: 'not_owner',
      error: `Character ${JSON.stringify(item.characterId)} does not belong to the caller`,
    }
  }
  if (character.hp >= character.maxHp) {
    return {
      success: false,
      code: 'at_full',
      error: `HP is already at ${character.maxHp}; ${JSON.stringify(item.itemName)} was not used`,
    }
  }

  const { hp: before, maxHp } = character
  const after = Math.min(maxHp, before + effect.heal)
  const updated = await tools.update('characters', item.characterId, { hp: after })
  if (!updated.success) {
    return writeFailed('character_hp', updated.error, [])
  }

  const { quantity } = item
  if (quantity > 1) {
    const spent = await tools.update('inventory', itemId, { quantity: quantity - 1 })
    if (!spent.success) {
      return writeFailed('inventory', spent.error, ['character_hp'])
    }
    return {
      success: true,
      data: {
        itemId,
        itemName: item.itemName,
        heal: { requested: effect.heal, applied: after - before, hp: after, maxHp },
        quantity: quantity - 1,
      },
    }
  }

  const removed = await tools.remove('inventory', itemId)
  if (!removed.success) {
    return writeFailed('inventory', removed.error, ['character_hp'])
  }
  return {
    success: true,
    data: {
      itemId,
      itemName: item.itemName,
      heal: { requested: effect.heal, applied: after - before, hp: after, maxHp },
      quantity: null,
    },
  }
}

const rollSkillCheckParamsSchema = z.object({
  characterId: z.string().min(1),
  statName: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
})

/** Bytes drawn per attempt. 64 accepted-or-not bytes make an all-rejected
 *  buffer a 2^-256 event, so `ROLL_DRAW_ATTEMPTS` is a loop guard, not a
 *  probability question. */
const ROLL_DRAW_BYTES = 64
const ROLL_DRAW_ATTEMPTS = 3

export interface RollSkillCheckData {
  rawRoll: number
  modifier: number
  total: number
  targetDc: number
  outcome: RollOutcome
  rollLogId: string
}

/**
 * The only roll authority (ADR 0005, `P4.4`, `P4.6`).
 *
 * The caller sends `{ characterId, statName }` and nothing else — no `rawRoll`,
 * no `total`, no `campaignId` — so a browser cannot invent a result or aim a
 * roll at another table. The campaign comes from the character row, the DC from
 * that campaign's `activeThreatDc`, the modifier from the character's score,
 * and the d20 from `crypto.getRandomValues` through the pure
 * `rollD20FromBytes`. Classification is `src/lib/d20.ts`'s `classifyRoll`, the
 * same function the GM tools use.
 *
 * Durable before ephemeral: the `roll-logs` row is written first, and only a
 * successful write is returned, so the row is evidence rather than a claim.
 * **If the client's presence broadcast fails after this write succeeds, the
 * feed shows the roll and peers miss the banner. That is accepted, and it must
 * never trigger a retry — a retry would roll twice** (`P4.6`).
 *
 * Gates run in a fixed order before anything is rolled: `character_not_found`,
 * then `not_owner` (RBAC is off inside actions, so ownership is this file's
 * job), then `campaign_not_found`. A campaign row whose `activeThreatDc` is not
 * a number is a failed action, never a DC of 0 — a roll against 0 would always
 * succeed and log as if it had meant something.
 */
export async function rollSkillCheck(
  ctx: ActionContext<Env>,
): Promise<ActionResult<RollSkillCheckData>> {
  const parsed = rollSkillCheckParamsSchema.safeParse(ctx.params)
  if (!parsed.success) return invalidParams(parsed.error)

  const { tools, userId } = ctx
  const { characterId, statName } = parsed.data
  const target = await tools.get<RollTarget>('characters', characterId)
  if (!target.success) {
    return { success: false, code: 'character_not_found', error: target.error }
  }
  const character = target.data.record.data
  if (character.userId !== userId) {
    return {
      success: false,
      code: 'not_owner',
      error: `Character ${JSON.stringify(characterId)} does not belong to the caller`,
    }
  }
  // Same guard as every other character action: a row from another campaign is
  // not a target here. Without it the DC below would be read from the default
  // campaign while the log row named the character's own — one roll, two tables.
  if (character.campaignId !== DEFAULT_CAMPAIGN_ID) {
    return {
      success: false,
      code: 'character_not_found',
      error: `Character ${JSON.stringify(characterId)} is not in campaign ${JSON.stringify(DEFAULT_CAMPAIGN_ID)}`,
    }
  }

  // The DC is the table's, read by the one campaign id every write path uses
  // (`forgeCharacter`) — never a value the caller supplied, and never a default
  // that would make the roll a no-op. The row's `campaignId` still comes from
  // the character (guarded equal above), so the log names where the roll happened.
  const campaign = await tools.get<RollCampaignTarget>('campaigns', DEFAULT_CAMPAIGN_ID)
  if (!campaign.success) {
    return { success: false, code: 'campaign_not_found', error: campaign.error }
  }
  const targetDc = campaign.data.record.data.activeThreatDc
  if (typeof targetDc !== 'number' || !Number.isFinite(targetDc)) {
    return {
      success: false,
      code: 'campaign_not_found',
      error: `Campaign ${JSON.stringify(DEFAULT_CAMPAIGN_ID)} has no numeric activeThreatDc`,
    }
  }

  let rawRoll: number | null = null
  for (let attempt = 0; attempt < ROLL_DRAW_ATTEMPTS && rawRoll === null; attempt += 1) {
    try {
      rawRoll = rollD20FromBytes(crypto.getRandomValues(new Uint8Array(ROLL_DRAW_BYTES)))
    } catch {
      // Every byte was rejected: draw again rather than bias the roll.
    }
  }
  // Unreachable with real entropy (see ROLL_DRAW_BYTES); reported rather than
  // thrown, so the route answers with an action result instead of a 500.
  if (rawRoll === null) {
    return {
      success: false,
      code: 'roll_failed',
      error: `No accepted d20 byte in ${ROLL_DRAW_ATTEMPTS} draws of ${ROLL_DRAW_BYTES} bytes`,
    }
  }

  const modifier = getModifier(character[statName])
  const total = rawRoll + modifier
  const outcome = classifyRoll(rawRoll, total, targetDc)
  const summary = `${statName.toUpperCase()} check: d20(${rawRoll}) ${formatModifier(modifier)} = ${total} vs DC ${targetDc} — ${outcome.replace('_', ' ')}`

  // The ten columns the action owns. `userId` is userBound and `rolledAt` is the
  // timestampTrigger's, so passing either would be a lie about who rolled and when.
  const created = await tools.create('roll-logs', {
    campaignId: character.campaignId,
    characterName: character.name,
    entryType: 'roll',
    statName,
    rawRoll,
    modifier,
    total,
    targetDc,
    outcome,
    summary,
  })
  if (!created.success) return writeFailed('roll_log', created.error, [])

  return {
    success: true,
    data: { rawRoll, modifier, total, targetDc, outcome, rollLogId: created.data.recordId },
  }
}

const deleteCharacterParamsSchema = z.object({ characterId: z.string().min(1) })

/** `deleteWhere`'s page size for the inventory drain (SDK default 100, max 500). */
const INVENTORY_DRAIN_PAGE = 100

/**
 * Defensive cap on drain pages: 50 pages × 100 rows is far past any pack this
 * build can produce, but it means a broken `deleted` count cannot spin the
 * action forever. Hitting it is reported as a failure rather than ignored: the
 * character is still there, so the caller can retry.
 */
const INVENTORY_DRAIN_MAX_PAGES = 50

export interface DeleteCharacterData {
  characterId: string
  deletedItems: number
}

/**
 * Deletes the caller's own character — the reset path behind "Delete <name>" in
 * settings (ADR 0018), so a player can re-forge another archetype.
 *
 * Owner-only: `characters.userId` must be the caller and the row must be in
 * `DEFAULT_CAMPAIGN_ID`; both checks run before any write. Items are drained
 * **first**, paged, so a failure leaves a reachable character with an empty pack
 * instead of orphan `inventory` rows nothing can see or delete.
 *
 * No transactions: an inventory failure returns `write_failed` with stage
 * `inventory` and the character untouched; a failure removing the row returns
 * stage `character` with `applied: ['inventory']`, because the kit is already
 * gone by then.
 */
export async function deleteCharacter(
  ctx: ActionContext<Env>,
): Promise<ActionResult<DeleteCharacterData>> {
  const parsed = deleteCharacterParamsSchema.safeParse(ctx.params)
  if (!parsed.success) return invalidParams(parsed.error)

  const { tools, userId } = ctx
  const { characterId } = parsed.data
  const target = await tools.get<CharacterTarget>('characters', characterId)
  if (!target.success) {
    return { success: false, code: 'character_not_found', error: target.error }
  }
  const character = target.data.record.data
  if (character.campaignId !== DEFAULT_CAMPAIGN_ID) {
    return {
      success: false,
      code: 'character_not_found',
      error: `Character ${JSON.stringify(characterId)} is not in campaign ${JSON.stringify(DEFAULT_CAMPAIGN_ID)}`,
    }
  }
  if (character.userId !== userId) {
    return {
      success: false,
      code: 'not_owner',
      error: `Character ${JSON.stringify(characterId)} does not belong to the caller`,
    }
  }

  // Items first: repeat the same bounded page until one comes back short.
  let deletedItems = 0
  for (let page = 1; ; page += 1) {
    if (page > INVENTORY_DRAIN_MAX_PAGES) {
      return writeFailed(
        'inventory',
        `Inventory drain stopped after ${INVENTORY_DRAIN_MAX_PAGES} pages (${deletedItems} rows deleted); ${JSON.stringify(characterId)} was left in place`,
        [],
      )
    }
    const drained = await tools.deleteWhere(
      'inventory',
      { characterId },
      INVENTORY_DRAIN_PAGE,
    )
    if (!drained.success) return writeFailed('inventory', drained.error, [])
    deletedItems += drained.data.deleted
    if (drained.data.deleted < INVENTORY_DRAIN_PAGE) break
  }

  const removed = await tools.remove('characters', characterId)
  if (!removed.success) return writeFailed('character', removed.error, ['inventory'])

  return { success: true, data: { characterId, deletedItems } }
}

export const actions: Record<string, ActionHandler<Env>> = {
  ensureDefaultCampaign,
  applyGmMutation,
  forgeCharacter,
  useItem,
  rollSkillCheck,
  deleteCharacter,
}
