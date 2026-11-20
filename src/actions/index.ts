import { z } from 'zod/v4'
import type { ActionContext, ActionHandler, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { DEFAULT_CAMPAIGN_ID } from '../constants'
import { DEFAULT_CAMPAIGN_SEED, isAtmosphereTag } from '../lib/campaign-seed'
import { progressLabel, sceneAt, sceneColumns } from '../lib/campaign-arc'
import type { CampaignScene } from '../lib/campaign-arc'
import { ARCHETYPE_PRESETS, CONSUMABLE_EFFECTS, calculateArmorClass, classifyRoll, formatModifier, getModifier } from '../lib/d20'
import type { ArchetypePreset, RollOutcome } from '../lib/d20'
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
 * the six ability scores the modifier comes from, and the check the row itself
 * owes (`P5.31`, ADR 0030 — the gate travels with the sheet).
 */
interface RollTarget extends CharacterTarget {
  name: string
  str: number
  dex: number
  con: number
  int: number
  wis: number
  cha: number
  // `pendingStat: ''` / `pendingDc: 0` is "nothing pending", so an older or
  // hand-seeded row reads as no request at all.
  pendingStat?: string
  pendingDc?: number
}

/** The one `campaigns` row a roll reads: the scene's baseline DC. */
interface RollCampaignTarget {
  [key: string]: unknown
  activeThreatDc: number
}

/**
 * The `campaigns` columns a GM mutation reads: where the table is in the arc
 * (`sceneIndex`), and the scene enemy's name and HP. Absent fields are treated
 * as "scene 0 / no enemy" rather than trusted blindly.
 */
interface CampaignStateTarget {
  [key: string]: unknown
  sceneIndex: number
  enemyName: string
  enemyHp: number
  enemyMaxHp: number
}

/** The `characters` columns a reset reads: whose row it is and what it forges. */
interface ResetCharacterRow {
  [key: string]: unknown
  userId: string
  campaignId: string
  name: string
  archetype: string
  hp: number
  maxHp: number
}

/** `inventory.category`'s select options, in schema order (ADR 0016: no `relic`). */
const ITEM_CATEGORIES = ['weapon', 'armor', 'consumable', 'quest'] as const

/**
 * The six ability keys, in schema order — the same list `rollSkillCheck`'s own
 * params schema accepts and `characters.pendingStat` selects over.
 */
const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const

type AbilityKey = (typeof ABILITY_KEYS)[number]

/**
 * The two `characters` columns a pending check occupies, in the "nothing
 * pending" state (ADR 0030). One constant so a roll, an accepted scene advance
 * and a reset clear the same sheet the same way.
 */
const NO_PENDING_CHECK = { pendingStat: '', pendingDc: 0 } as const

/** Whether a `characters.pendingStat` value names one of the six abilities. */
function isAbilityKey(value: unknown): value is AbilityKey {
  return typeof value === 'string' && (ABILITY_KEYS as readonly string[]).includes(value)
}

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
// all — `update_scene` can never rename the campaign. `sceneIndex` is not a
// scene column either: it is the arc position, and `applyGmMutation` gates it
// as an advance rather than a free write (ADR 0023).
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
  // The only legal value is "current + 1" with the current scene's exit met;
  // the bound keeps an out-of-arc index from reaching `sceneColumns`.
  sceneIndex: z.number().int().min(0).max(4).optional(),
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
  // ADR 0024: the GM's hit. It moves the scene enemy's HP only, and the engine
  // clamps it — there is no absolute "enemyHp" field to pass.
  z.object({
    kind: z.literal('enemy_damage'),
    amount: z.number().int().min(1).max(50),
    reason: z.string().trim().max(200).optional(),
  }),
  // `P5.19`: the GM asks for one named check at its own DC, so the sheet can
  // light up the stat, the panel can pulse the DC, and `rollSkillCheck` can
  // refuse every other stat. A request is not an outcome: no `roll-logs` row.
  z.object({
    kind: z.literal('request_check'),
    characterId: z.string().min(1),
    stat: z.enum(ABILITY_KEYS),
    dc: z.number().int().min(5).max(30),
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
 *
 * `request_check` is the one kind that reports `logged: false` **by design**: a
 * request for a roll is not an outcome, so it writes no evidence row and the
 * table learns of it from the live character row.
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
    | { kind: 'update_scene'; scene: { applied: SceneColumn[]; sceneIndex?: number } }
    | {
        kind: 'enemy_damage'
        enemy: { name: string; before: number; after: number; maxHp: number; applied: number }
      }
    | {
        kind: 'request_check'
        pending: { characterId: string; characterName: string; stat: AbilityKey; dc: number }
      }
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
 * The `combat` summary line for `enemy_damage` (ADR 0024): the enemy, the damage
 * the engine actually applied, the HP it now sits at, and the GM's reason when
 * it gave one. `applied` is the clamped number, never the requested one.
 */
function enemyDamageSummary(
  name: string,
  change: { after: number; maxHp: number; applied: number; reason?: string },
): string {
  const line = `${name} takes ${change.applied} damage (${change.after}/${change.maxHp})`
  return change.reason === undefined ? line : `${line} — ${change.reason}`
}

function invalidScene(error: string) {
  return { success: false as const, code: 'invalid_scene', error }
}

/** One page of roll history the scene's exit check reads. */
const SCENE_EXIT_ROLL_SCAN = 500

type SceneExitResult =
  | { ok: true }
  | { ok: false; code: 'scene_not_complete' | 'write_failed'; error: string }

/**
 * Whether the current scene's `exit` is satisfied by **records** (ADR 0023):
 * `defeat` reads the campaign row's `enemyHp`, `check` reads one successful
 * `roll-logs` row at this scene's DC. The model never gets to say a scene is
 * over — ADR 0009's rule, applied to the story's own unit.
 */
async function sceneExitMet(
  tools: ActionContext<Env>['tools'],
  campaign: CampaignStateTarget,
  scene: CampaignScene,
): Promise<SceneExitResult> {
  if (scene.exit === 'defeat') {
    const enemyHp = typeof campaign.enemyHp === 'number' ? campaign.enemyHp : 0
    if (enemyHp <= 0) return { ok: true }
    return {
      ok: false,
      code: 'scene_not_complete',
      error: `${scene.title} ends when the enemy is at 0 HP; enemyHp is ${enemyHp}`,
    }
  }

  // Bounded on purpose: a scene that has not been closed cannot have hundreds of
  // rolls at its own DC in this build, and hitting the cap fails closed (the
  // advance is refused, never guessed).
  const rolls = await tools.query<{ outcome: string }>('roll-logs', {
    where: {
      campaignId: DEFAULT_CAMPAIGN_ID,
      entryType: 'roll',
      targetDc: scene.activeThreatDc,
    },
    limit: SCENE_EXIT_ROLL_SCAN,
  })
  if (!rolls.success) return { ok: false, code: 'write_failed', error: rolls.error }
  const met = rolls.data.records.some(
    (record) =>
      record.data.outcome === 'success' || record.data.outcome === 'critical_success',
  )
  if (met) return { ok: true }
  return {
    ok: false,
    code: 'scene_not_complete',
    error: `${scene.title} ends on one successful roll at DC ${scene.activeThreatDc}; none is recorded`,
  }
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
 * The AI GM's privileged write path — character HP, loot, the scene, and the
 * scene enemy's HP (ADR 0008, ADR 0023, ADR 0024).
 *
 * Authorization is the **app owner credential** (ADR 0017), stated once here
 * because `ctx.tools` runs with per-record RBAC **off**: `ctx.userId` must equal
 * `ctx.env.OWNER_USER_ID`. Anything else is `not_gm`, refused before params are
 * parsed and before any read or write — table membership is deliberately *not*
 * enough, because a player owns a character and must not be able to rewrite
 * their own HP (ADR 0020).
 *
 * The owner acts for the table, so it needs no character row of its own: the only
 * target rule is that a character must be in `DEFAULT_CAMPAIGN_ID`, keeping one
 * table's GM from reaching another's rows. Members cannot write `characters` or
 * `inventory` directly (ADR 0015), so this is the only cross-character write
 * path.
 *
 * Two kinds move the campaign row rather than a character: `update_scene` (and,
 * with `sceneIndex`, an engine-gated advance that only moves the table when the
 * current scene's exit is recorded) and `enemy_damage` (clamped to
 * `0..enemyMaxHp`, so a fight's every number is the engine's). A third,
 * `request_check` (`P5.19`, ADR 0030), writes the check one character owes — its
 * ability and its own DC — onto that character's row, so a roll can be gated per
 * sheet and the panel can show the number that sheet is rolling against.
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

    // Scene advance (ADR 0023): `sceneIndex` moves the table, so the engine
    // decides whether the current scene is over. Without it this is the same
    // in-scene write it has always been, and nothing below runs.
    if (mutation.scene.sceneIndex !== undefined) {
      const next = mutation.scene.sceneIndex
      const campaign = await tools.get<CampaignStateTarget>('campaigns', DEFAULT_CAMPAIGN_ID)
      if (!campaign.success) {
        return { success: false, code: 'campaign_not_found', error: campaign.error }
      }
      const state = campaign.data.record.data
      const current = typeof state.sceneIndex === 'number' ? state.sceneIndex : 0
      const currentScene = sceneAt(current)
      if (!currentScene) {
        return invalidScene(`The campaign's sceneIndex ${current} is not in the arc`)
      }
      // One step at a time: no skipping and no going back, whatever the model
      // asked for.
      if (next !== current + 1) {
        return invalidScene(`sceneIndex may only advance by one from ${current}`)
      }
      const exit = await sceneExitMet(tools, state, currentScene)
      if (!exit.ok) {
        return exit.code === 'write_failed'
          ? writeFailed('scene_exit', exit.error, [])
          : { success: false, code: 'scene_not_complete', error: exit.error }
      }

      // A new scene's own columns, with the model's whitelisted scene fields on
      // top: the GM names the place; the engine names the position and the arc.
      // Every character's pending check belonged to the scene the table just
      // closed, so the party's is cleared first (ADR 0030): a failed clear stops
      // the advance with nothing written, rather than leaving one sheet gated on
      // a scene that is over.
      const cleared = await clearPartyPendingChecks(tools)
      if (!cleared.ok) return writeFailed('pending_clear', cleared.error, [])

      const write: Record<string, string | number> = { ...sceneColumns(next) }
      for (const column of SCENE_COLUMNS) {
        const value = mutation.scene[column]
        if (value !== undefined) write[column] = value
      }
      const advanced = await tools.update('campaigns', DEFAULT_CAMPAIGN_ID, write)
      if (!advanced.success) return writeFailed('update_scene', advanced.error, [])
      const log = await logGmEvidence(
        tools,
        {
          campaignId: DEFAULT_CAMPAIGN_ID,
          characterName: 'Game Master',
          entryType: 'gm_event',
          summary: `The scene advances to ${progressLabel(next)} — ${String(write.locationName)}`,
        },
        `campaigns:${DEFAULT_CAMPAIGN_ID}`,
      )
      return {
        success: true,
        data: {
          kind: 'update_scene',
          scene: { applied: [...SCENE_COLUMNS], sceneIndex: next },
          ...log,
        },
      }
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

  // A hit in narrative combat (ADR 0024): the enemy is a pair of campaign
  // columns, so there is no character target and nothing for the caller to
  // claim — the engine reads HP, clamps it and logs what it actually applied.
  if (mutation.kind === 'enemy_damage') {
    const campaign = await tools.get<CampaignStateTarget>('campaigns', DEFAULT_CAMPAIGN_ID)
    if (!campaign.success) {
      return { success: false, code: 'campaign_not_found', error: campaign.error }
    }
    const state = campaign.data.record.data
    const enemyName = typeof state.enemyName === 'string' ? state.enemyName.trim() : ''
    const enemyMaxHp = typeof state.enemyMaxHp === 'number' ? state.enemyMaxHp : 0
    if (enemyName === '' || enemyMaxHp <= 0) {
      return {
        success: false,
        code: 'enemy_not_found',
        error: 'The current scene has no enemy to damage',
      }
    }
    const before = typeof state.enemyHp === 'number' ? state.enemyHp : 0
    const after = Math.min(enemyMaxHp, Math.max(0, before - mutation.amount))
    const applied = before - after
    const updated = await tools.update('campaigns', DEFAULT_CAMPAIGN_ID, { enemyHp: after })
    if (!updated.success) return writeFailed('enemy_damage', updated.error, [])
    const log = await logGmEvidence(
      tools,
      {
        campaignId: DEFAULT_CAMPAIGN_ID,
        characterName: enemyName,
        entryType: 'combat',
        summary: enemyDamageSummary(enemyName, {
          after,
          maxHp: enemyMaxHp,
          applied,
          reason: mutation.reason,
        }),
      },
      `campaigns:${DEFAULT_CAMPAIGN_ID}`,
    )
    return {
      success: true,
      data: {
        kind: 'enemy_damage',
        enemy: { name: enemyName, before, after, maxHp: enemyMaxHp, applied },
        ...log,
      },
    }
  }

  // The remaining kinds target a character. It must be in the one campaign
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

  // A request for a roll, not a result (`P5.19`, ADR 0030): the character's own
  // row carries the check they owe, so the sheet can light the stat, the panel can
  // pulse the DC and `rollSkillCheck` can refuse every other stat on that sheet —
  // without touching any other player's gate. No evidence row: nothing happened
  // yet, and a row would claim a roll that was not made.
  if (mutation.kind === 'request_check') {
    const { name } = target.data.record.data
    const requested = await tools.update('characters', mutation.characterId, {
      pendingStat: mutation.stat,
      pendingDc: mutation.dc,
    })
    if (!requested.success) {
      return writeFailed('request_check', requested.error, [])
    }
    return {
      success: true,
      data: {
        kind: 'request_check',
        pending: {
          characterId: mutation.characterId,
          characterName: name,
          stat: mutation.stat,
          dc: mutation.dc,
        },
        logged: false,
      },
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

  // Two adventurers with the same name are two sheets the GM cannot tell apart
  // (`P5.15`). `query`'s `where` matches primitives exactly, so the case fold
  // happens here — and the caller's own future row is excluded by `userId`,
  // though the check above already proves they have none.
  const taken = await tools.query<MembershipRow>('characters', {
    where: { campaignId: DEFAULT_CAMPAIGN_ID },
    limit: 200,
  })
  if (!taken.success) {
    // Fail closed: being unable to prove the name is free is not permission.
    return writeFailed('name_check', taken.error, [])
  }
  const wanted = parsed.data.name.toLowerCase()
  const clash = taken.data.records.find((record) => {
    const row = record.data
    if (row.userId === userId) return false
    const name = row.name
    return typeof name === 'string' && name.trim().toLowerCase() === wanted
  })
  if (clash) {
    const clashName = typeof clash.data.name === 'string' ? clash.data.name.trim() : parsed.data.name
    return {
      success: false,
      code: 'name_taken',
      error: `Another adventurer at this table is already called "${clashName}"`,
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
  /**
   * Set when the roll landed but the character's pending check could not be
   * cleared (`P5.19`). The roll is still a success: it is written evidence, and
   * losing it would be worse than a pending check that lingers.
   */
  details?: { pendingClearFailed: string }
}

/** The check one character owes and has not rolled yet (ADR 0030). */
interface PendingCheck {
  stat: AbilityKey
  dc: number
}

/** The `characters` columns the party-wide clear reads (`P5.31`). */
interface PendingRow {
  [key: string]: unknown
  pendingStat?: unknown
  pendingDc?: unknown
}

/**
 * The character row's pending check, or `null` when nothing is pending.
 *
 * A row whose `pendingStat` is not one of the six abilities, or whose
 * `pendingDc` is not a positive number, has no request to honour — a
 * hand-edited or half-written row must not become an unsatisfiable gate, so the
 * scene DC applies exactly as it did before `P5.19`.
 */
function pendingCheckOf(row: PendingRow): PendingCheck | null {
  if (!isAbilityKey(row.pendingStat)) return null
  const dc = row.pendingDc
  if (typeof dc !== 'number' || !Number.isFinite(dc) || dc < 1) return null
  return { stat: row.pendingStat, dc }
}

/**
 * Clears the pending check a roll just answered, on the roller's own row
 * (`P5.19`, ADR 0030).
 *
 * The `roll-logs` row has already landed, so this never fails the action: a
 * failed or thrown clear comes back as the reason it did not land, and the
 * caller reports it in `details` rather than retracting a roll that happened.
 */
async function clearPendingCheck(
  tools: ActionContext<Env>['tools'],
  characterId: string,
): Promise<{ pendingClearFailed: string } | undefined> {
  try {
    const cleared = await tools.update('characters', characterId, { ...NO_PENDING_CHECK })
    if (cleared && cleared.success) return undefined
    return { pendingClearFailed: cleared?.error ?? 'the character row was not updated' }
  } catch (error) {
    return { pendingClearFailed: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Clears every character's pending check in the one campaign (ADR 0030).
 *
 * An accepted scene advance closes the scene the checks belonged to, so the
 * whole party's gates go with it. Rows that owe nothing are left alone (no
 * no-op writes), and a failed read or write is reported: the advance has not
 * been written yet at that point, so the caller can refuse it cleanly.
 */
async function clearPartyPendingChecks(
  tools: ActionContext<Env>['tools'],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const roster = await tools.query<PendingRow>('characters', {
    where: { campaignId: DEFAULT_CAMPAIGN_ID },
    limit: RESET_ROSTER_LIMIT,
  })
  if (!roster.success) return { ok: false, error: roster.error }
  for (const record of roster.data.records) {
    if (pendingCheckOf(record.data) === null) continue
    const cleared = await tools.update('characters', record.recordId, { ...NO_PENDING_CHECK })
    if (!cleared.success) return { ok: false, error: cleared.error }
  }
  return { ok: true }
}

/**
 * The first **other** sheet at this table that owes a check (`P5.31`, ADR 0030
 * amendment 2026-11-20).
 *
 * Storage is per character; authorisation is not. With no request of their own a
 * player would otherwise fall through to the scene DC and write a real
 * `roll-logs` row for a stat the GM asked of someone else — which is exactly what
 * happened. Reading the party is what closes it: one outstanding check means
 * nobody but its target may roll, because the GM is waiting on that sheet's die.
 *
 * The read is the same campaign-scoped roster query the party-wide clears use. A
 * failed read is `{ ok: false }` and the caller refuses the roll: an unreadable
 * party must not authorise anything.
 */
async function owedByOtherCharacter(
  tools: ActionContext<Env>['tools'],
  characterId: string,
): Promise<
  { ok: true; owed: { name: string; check: PendingCheck } | null } | { ok: false; error: string }
> {
  let roster: ActionResult<{ records: { recordId: string; data: PendingRow }[] }>
  try {
    roster = await tools.query<PendingRow>('characters', {
      where: { campaignId: DEFAULT_CAMPAIGN_ID },
      limit: RESET_ROSTER_LIMIT,
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  if (!roster.success) return { ok: false, error: roster.error }
  for (const record of roster.data.records) {
    // The caller's own row was read above and is the caller's to spend.
    if (record.recordId === characterId) continue
    const check = pendingCheckOf(record.data)
    if (check === null) continue
    const name =
      typeof record.data.name === 'string' && record.data.name.trim() !== ''
        ? record.data.name
        : 'Another adventurer'
    return { ok: true, owed: { name, check } }
  }
  return { ok: true, owed: null }
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
 *
 * One check is live per sheet (`P5.19`, ADR 0030). When the caller's own
 * character row carries a pending check, the roll must be that stat or it is
 * refused with `roll_not_requested` **before a die is spent**, and its DC is the
 * request's own — per-action, not the scene's. When the caller owes nothing but
 * **another** sheet does, the roll is refused with `check_owed_by_other` for the
 * same reason: the GM is waiting on that sheet, and a roll here would log a stat
 * nobody asked for (ADR 0030 amendment 2026-11-20). Nothing owed anywhere keeps
 * the scene's `activeThreatDc`, so every existing caller is unchanged.
 * The request is spent on success **and** on failure: a failed check has been
 * answered too.
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
  const state = campaign.data.record.data
  const pending = pendingCheckOf(character)

  // The request is the only legal roll while it stands. Refused here, before the
  // die is drawn: the sheet must not be able to bank a roll the GM did not call
  // for, and the GM must never have to reject a row that already exists.
  if (pending && pending.stat !== statName) {
    return {
      success: false,
      code: 'roll_not_requested',
      error: `You are being asked for a ${pending.stat.toUpperCase()} check; ${statName.toUpperCase()} was not requested`,
    }
  }

  // Storage is per character; authorisation is not (ADR 0030 amendment
  // 2026-11-20). A caller who owes nothing may only roll freely while no other
  // sheet is being asked — otherwise this roll would answer someone else's check
  // with a stat the GM never requested. Refused before the die and before any
  // write, and a party that cannot be read fails closed for the same reason.
  if (!pending) {
    const other = await owedByOtherCharacter(tools, characterId)
    if (!other.ok) {
      return {
        success: false,
        code: 'check_owed_by_other',
        error: "The party's pending checks could not be read; the roll was refused",
      }
    }
    if (other.owed) {
      return {
        success: false,
        code: 'check_owed_by_other',
        error: `${other.owed.name} is being asked for a ${other.owed.check.stat.toUpperCase()} check; you have not been asked to roll`,
      }
    }
  }

  // A pending request carries its own DC — that is what makes a jump (17) and a
  // lever (12) different numbers in the same scene. Nothing pending falls back to
  // the scene's threat DC, exactly as before.
  const targetDc = pending ? pending.dc : state.activeThreatDc
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

  // The request is answered, whether the die succeeded or failed. Cleared after
  // the row is durable, and never at the cost of the roll: see
  // `clearPendingCheck`.
  const clearing = pending ? await clearPendingCheck(tools, characterId) : undefined

  return {
    success: true,
    data: {
      rawRoll,
      modifier,
      total,
      targetDc,
      outcome,
      rollLogId: created.data.recordId,
      ...(clearing === undefined ? {} : { details: clearing }),
    },
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

/** `deleteWhere`'s page size for a reset drain (SDK default 100, max 500). */
const RESET_DRAIN_PAGE = 100

/**
 * Defensive cap on a reset's drain pages: 50 pages × 100 rows is far past any
 * table this build can produce, and a broken `deleted` count must not spin the
 * action forever. Hitting it stops the reset and is reported, never ignored.
 */
const RESET_DRAIN_MAX_PAGES = 50

/** The campaign's character rows a reset reads, bounded like Forge's name check. */
const RESET_ROSTER_LIMIT = 200

type DrainOutcome = { ok: true; deleted: number } | { ok: false; error: string }

/**
 * Deletes every row matching `where`, one bounded page at a time, and reports
 * how many went. `deleteWhere` removes at most `limit` per call, so a full page
 * means "ask again"; a short page is the end of the collection.
 */
async function drainCollection(
  tools: ActionContext<Env>['tools'],
  collection: string,
  where: Record<string, unknown>,
): Promise<DrainOutcome> {
  let deleted = 0
  for (let page = 1; ; page += 1) {
    if (page > RESET_DRAIN_MAX_PAGES) {
      return {
        ok: false,
        error: `${collection} drain stopped after ${RESET_DRAIN_MAX_PAGES} pages (${deleted} rows deleted)`,
      }
    }
    const drained = await tools.deleteWhere(collection, where, RESET_DRAIN_PAGE)
    if (!drained.success) return { ok: false, error: drained.error }
    deleted += drained.data.deleted
    if (drained.data.deleted < RESET_DRAIN_PAGE) return { ok: true, deleted }
  }
}

/** The archetype preset a reset restores a pack from, or `undefined` if unknown. */
function presetFor(archetype: string): ArchetypePreset | undefined {
  return (ARCHETYPE_PRESETS as Record<string, ArchetypePreset | undefined>)[archetype]
}

/** The one row a reset leaves behind, and the boundary it marks (ADR 0026). */
const NEW_GAME_MARKER = 'A new game begins — Act I, Scene 1'

export interface StartCampaignData {
  sceneIndex: number
  progress: string
  clearedRolls: number
  clearedMessages: number
  clearedItems: number
  healedCharacters: number
  grantedItems: number
  /** Starter items a reset could not write, and any character it could not kit. */
  itemsMissing: string[]
  /** Whether the marker row was written; a reset that landed is still a success. */
  logged: boolean
  details?: { applied: string[]; logError?: string }
}

/**
 * "Start New Campaign" — a new game at the same table (ADR 0023, ADR 0025,
 * ADR 0026).
 *
 * The caller must have a character in the campaign (`not_at_table` otherwise):
 * this is a table action, not a GM write, and a drive-by visitor must not be
 * able to wipe a live table. Then, in this order, stopping at the first failure
 * and reporting the stages that already landed (`details.applied`):
 *
 * 1. drain `inventory` for the campaign, 2. drain `roll-logs` (ADR 0026 — a new
 * game starts with one feed row, not last run's dice), 3. upsert `campaigns` at
 * `sceneColumns(0)` keeping the existing `title`, 4. set every character's `hp`
 * to its own `maxHp` and clear its pending check (engine-authored, so this is
 * not a player HP path, ADR 0020; ADR 0030 — no sheet owes a roll in a new
 * game), 5. re-create each character's archetype starter kit for its owner
 * (the same rows Forge writes, ADR 0025), and 6. **last**, one `gm_event` marker
 * row — last so the reset cannot delete its own evidence.
 *
 * There are no transactions across `tools.*`, so a character healed before a
 * failed item write stays healed; the result names the counts that landed rather
 * than implying all-or-nothing. Starter-item failures are reported in
 * `itemsMissing` (Forge's pattern) instead of discarding the reset.
 */
export async function startCampaign(
  ctx: ActionContext<Env>,
): Promise<ActionResult<StartCampaignData>> {
  const { tools, userId } = ctx

  const membership = await tools.query<MembershipRow>('characters', {
    where: { userId, campaignId: DEFAULT_CAMPAIGN_ID },
    limit: 1,
  })
  if (!membership.success) return writeFailed('membership', membership.error, [])
  if (membership.data.records.length === 0) {
    return {
      success: false,
      code: 'not_at_table',
      error: `The caller has no character in campaign ${JSON.stringify(DEFAULT_CAMPAIGN_ID)}`,
    }
  }

  const applied: string[] = []

  const items = await drainCollection(tools, 'inventory', { campaignId: DEFAULT_CAMPAIGN_ID })
  if (!items.ok) return writeFailed('inventory', items.error, applied)
  applied.push('inventory')

  const rolls = await drainCollection(tools, 'roll-logs', { campaignId: DEFAULT_CAMPAIGN_ID })
  if (!rolls.ok) return writeFailed('roll-logs', rolls.error, applied)
  applied.push('roll-logs')

  // A new game is a new conversation (ADR 0027): the shared GM thread belongs to
  // the run, so it goes with the log. The opening beat repopulates it.
  const messages = await drainCollection(tools, 'gm-messages', {
    campaignId: DEFAULT_CAMPAIGN_ID,
  })
  if (!messages.ok) return writeFailed('gm-messages', messages.error, applied)
  applied.push('gm-messages')

  // The scene is an upsert of the known id; only the title is taken from the
  // existing row, so a reset never renames the campaign.
  const existing = await tools.query<{ title?: string }>('campaigns', {
    where: { recordId: DEFAULT_CAMPAIGN_ID },
    limit: 1,
  })
  if (!existing.success) return writeFailed('campaign', existing.error, applied)
  const existingTitle = existing.data.records[0]?.data.title
  const title =
    typeof existingTitle === 'string' && existingTitle !== ''
      ? existingTitle
      : DEFAULT_CAMPAIGN_SEED.title
  // A reset is a new game, so nothing is pending: the opening scene has not
  // asked the table for anything yet. The characters' own pending columns are
  // cleared below, in the same write that restores their HP.
  // A new game is round one (ADR 0031): the round counter is part of the run, so
  // it starts over with the scene rather than carrying the old pace forward.
  const opening = { ...sceneColumns(0), roundNumber: 1 }
  const scene = await tools.create(
    'campaigns',
    { title, ...opening },
    DEFAULT_CAMPAIGN_ID,
  )
  if (!scene.success) return writeFailed('campaign', scene.error, applied)
  applied.push('campaigns')

  const roster = await tools.query<ResetCharacterRow>('characters', {
    where: { campaignId: DEFAULT_CAMPAIGN_ID },
    limit: RESET_ROSTER_LIMIT,
  })
  if (!roster.success) return writeFailed('characters', roster.error, applied)

  let healedCharacters = 0
  let grantedItems = 0
  const itemsMissing: string[] = []
  for (const record of roster.data.records) {
    const character = record.data
    // Engine-authored: the value is the row's own `maxHp`, never a caller's. The
    // pending check is cleared in the same write (ADR 0030): a new game has not
    // asked this character for anything.
    const maxHp = typeof character.maxHp === 'number' ? character.maxHp : 0
    const healed = await tools.update('characters', record.recordId, {
      hp: maxHp,
      ...NO_PENDING_CHECK,
      // Nobody has acted in the new game's first round yet, so the GM stages
      // every player on the opening beat (ADR 0031).
      actedRound: 0,
    })
    if (!healed.success) return writeFailed('character_hp', healed.error, applied)
    healedCharacters += 1
    applied.push(`characters:${record.recordId}`)

    const preset = presetFor(character.archetype)
    if (!preset) {
      // Never invent a kit for an archetype this build does not know: name it
      // and move on, so one odd row cannot take the whole reset down.
      itemsMissing.push(`${character.name}: unknown archetype ${JSON.stringify(character.archetype)}`)
      continue
    }
    for (const item of preset.starterItems) {
      const created = await tools.create('inventory', {
        // The pack belongs to the character's owner, not to whoever reset.
        userId: character.userId,
        characterId: record.recordId,
        campaignId: DEFAULT_CAMPAIGN_ID,
        itemName: item.itemName,
        category: item.category,
        description: item.description,
        quantity: item.quantity,
      })
      if (created.success) grantedItems += 1
      else itemsMissing.push(`${character.name}: ${item.itemName}`)
    }
  }
  applied.push('starter-kits')

  const marker = await tools.create('roll-logs', {
    campaignId: DEFAULT_CAMPAIGN_ID,
    characterName: 'Game Master',
    entryType: 'gm_event',
    outcome: 'info',
    summary: NEW_GAME_MARKER,
  })

  return {
    success: true,
    data: {
      sceneIndex: opening.sceneIndex,
      progress: progressLabel(opening.sceneIndex),
      clearedRolls: rolls.deleted,
      clearedMessages: messages.deleted,
      clearedItems: items.deleted,
      healedCharacters,
      grantedItems,
      itemsMissing,
      logged: marker.success,
      ...(marker.success ? {} : { details: { applied, logError: marker.error } }),
    },
  }
}

export const actions: Record<string, ActionHandler<Env>> = {
  ensureDefaultCampaign,
  applyGmMutation,
  forgeCharacter,
  useItem,
  rollSkillCheck,
  deleteCharacter,
  startCampaign,
}
