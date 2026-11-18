import { z } from 'zod/v4'
import type { ActionContext, ActionHandler, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { DEFAULT_CAMPAIGN_ID } from '../constants'
import { DEFAULT_CAMPAIGN_SEED, isAtmosphereTag } from '../lib/campaign-seed'

/**
 * App server actions. Reached only over `POST /api/actions/:name`, which
 * requires a bearer token and hands each handler `tools` running with
 * per-record RBAC off (`src/server/action-routes.ts` states the trust model):
 * identity is established by the route, but **ownership is this file's job**.
 *
 * There are no transactions across `tools.*` calls. Each action below writes in
 * a fixed order, stops at the first failure, and reports what already landed
 * instead of implying the change was atomic.
 */

/** The `characters` columns `applyGmMutation` reads before writing. */
interface CharacterTarget {
  [key: string]: unknown
  campaignId: string
  hp: number
  maxHp: number
}

/** The `characters` columns the membership check needs. */
interface MembershipRow {
  [key: string]: unknown
  userId: string
  campaignId: string
}

/** `inventory.category`'s select options, in schema order. */
const ITEM_CATEGORIES = ['weapon', 'armor', 'consumable', 'relic', 'quest'] as const

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

export type GmMutationData =
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

function writeFailed(stage: string, error: string, applied: string[]) {
  return {
    success: false as const,
    code: 'write_failed',
    error,
    details: { stage, applied },
  }
}

/**
 * The AI GM's privileged write path — HP, loot and scene only (ADR 0008).
 *
 * Authorization is table membership, stated once here because `ctx.tools` runs
 * with per-record RBAC **off**: the caller must already own a character in
 * `DEFAULT_CAMPAIGN_ID`. That is checked before any target is read. The target
 * may then be any character in the same campaign, because ADR 0012 has no GM
 * seat and the AI GM acts for the table; client-side RBAC still restricts
 * direct `characters` writes to `'own'`, so this is the only cross-character
 * write path.
 *
 * Ordered best-effort, not atomic: with no transactions, each kind performs at
 * most one write and stops on failure, returning `details.stage` and
 * `details.applied` (the writes that already landed). Today every kind writes
 * one record, so `applied` is empty on failure; the field is part of the wire
 * shape so a future multi-write mutation does not have to change it.
 */
export async function applyGmMutation(
  ctx: ActionContext<Env>,
): Promise<ActionResult<GmMutationData>> {
  const parsed = applyGmMutationParamsSchema.safeParse(ctx.params)
  if (!parsed.success) {
    return {
      success: false,
      code: 'invalid_params',
      error: 'Invalid mutation parameters',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String),
        message: issue.message,
        code: issue.code,
      })),
    }
  }
  const { mutation } = parsed.data
  const { tools, userId } = ctx

  const membership = await tools.query<MembershipRow>('characters', {
    where: { userId, campaignId: DEFAULT_CAMPAIGN_ID },
    limit: 1,
  })
  if (!membership.success) {
    // Fail closed: being unable to prove membership is not permission.
    return {
      success: false,
      code: 'no_character',
      error: membership.error,
      details: { stage: 'membership' },
    }
  }
  if (membership.data.records.length === 0) {
    return {
      success: false,
      code: 'no_character',
      error: `Caller has no character in campaign ${JSON.stringify(DEFAULT_CAMPAIGN_ID)}`,
    }
  }

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
    // Nothing whitelisted arrived (only stripped keys): no empty write.
    if (applied.length === 0) {
      return { success: true, data: { kind: 'update_scene', scene: { applied } } }
    }

    const updated = await tools.update('campaigns', DEFAULT_CAMPAIGN_ID, patch)
    if (!updated.success) {
      return writeFailed('update_scene', updated.error, [])
    }
    return { success: true, data: { kind: 'update_scene', scene: { applied } } }
  }

  // Both remaining kinds target a character. It must share the campaign this
  // caller is seated at, so a member of one table cannot reach another's rows.
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
    const { hp: before, maxHp } = target.data.record.data
    const after = Math.min(maxHp, Math.max(0, before + mutation.delta))
    // `characters.userId` is userBound + immutable: never part of an update.
    const updated = await tools.update('characters', mutation.characterId, { hp: after })
    if (!updated.success) {
      return writeFailed('character_hp', updated.error, [])
    }
    return {
      success: true,
      data: {
        kind: 'character_hp',
        characterId: mutation.characterId,
        hp: { before, after, maxHp, appliedDelta: after - before },
      },
    }
  }

  const { item } = mutation
  // `campaignId` is forced, never read from params: the item belongs to the
  // campaign membership proved, not to whatever the caller typed.
  const quantity = item.quantity ?? 1
  const loot: Record<string, unknown> = {
    characterId: mutation.characterId,
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
  return {
    success: true,
    data: {
      kind: 'grant_loot',
      characterId: mutation.characterId,
      item: { recordId: created.data.recordId, itemName: item.itemName, quantity },
    },
  }
}

export const actions: Record<string, ActionHandler<Env>> = {
  ensureDefaultCampaign,
  applyGmMutation,
}
