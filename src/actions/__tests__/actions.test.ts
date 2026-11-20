import { describe, expect, it, vi } from 'vitest'
import type { ActionTools, ActionResult } from 'deepspace/worker'
import type { Env } from '../../../worker'
import { DEFAULT_CAMPAIGN_ID } from '../../constants'
import { DEFAULT_CAMPAIGN_SEED } from '../../lib/campaign-seed'
import { progressLabel, sceneColumns } from '../../lib/campaign-arc'
import { ARCHETYPE_PRESETS, CONSUMABLE_EFFECTS, calculateArmorClass } from '../../lib/d20'
import { PREVIEW_CAMPAIGN } from '../../lib/preview-data'
import {
  actions,
  applyGmMutation,
  deleteCharacter,
  ensureDefaultCampaign,
  forgeCharacter,
  startCampaign,
  useItem,
} from '../index'

/**
 * The gate on the actions' own authorization.
 *
 * Every action runs with per-record RBAC off (`ctx.tools` carry `X-App-Action`),
 * so the record room enforces nothing: these tests are what proves
 * `applyGmMutation` refuses every caller but the app owner, that Forge and item
 * use only touch the caller's own rows, and that the seed writes the same values
 * the signed-out fixture renders. A fake `ActionTools` records the calls, so "no
 * write happened" is asserted, not assumed.
 */

function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

function failed(code: string, error: string): ActionResult<never> {
  return { success: false, code, error }
}

interface FakeToolsOptions {
  query?: ActionResult<unknown>
  get?: ActionResult<unknown> | ((collection: string) => ActionResult<unknown>)
  create?: ActionResult<unknown>
  update?: ActionResult<unknown>
  remove?: ActionResult<unknown>
  deleteWhere?: ActionResult<unknown>
}

/**
 * One `vi.fn()` per tool, each with a default answer, so a test only spells out
 * the call it cares about. Only this object is cast — the handlers are called
 * through their real signatures.
 */
function createFakeTools(options: FakeToolsOptions = {}) {
  return {
    create: vi.fn().mockResolvedValue(options.create ?? ok({ recordId: 'created-record' })),
    update: vi.fn().mockResolvedValue(options.update ?? ok({ recordId: 'updated-record' })),
    remove: vi.fn().mockResolvedValue(options.remove ?? ok({ recordId: 'removed-record' })),
    deleteWhere: vi.fn().mockResolvedValue(options.deleteWhere ?? ok({ deleted: 0 })),
    get: vi.fn().mockImplementation(async (collection: string) => {
      if (typeof options.get === 'function') return options.get(collection)
      return options.get ?? failed('not_found', 'Character not found')
    }),
    // Applies `where` to the canned rows: `recordId` matches the row id, every
    // other key matches a `data` field. The seed's existence check depends on
    // finding its own id, and Forge's duplicate check depends on `userId` — a
    // row for another caller must not answer for this one. An unmatched key
    // returns no rows, so a test can never pass on a stray record.
    query: vi.fn().mockImplementation(async (_collection: string, query?: { where?: Record<string, unknown> }) => {
      const base = options.query ?? ok({ records: [], count: 0 })
      if (!base.success) return base
      const where = query?.where ?? {}
      const rows = (base.data as { records: Record<string, unknown>[] }).records.filter((record) =>
        Object.entries(where).every(([key, value]) =>
          key === 'recordId'
            ? record.recordId === value
            : (record.data as Record<string, unknown> | undefined)?.[key] === value,
        ),
      )
      return ok({ records: rows, count: rows.length })
    }),
    integration: vi.fn(),
    registerUser: vi.fn(),
  }
}

type FakeTools = ReturnType<typeof createFakeTools>

/** The app owner, as production injects it: `OWNER_USER_ID` names the caller. */
const OWNER_USER_ID = 'user-alice'

/**
 * The default caller is the app owner, because that is the only identity
 * `applyGmMutation` accepts (ADR 0017). Pass `userId` to act as a player.
 */
function context(
  tools: FakeTools,
  params: Record<string, unknown> = {},
  userId = OWNER_USER_ID,
) {
  return {
    userId,
    params,
    tools: tools as unknown as ActionTools,
    env: { OWNER_USER_ID } as unknown as Env,
    callerJwt: '',
  }
}

/** A `characters` row: `user-alice` already has one character at the table. */
const MEMBER_QUERY = {
  records: [
    {
      recordId: 'char-kaelen',
      data: { userId: 'user-alice', campaignId: DEFAULT_CAMPAIGN_ID },
    },
  ],
  count: 1,
}

/** A target character, in the seeded campaign unless a test says otherwise. */
function characterGet(
  hp: number,
  maxHp: number,
  campaignId = DEFAULT_CAMPAIGN_ID,
  userId = 'user-alice',
) {
  return ok({
    record: {
      recordId: 'char-kaelen',
      // `name` is what a GM mutation's `roll-logs` row is logged under (P5.10).
      data: { userId, campaignId, name: 'Kaelen', hp, maxHp },
    },
  })
}

/** One `inventory` row in the seeded campaign, owned by the caller unless overridden. */
function itemGet(overrides: Record<string, unknown> = {}) {
  return ok({
    record: {
      recordId: 'item-vial',
      data: {
        userId: 'user-alice',
        characterId: 'char-kaelen',
        campaignId: DEFAULT_CAMPAIGN_ID,
        itemName: 'Sunfire Vial',
        category: 'consumable',
        quantity: 2,
        ...overrides,
      },
    },
  })
}

/** `tools.get` answers per collection: `useItem` reads an item, then its character. */
function getRouter(routes: { inventory?: ActionResult<unknown>; characters?: ActionResult<unknown> }) {
  return (collection: string) =>
    routes[collection as 'inventory' | 'characters'] ??
    failed('not_found', `${collection} not found`)
}

describe('action surface', () => {
  // ADR 0020 deleted `adjustCharacterHp`, and the whole point was that hiding the
  // buttons is not enough: the route itself must be gone. This pins the
  // registered set so a player-facing HP path cannot quietly grow back.
  // `rollSkillCheck` is the sixth and the only roll authority (ADR 0005), so a
  // second roll path would have to be added here on purpose. `startCampaign` is
  // the seventh: a new game, not a second HP path (ADR 0025).
  it('registers exactly the seven server actions', () => {
    expect(Object.keys(actions).sort()).toEqual([
      'applyGmMutation',
      'deleteCharacter',
      'ensureDefaultCampaign',
      'forgeCharacter',
      'rollSkillCheck',
      'startCampaign',
      'useItem',
    ])
  })
})

describe('ensureDefaultCampaign', () => {
  it('creates the default campaign with the fixture values on an empty collection', async () => {
    const tools = createFakeTools()

    const result = await ensureDefaultCampaign(context(tools))

    expect(result).toEqual({
      success: true,
      data: { campaignId: DEFAULT_CAMPAIGN_ID, created: true },
    })
    expect(tools.create).toHaveBeenCalledTimes(1)
    expect(tools.create).toHaveBeenCalledWith(
      'campaigns',
      DEFAULT_CAMPAIGN_SEED,
      DEFAULT_CAMPAIGN_ID,
    )
    // Drift guard (P2.6): the seeded row is the signed-out fixture's data,
    // not a lookalike that can fall out of step.
    expect(tools.create.mock.calls[0][1]).toEqual(PREVIEW_CAMPAIGN.data)
  })

  it('writes nothing when the campaign already exists', async () => {
    const tools = createFakeTools({
      query: ok({ records: [{ recordId: DEFAULT_CAMPAIGN_ID }], count: 1 }),
    })

    const result = await ensureDefaultCampaign(context(tools))

    expect(result).toEqual({
      success: true,
      data: { campaignId: DEFAULT_CAMPAIGN_ID, created: false },
    })
    // The existence check looks for the seeded row itself, not "any row".
    expect(tools.query).toHaveBeenCalledWith('campaigns', {
      where: { recordId: DEFAULT_CAMPAIGN_ID },
      limit: 1,
    })
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('still seeds when the only campaigns row has a foreign id', async () => {
    const tools = createFakeTools({
      query: ok({
        records: [{ recordId: 'someone-elses-campaign', data: { title: 'Other table' } }],
        count: 1,
      }),
    })

    const result = await ensureDefaultCampaign(context(tools))

    expect(result).toEqual({
      success: true,
      data: { campaignId: DEFAULT_CAMPAIGN_ID, created: true },
    })
    expect(tools.create).toHaveBeenCalledWith(
      'campaigns',
      DEFAULT_CAMPAIGN_SEED,
      DEFAULT_CAMPAIGN_ID,
    )
  })

  it('reports seed_failed when the existence check fails', async () => {
    const tools = createFakeTools({ query: failed('do_unavailable', 'record room unavailable') })

    const result = await ensureDefaultCampaign(context(tools))

    expect(result).toEqual({
      success: false,
      code: 'seed_failed',
      error: 'record room unavailable',
    })
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('reports seed_failed when the create fails', async () => {
    const tools = createFakeTools({
      create: failed('write_refused', 'insert refused'),
    })

    const result = await ensureDefaultCampaign(context(tools))

    expect(result).toEqual({
      success: false,
      code: 'seed_failed',
      error: 'insert refused',
    })
  })
})

describe('applyGmMutation', () => {
  it('refuses a non-owner caller with not_gm before any read or write', async () => {
    // The caller is a seated player — `MEMBER_QUERY` and the target below would
    // both answer — to prove membership is not the authority any more: a player
    // could otherwise set their own HP with `delta: 999` (ADR 0017).
    const tools = createFakeTools({ query: ok(MEMBER_QUERY), get: characterGet(10, 20) })

    const result = await applyGmMutation(
      context(
        tools,
        { mutation: { kind: 'character_hp', characterId: 'char-kaelen', delta: 999 } },
        'user-bob',
      ),
    )

    expect(result).toEqual({
      success: false,
      code: 'not_gm',
      error: expect.any(String),
    })
    expect(tools.query).not.toHaveBeenCalled()
    expect(tools.get).not.toHaveBeenCalled()
    expect(tools.update).not.toHaveBeenCalled()
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('runs for the owner with no character row of its own', async () => {
    // The owner is not a player, so there is nothing to look up: `query` would
    // return its default (no rows) and is never called.
    const tools = createFakeTools({ get: characterGet(12, 20) })

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'character_hp', characterId: 'char-kaelen', delta: -3 },
      }),
    )

    expect(result).toEqual({
      success: true,
      data: {
        kind: 'character_hp',
        characterId: 'char-kaelen',
        hp: { before: 12, after: 9, maxHp: 20, appliedDelta: -3 },
        logged: true,
      },
    })
    expect(tools.update).toHaveBeenCalledWith('characters', 'char-kaelen', { hp: 9 })
    expect(tools.query).not.toHaveBeenCalled()
  })

  it('clamps character_hp at 0 and reports the applied delta', async () => {
    const tools = createFakeTools({ get: characterGet(4, 20) })

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'character_hp', characterId: 'char-kaelen', delta: -10 },
      }),
    )

    expect(result).toEqual({
      success: true,
      data: {
        kind: 'character_hp',
        characterId: 'char-kaelen',
        hp: { before: 4, after: 0, maxHp: 20, appliedDelta: -4 },
        logged: true,
      },
    })
    expect(tools.update).toHaveBeenCalledWith('characters', 'char-kaelen', { hp: 0 })
    // The target is read by the caller's own recordId, never by index.
    expect(tools.get).toHaveBeenCalledWith('characters', 'char-kaelen')
    // `characters.userId` is userBound + immutable: never in an update.
    expect(tools.update.mock.calls[0][2]).not.toHaveProperty('userId')
  })

  it('clamps character_hp at maxHp and reports the applied delta', async () => {
    const tools = createFakeTools({ get: characterGet(18, 20) })

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'character_hp', characterId: 'char-kaelen', delta: 10 },
      }),
    )

    expect(result).toEqual({
      success: true,
      data: {
        kind: 'character_hp',
        characterId: 'char-kaelen',
        hp: { before: 18, after: 20, maxHp: 20, appliedDelta: 2 },
        logged: true,
      },
    })
    expect(tools.update).toHaveBeenCalledWith('characters', 'char-kaelen', { hp: 20 })
  })

  it('refuses a target character in another campaign', async () => {
    const tools = createFakeTools({
      get: characterGet(10, 20, 'other-campaign'),
    })

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'character_hp', characterId: 'char-kaelen', delta: -3 },
      }),
    )

    expect(result).toEqual({
      success: false,
      code: 'character_not_found',
      error: expect.any(String),
    })
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('forces campaignId and defaults quantity when granting loot', async () => {
    const tools = createFakeTools({
      get: characterGet(12, 20),
      create: ok({ recordId: 'item-cinder-ward' }),
    })

    const result = await applyGmMutation(
      context(tools, {
        mutation: {
          kind: 'grant_loot',
          characterId: 'char-kaelen',
          item: {
            itemName: 'Cinder Ward',
            category: 'armor',
            // Not part of the item contract — zod strips it, and the action
            // forces the campaign itself.
            campaignId: 'other-campaign',
          },
        },
      }),
    )

    expect(tools.create).toHaveBeenCalledWith('inventory', {
      characterId: 'char-kaelen',
      // Granted by the GM, owned by the player whose character received it.
      userId: 'user-alice',
      campaignId: DEFAULT_CAMPAIGN_ID,
      itemName: 'Cinder Ward',
      quantity: 1,
      category: 'armor',
    })
    expect(result).toEqual({
      success: true,
      data: {
        kind: 'grant_loot',
        characterId: 'char-kaelen',
        item: { recordId: 'item-cinder-ward', itemName: 'Cinder Ward', quantity: 1 },
        logged: true,
      },
    })
  })

  it('stamps granted loot with the target character owner, not the caller', async () => {
    const tools = createFakeTools({
      get: characterGet(12, 20, DEFAULT_CAMPAIGN_ID, 'user-bob'),
    })

    const result = await applyGmMutation(
      context(tools, {
        mutation: {
          kind: 'grant_loot',
          characterId: 'char-kaelen',
          item: { itemName: 'Sunfire Vial', category: 'consumable', quantity: 2 },
        },
      }),
    )

    expect(result.success).toBe(true)
    // `inventory` is owner-scoped (ADR 0015): the GM writes for the table, but
    // the row belongs to the player, so ownership follows the target's userId.
    expect(tools.create).toHaveBeenCalledWith('inventory', {
      characterId: 'char-kaelen',
      userId: 'user-bob',
      campaignId: DEFAULT_CAMPAIGN_ID,
      itemName: 'Sunfire Vial',
      quantity: 2,
      category: 'consumable',
    })
  })

  it('rejects the retired relic category and writes nothing', async () => {
    const tools = createFakeTools({ get: characterGet(12, 20) })

    const result = await applyGmMutation(
      context(tools, {
        mutation: {
          kind: 'grant_loot',
          characterId: 'char-kaelen',
          item: { itemName: 'Cinder Focus', category: 'relic' },
        },
      }),
    )

    if (result.success) throw new Error('expected invalid_params, got success')
    expect(result.code).toBe('invalid_params')
    expect(result.issues?.length).toBeGreaterThan(0)
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('accepts a quest item', async () => {
    const tools = createFakeTools({
      get: characterGet(12, 20),
      create: ok({ recordId: 'item-vault-key' }),
    })

    const result = await applyGmMutation(
      context(tools, {
        mutation: {
          kind: 'grant_loot',
          characterId: 'char-kaelen',
          item: { itemName: 'Vault Key', category: 'quest' },
        },
      }),
    )

    expect(result.success).toBe(true)
    expect(tools.create).toHaveBeenCalledWith(
      'inventory',
      expect.objectContaining({ itemName: 'Vault Key', category: 'quest' }),
    )
  })

  it('writes only whitelisted scene columns and ignores title and unknown keys', async () => {
    const tools = createFakeTools()

    const result = await applyGmMutation(
      context(tools, {
        mutation: {
          kind: 'update_scene',
          scene: {
            title: 'Hijacked Title',
            locationName: 'The Sunken Reliquary',
            atmosphereTag: 'dungeon',
            notAColumn: 1,
          },
        },
      }),
    )

    expect(tools.update).toHaveBeenCalledWith('campaigns', DEFAULT_CAMPAIGN_ID, {
      locationName: 'The Sunken Reliquary',
      atmosphereTag: 'dungeon',
    })
    expect(tools.update.mock.calls[0][2]).not.toHaveProperty('title')
    expect(result).toEqual({
      success: true,
      data: {
        kind: 'update_scene',
        scene: { applied: ['locationName', 'atmosphereTag'] },
        logged: true,
      },
    })
  })

  it('reports write_failed with the stage and what landed when the only write fails', async () => {
    // `write_failed` carries an ordered best-effort report because there are no
    // transactions. Every kind currently writes one record, so a failure here
    // means nothing landed; the `applied` field stays on the wire for a future
    // multi-write mutation.
    const tools = createFakeTools({
      get: characterGet(10, 20),
      update: failed('write_refused', 'write refused'),
    })

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'character_hp', characterId: 'char-kaelen', delta: -4 },
      }),
    )

    expect(result).toEqual({
      success: false,
      code: 'write_failed',
      error: 'write refused',
      details: { stage: 'character_hp', applied: [] },
    })
  })

  it('rejects invalid params with issues before touching records', async () => {
    const tools = createFakeTools()

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'grant_loot', characterId: 'char-kaelen', item: { itemName: '' } },
      }),
    )

    if (result.success) throw new Error('expected invalid_params, got success')
    expect(result.code).toBe('invalid_params')
    expect(result.issues?.length).toBeGreaterThan(0)
    expect(tools.query).not.toHaveBeenCalled()
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('rejects an atmosphere tag outside the schema select', async () => {
    const tools = createFakeTools()

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'update_scene', scene: { atmosphereTag: 'swamp' } },
      }),
    )

    if (result.success) throw new Error('expected invalid_params, got success')
    expect(result.code).toBe('invalid_params')
    expect(tools.query).not.toHaveBeenCalled()
    expect(tools.update).not.toHaveBeenCalled()
  })

  // ── Feed evidence (P5.10, ADR 0009) ─────────────────────────────────────
  // A GM mutation is not finished until the table can see it: one `roll-logs`
  // row per successful kind, written after the mutation, with the columns the
  // feed renders.

  it('logs one combat row with the clamped HP change and the reason', async () => {
    const tools = createFakeTools({ get: characterGet(18, 24) })

    const result = await applyGmMutation(
      context(tools, {
        mutation: {
          kind: 'character_hp',
          characterId: 'char-kaelen',
          delta: -6,
          reason: '  The blade bites deep  ',
        },
      }),
    )

    expect(tools.create).toHaveBeenCalledWith('roll-logs', {
      campaignId: DEFAULT_CAMPAIGN_ID,
      characterName: 'Kaelen',
      entryType: 'combat',
      outcome: 'info',
      // Before → after carries the clamp; the reason is trimmed, not required.
      summary: 'Kaelen takes 6 damage (18/24 to 12/24) — The blade bites deep',
    })
    const log = tools.create.mock.calls.find(([collection]) => collection === 'roll-logs')?.[1]
    // `userId` is userBound and `rolledAt` is the summary timestampTrigger's:
    // the action may not claim either.
    expect(log).not.toHaveProperty('userId')
    expect(log).not.toHaveProperty('rolledAt')
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('expected success')
    expect(result.data.logged).toBe(true)
  })

  it('logs one gm_event row when loot is granted', async () => {
    const tools = createFakeTools({ get: characterGet(12, 20) })

    await applyGmMutation(
      context(tools, {
        mutation: {
          kind: 'grant_loot',
          characterId: 'char-kaelen',
          item: { itemName: 'Sunfire Vial', category: 'consumable', quantity: 2 },
        },
      }),
    )

    expect(tools.create).toHaveBeenCalledWith('roll-logs', {
      campaignId: DEFAULT_CAMPAIGN_ID,
      characterName: 'Kaelen',
      entryType: 'gm_event',
      outcome: 'info',
      summary: 'Kaelen receives Sunfire Vial x2',
    })
  })

  it('logs one gm_event row from the Game Master when the scene shifts', async () => {
    const tools = createFakeTools()

    const result = await applyGmMutation(
      context(tools, {
        mutation: {
          kind: 'update_scene',
          scene: { locationName: 'The Sunken Reliquary', atmosphereTag: 'dungeon' },
        },
      }),
    )

    expect(tools.create).toHaveBeenCalledWith('roll-logs', {
      campaignId: DEFAULT_CAMPAIGN_ID,
      // The scene has no character of its own, so the GM signs the row.
      characterName: 'Game Master',
      entryType: 'gm_event',
      outcome: 'info',
      summary: 'The scene shifts to The Sunken Reliquary',
    })
    expect(result.success).toBe(true)
  })

  it('logs the first applied scene column when there is no location', async () => {
    const tools = createFakeTools()

    await applyGmMutation(
      context(tools, {
        mutation: { kind: 'update_scene', scene: { atmosphereTag: 'combat' } },
      }),
    )

    expect(tools.create).toHaveBeenCalledWith(
      'roll-logs',
      expect.objectContaining({ summary: 'The scene shifts: atmosphereTag is now combat' }),
    )
  })

  it('writes no roll-logs row when it refuses a mutation', async () => {
    // Three refusals, one per gate: identity, a missing target, and a target in
    // another campaign. None of them mutated anything, so none may leave
    // evidence that it did.
    const refusals = [
      {
        name: 'not_gm',
        tools: createFakeTools({ get: characterGet(10, 20) }),
        userId: 'user-bob',
        mutation: { kind: 'character_hp', characterId: 'char-kaelen', delta: -3 },
      },
      {
        name: 'character_not_found',
        tools: createFakeTools(),
        userId: OWNER_USER_ID,
        mutation: { kind: 'character_hp', characterId: 'char-missing', delta: -3 },
      },
      {
        name: 'character_not_found (other campaign)',
        tools: createFakeTools({ get: characterGet(10, 20, 'other-campaign') }),
        userId: OWNER_USER_ID,
        mutation: { kind: 'grant_loot', characterId: 'char-kaelen', item: { itemName: 'Cinder Ward' } },
      },
    ]

    for (const refusal of refusals) {
      const result = await applyGmMutation(
        context(refusal.tools, { mutation: refusal.mutation }, refusal.userId),
      )

      expect(result.success, refusal.name).toBe(false)
      expect(refusal.tools.create, refusal.name).not.toHaveBeenCalled()
    }
  })

  it('returns the successful mutation with logged: false when the log write fails', async () => {
    // The mutation landed and cannot be un-done, so the result must not read as
    // a failure: it reports the write that happened and the evidence that did not.
    const tools = createFakeTools({ get: characterGet(18, 24) })
    tools.create.mockResolvedValue(failed('write_refused', 'log write refused'))

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'character_hp', characterId: 'char-kaelen', delta: -6 },
      }),
    )

    expect(result).toEqual({
      success: true,
      data: {
        kind: 'character_hp',
        characterId: 'char-kaelen',
        hp: { before: 18, after: 12, maxHp: 24, appliedDelta: -6 },
        logged: false,
        details: { applied: ['characters:char-kaelen'], logError: 'log write refused' },
      },
    })
    expect(tools.update).toHaveBeenCalledTimes(1)
  })

  it('refuses a reason longer than 200 characters before writing anything', async () => {
    const tools = createFakeTools({ get: characterGet(18, 24) })

    const result = await applyGmMutation(
      context(tools, {
        mutation: {
          kind: 'character_hp',
          characterId: 'char-kaelen',
          delta: -6,
          reason: 'x'.repeat(201),
        },
      }),
    )

    if (result.success) throw new Error('expected invalid_params, got success')
    expect(result.code).toBe('invalid_params')
    expect(tools.update).not.toHaveBeenCalled()
    expect(tools.create).not.toHaveBeenCalled()
  })
})

describe('forgeCharacter', () => {
  it('forges the preset with full HP, computed AC and two owned starter items', async () => {
    const preset = ARCHETYPE_PRESETS.Vanguard
    const tools = createFakeTools()
    const writes: { collection: string; data: Record<string, unknown> }[] = []
    tools.create.mockImplementation(async (collection: string, data: Record<string, unknown>) => {
      writes.push({ collection, data })
      return ok({ recordId: collection === 'characters' ? 'char-forged' : `item-${writes.length}` })
    })

    const result = await forgeCharacter(context(tools, { name: '  Ash  ', archetype: 'Vanguard' }))

    expect(result).toEqual({
      success: true,
      data: { characterId: 'char-forged', name: 'Ash', archetype: 'Vanguard', itemsMissing: [] },
    })
    // The duplicate check is scoped to the caller and the one campaign.
    expect(tools.query).toHaveBeenCalledWith('characters', {
      where: { userId: 'user-alice', campaignId: DEFAULT_CAMPAIGN_ID },
      limit: 1,
    })

    const [character, ...items] = writes
    expect(character.collection).toBe('characters')
    // The 13 columns Forge owns, and nothing the caller supplied for hp/ac.
    // (`pendingStat`/`pendingDc` are the schema's "nothing pending" defaults,
    // not a forge input — ADR 0030.)
    expect(character.data).toEqual({
      userId: 'user-alice',
      campaignId: DEFAULT_CAMPAIGN_ID,
      name: 'Ash',
      archetype: 'Vanguard',
      hp: preset.maxHp,
      maxHp: preset.maxHp,
      ac: calculateArmorClass(preset.scores.dex, preset.armorBonus),
      ...preset.scores,
    })
    expect(Object.keys(character.data)).toHaveLength(13)
    expect(character.data.hp).toBe(preset.maxHp)
    expect(character.data.ac).toBe(16)

    expect(items.map((item) => item.collection)).toEqual(['inventory', 'inventory'])
    expect(items.map((item) => item.data)).toEqual(
      preset.starterItems.map((item) => ({
        userId: 'user-alice',
        characterId: 'char-forged',
        campaignId: DEFAULT_CAMPAIGN_ID,
        itemName: item.itemName,
        category: item.category,
        description: item.description,
        quantity: item.quantity,
      })),
    )
  })

  it('refuses a second character and writes nothing', async () => {
    const tools = createFakeTools({ query: ok(MEMBER_QUERY) })

    const result = await forgeCharacter(context(tools, { name: 'Ash', archetype: 'Vanguard' }))

    if (result.success) throw new Error('expected already_forged, got success')
    expect(result.code).toBe('already_forged')
    expect(result.error).toContain('one character per player')
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('reports the item names that failed without failing the forge', async () => {
    const preset = ARCHETYPE_PRESETS.Arcanist
    const tools = createFakeTools()
    let call = 0
    tools.create.mockImplementation(async (collection: string) => {
      call += 1
      if (collection === 'characters') return ok({ recordId: 'char-forged' })
      if (call === 2) return ok({ recordId: 'item-first' })
      return failed('write_refused', 'insert refused')
    })

    const result = await forgeCharacter(context(tools, { name: 'Ash', archetype: 'Arcanist' }))

    expect(result).toEqual({
      success: true,
      data: {
        characterId: 'char-forged',
        name: 'Ash',
        archetype: 'Arcanist',
        itemsMissing: [preset.starterItems[1].itemName],
      },
    })
  })

  it('reports write_failed at create_character and stops before the items', async () => {
    const tools = createFakeTools({ create: failed('write_refused', 'insert refused') })

    const result = await forgeCharacter(context(tools, { name: 'Ash', archetype: 'Vanguard' }))

    expect(result).toEqual({
      success: false,
      code: 'write_failed',
      error: 'insert refused',
      details: { stage: 'create_character', applied: [] },
    })
    expect(tools.create).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the duplicate check fails', async () => {
    const tools = createFakeTools({ query: failed('do_unavailable', 'record room unavailable') })

    const result = await forgeCharacter(context(tools, { name: 'Ash', archetype: 'Vanguard' }))

    expect(result).toEqual({
      success: false,
      code: 'write_failed',
      error: 'record room unavailable',
      details: { stage: 'membership', applied: [] },
    })
    expect(tools.create).not.toHaveBeenCalled()
  })

  /**
   * Another player's sheet at the same table (`P5.15`). The fake `query` filters
   * canned rows by `where`, so the same record answers the membership query with
   * nothing (different `userId`) and the name query with this row.
   */
  function tableWith(name: string) {
    return createFakeTools({
      query: ok({
        records: [
          {
            recordId: 'char-bob',
            data: { userId: 'user-bob', campaignId: DEFAULT_CAMPAIGN_ID, name },
          },
        ],
        count: 1,
      }),
    })
  }

  it('refuses a name another adventurer at the table already has', async () => {
    const tools = tableWith('Ash')

    const result = await forgeCharacter(context(tools, { name: 'Ash', archetype: 'Vanguard' }))

    if (result.success) throw new Error('expected name_taken, got success')
    expect(result.code).toBe('name_taken')
    expect(result.error).toBe('Another adventurer at this table is already called "Ash"')
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('refuses a duplicate name that differs only by case and whitespace', async () => {
    const tools = tableWith('Ash')

    const result = await forgeCharacter(context(tools, { name: '  aSH ', archetype: 'Vanguard' }))

    if (result.success) throw new Error('expected name_taken, got success')
    expect(result.code).toBe('name_taken')
    // The existing row's spelling, not the requested one: the message names the
    // character the player will actually meet.
    expect(result.error).toContain('"Ash"')
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('forges a different name at a table that has characters', async () => {
    const tools = tableWith('Borin')

    const result = await forgeCharacter(context(tools, { name: 'Ash', archetype: 'Vanguard' }))

    expect(result.success).toBe(true)
    expect(tools.create).toHaveBeenCalledTimes(3)
    expect(tools.create.mock.calls[0][1]).toMatchObject({ name: 'Ash' })
  })

  it('fails closed when the name check fails and writes nothing', async () => {
    let call = 0
    const tools = createFakeTools()
    tools.query.mockImplementation(async () => {
      call += 1
      if (call === 1) return ok({ records: [], count: 0 })
      return failed('do_unavailable', 'record room unavailable')
    })

    const result = await forgeCharacter(context(tools, { name: 'Ash', archetype: 'Vanguard' }))

    expect(result).toEqual({
      success: false,
      code: 'write_failed',
      error: 'record room unavailable',
      details: { stage: 'name_check', applied: [] },
    })
    expect(tools.create).not.toHaveBeenCalled()
  })
})

describe('useItem', () => {
  it('refuses an item the caller does not own and writes nothing', async () => {
    const tools = createFakeTools({
      get: getRouter({ inventory: itemGet({ userId: 'user-bob' }), characters: characterGet(10, 24) }),
    })

    const result = await useItem(context(tools, { itemId: 'item-vial' }))

    if (result.success) throw new Error('expected not_owner, got success')
    expect(result.code).toBe('not_owner')
    expect(tools.update).not.toHaveBeenCalled()
    expect(tools.remove).not.toHaveBeenCalled()
  })

  it('refuses an item pointing at a character the caller does not own', async () => {
    const tools = createFakeTools({
      get: getRouter({
        inventory: itemGet(),
        characters: characterGet(10, 24, DEFAULT_CAMPAIGN_ID, 'user-bob'),
      }),
    })

    const result = await useItem(context(tools, { itemId: 'item-vial' }))

    if (result.success) throw new Error('expected not_owner, got success')
    expect(result.code).toBe('not_owner')
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('refuses a non-consumable', async () => {
    const tools = createFakeTools({
      get: getRouter({
        inventory: itemGet({ category: 'weapon', itemName: 'Ashen Longsword' }),
        characters: characterGet(10, 24),
      }),
    })

    const result = await useItem(context(tools, { itemId: 'item-vial' }))

    if (result.success) throw new Error('expected not_usable, got success')
    expect(result.code).toBe('not_usable')
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('refuses an unknown consumable instead of spending a charge', async () => {
    const tools = createFakeTools({
      get: getRouter({ inventory: itemGet({ itemName: 'Cinder Ward' }), characters: characterGet(10, 24) }),
    })

    const result = await useItem(context(tools, { itemId: 'item-vial' }))

    if (result.success) throw new Error('expected no_effect, got success')
    expect(result.code).toBe('no_effect')
    expect(tools.update).not.toHaveBeenCalled()
    expect(tools.remove).not.toHaveBeenCalled()
  })

  it('refuses at full HP without spending the charge', async () => {
    const tools = createFakeTools({
      get: getRouter({ inventory: itemGet(), characters: characterGet(24, 24) }),
    })

    const result = await useItem(context(tools, { itemId: 'item-vial' }))

    if (result.success) throw new Error('expected at_full, got success')
    expect(result.code).toBe('at_full')
    // The item exists and is owned, but no write happened — the charge is kept.
    expect(tools.update).not.toHaveBeenCalled()
    expect(tools.remove).not.toHaveBeenCalled()
  })

  it('heals from the server-owned effect and spends one charge', async () => {
    const effect = CONSUMABLE_EFFECTS['Sunfire Vial']
    const tools = createFakeTools({
      get: getRouter({ inventory: itemGet({ quantity: 2 }), characters: characterGet(10, 24) }),
    })

    const result = await useItem(context(tools, { itemId: 'item-vial' }))

    expect(result).toEqual({
      success: true,
      data: {
        itemId: 'item-vial',
        itemName: 'Sunfire Vial',
        heal: { requested: effect.heal, applied: effect.heal, hp: 10 + effect.heal, maxHp: 24 },
        quantity: 1,
      },
    })
    expect(tools.update).toHaveBeenNthCalledWith(1, 'characters', 'char-kaelen', {
      hp: 10 + effect.heal,
    })
    expect(tools.update).toHaveBeenNthCalledWith(2, 'inventory', 'item-vial', { quantity: 1 })
    expect(tools.remove).not.toHaveBeenCalled()
  })

  it('clamps the heal at maxHp and reports the applied amount', async () => {
    const effect = CONSUMABLE_EFFECTS['Sunfire Vial']
    const tools = createFakeTools({
      get: getRouter({ inventory: itemGet({ quantity: 2 }), characters: characterGet(22, 24) }),
    })

    const result = await useItem(context(tools, { itemId: 'item-vial' }))

    expect(result).toEqual({
      success: true,
      data: {
        itemId: 'item-vial',
        itemName: 'Sunfire Vial',
        heal: { requested: effect.heal, applied: 2, hp: 24, maxHp: 24 },
        quantity: 1,
      },
    })
  })

  it('removes the row when the last one is used', async () => {
    const tools = createFakeTools({
      get: getRouter({ inventory: itemGet({ quantity: 1 }), characters: characterGet(10, 24) }),
    })

    const result = await useItem(context(tools, { itemId: 'item-vial' }))

    if (!result.success) throw new Error(`expected success, got ${result.code}`)
    expect(result.data.quantity).toBeNull()
    expect(tools.remove).toHaveBeenCalledWith('inventory', 'item-vial')
    // Only the heal is written; the last row is removed, never set to 0.
    expect(tools.update).toHaveBeenCalledTimes(1)
    expect(tools.update).toHaveBeenCalledWith('characters', 'char-kaelen', { hp: 16 })
  })

  it('reports the heal as applied when the inventory write fails', async () => {
    const tools = createFakeTools({
      get: getRouter({ inventory: itemGet({ quantity: 2 }), characters: characterGet(10, 24) }),
    })
    tools.update.mockImplementation(async (collection: string) =>
      collection === 'characters'
        ? ok({ recordId: 'char-kaelen' })
        : failed('write_refused', 'write refused'),
    )

    const result = await useItem(context(tools, { itemId: 'item-vial' }))

    expect(result).toEqual({
      success: false,
      code: 'write_failed',
      error: 'write refused',
      details: { stage: 'inventory', applied: ['character_hp'] },
    })
  })

  it('takes the heal from CONSUMABLE_EFFECTS, never from params', async () => {
    const effect = CONSUMABLE_EFFECTS['Sunfire Vial']
    const tools = createFakeTools({
      get: getRouter({ inventory: itemGet({ quantity: 2 }), characters: characterGet(10, 24) }),
    })

    const result = await useItem(context(tools, { itemId: 'item-vial', heal: 99 }))

    if (!result.success) throw new Error(`expected success, got ${result.code}`)
    expect(result.data.heal.requested).toBe(effect.heal)
    expect(tools.update).toHaveBeenNthCalledWith(1, 'characters', 'char-kaelen', {
      hp: 10 + effect.heal,
    })
  })
})

describe('deleteCharacter', () => {
  it('refuses a character the caller does not own and writes nothing', async () => {
    const tools = createFakeTools({
      get: characterGet(10, 20, DEFAULT_CAMPAIGN_ID, 'user-bob'),
    })

    const result = await deleteCharacter(context(tools, { characterId: 'char-kaelen' }))

    expect(result).toEqual({
      success: false,
      code: 'not_owner',
      error: 'Character "char-kaelen" does not belong to the caller',
    })
    // The whole point: a foreign character costs no inventory and no row.
    expect(tools.deleteWhere).not.toHaveBeenCalled()
    expect(tools.remove).not.toHaveBeenCalled()
  })

  it('reports character_not_found for a missing row', async () => {
    const tools = createFakeTools()

    const result = await deleteCharacter(context(tools, { characterId: 'char-kaelen' }))

    expect(result).toEqual({
      success: false,
      code: 'character_not_found',
      error: 'Character not found',
    })
    expect(tools.deleteWhere).not.toHaveBeenCalled()
    expect(tools.remove).not.toHaveBeenCalled()
  })

  it('refuses a character in another campaign', async () => {
    const tools = createFakeTools({ get: characterGet(10, 20, 'other-campaign') })

    const result = await deleteCharacter(context(tools, { characterId: 'char-kaelen' }))

    if (result.success) throw new Error('expected character_not_found, got success')
    expect(result.code).toBe('character_not_found')
    expect(tools.deleteWhere).not.toHaveBeenCalled()
    expect(tools.remove).not.toHaveBeenCalled()
  })

  it('rejects invalid params before reading anything', async () => {
    const tools = createFakeTools({ get: characterGet(10, 20) })

    const result = await deleteCharacter(context(tools, { characterId: '' }))

    if (result.success) throw new Error('expected invalid_params, got success')
    expect(result.code).toBe('invalid_params')
    expect(result.issues?.length).toBeGreaterThan(0)
    expect(tools.get).not.toHaveBeenCalled()
    expect(tools.deleteWhere).not.toHaveBeenCalled()
  })

  it('drains every inventory page before removing the character', async () => {
    const tools = createFakeTools({ get: characterGet(10, 20) })
    // A full page then a short one: the loop must not stop after one call.
    let call = 0
    tools.deleteWhere.mockImplementation(async () => {
      call += 1
      return ok({ deleted: call === 1 ? 100 : 3 })
    })

    const result = await deleteCharacter(context(tools, { characterId: 'char-kaelen' }))

    expect(result).toEqual({
      success: true,
      data: { characterId: 'char-kaelen', deletedItems: 103 },
    })
    expect(tools.deleteWhere).toHaveBeenCalledTimes(2)
    expect(tools.deleteWhere).toHaveBeenNthCalledWith(
      1,
      'inventory',
      { characterId: 'char-kaelen' },
      100,
    )
    expect(tools.deleteWhere).toHaveBeenNthCalledWith(
      2,
      'inventory',
      { characterId: 'char-kaelen' },
      100,
    )
    expect(tools.remove).toHaveBeenCalledWith('characters', 'char-kaelen')
    // Items first, row second (ADR 0018): never an orphaned pack.
    expect(tools.deleteWhere.mock.invocationCallOrder[0]).toBeLessThan(
      tools.remove.mock.invocationCallOrder[0],
    )
  })

  it('stops after one short page and reports the count', async () => {
    const tools = createFakeTools({
      get: characterGet(10, 20),
      deleteWhere: ok({ deleted: 2 }),
    })

    const result = await deleteCharacter(context(tools, { characterId: 'char-kaelen' }))

    if (!result.success) throw new Error(`expected success, got ${result.code}`)
    expect(result.data.deletedItems).toBe(2)
    expect(tools.deleteWhere).toHaveBeenCalledTimes(1)
    expect(tools.remove).toHaveBeenCalledTimes(1)
  })

  it('reports write_failed at inventory and leaves the character in place', async () => {
    const tools = createFakeTools({
      get: characterGet(10, 20),
      deleteWhere: failed('write_refused', 'delete refused'),
    })

    const result = await deleteCharacter(context(tools, { characterId: 'char-kaelen' }))

    expect(result).toEqual({
      success: false,
      code: 'write_failed',
      error: 'delete refused',
      details: { stage: 'inventory', applied: [] },
    })
    expect(tools.remove).not.toHaveBeenCalled()
  })

  it('reports the drained inventory as applied when the row removal fails', async () => {
    const tools = createFakeTools({
      get: characterGet(10, 20),
      deleteWhere: ok({ deleted: 2 }),
      remove: failed('write_refused', 'delete refused'),
    })

    const result = await deleteCharacter(context(tools, { characterId: 'char-kaelen' }))

    expect(result).toEqual({
      success: false,
      code: 'write_failed',
      error: 'delete refused',
      details: { stage: 'character', applied: ['inventory'] },
    })
    expect(tools.deleteWhere).toHaveBeenCalledTimes(1)
  })
})


/**
 * The `campaigns` row a GM mutation reads, with the arc position and enemy the
 * test cares about spelled out. Every other collection answers not_found.
 */
function campaignGet(overrides: Record<string, unknown> = {}) {
  return (collection: string) =>
    collection === 'campaigns'
      ? ok({
          record: {
            recordId: DEFAULT_CAMPAIGN_ID,
            data: {
              sceneIndex: 0,
              enemyName: '',
              enemyHp: 0,
              enemyMaxHp: 0,
              ...overrides,
            },
          },
        })
      : failed('not_found', `${collection} not found`)
}

describe('applyGmMutation scene advance (ADR 0023)', () => {
  it('advances exactly one scene when the check exit is recorded', async () => {
    const tools = createFakeTools({
      get: campaignGet({ sceneIndex: 0 }),
      query: ok({
        records: [
          {
            recordId: 'roll-1',
            data: {
              campaignId: DEFAULT_CAMPAIGN_ID,
              entryType: 'roll',
              targetDc: 12,
              outcome: 'success',
            },
          },
        ],
        count: 1,
      }),
    })

    const result = await applyGmMutation(
      context(tools, { mutation: { kind: 'update_scene', scene: { sceneIndex: 1 } } }),
    )

    if (!result.success) throw new Error(`expected success, got ${result.code}`)
    expect(result.data).toMatchObject({
      kind: 'update_scene',
      scene: { sceneIndex: 1 },
      logged: true,
    })
    expect(tools.query).toHaveBeenCalledWith('roll-logs', {
      where: {
        campaignId: DEFAULT_CAMPAIGN_ID,
        entryType: 'roll',
        targetDc: 12,
      },
      limit: 500,
    })
    // The advance writes scene columns only: the pending check lives on each
    // character's row now, and no character in this fixture owes one (ADR 0030).
    expect(tools.update).toHaveBeenCalledWith('campaigns', DEFAULT_CAMPAIGN_ID, {
      ...sceneColumns(1),
    })
    const marker = tools.create.mock.calls.find((call) => call[0] === 'roll-logs')
    expect(marker?.[1]).toMatchObject({
      entryType: 'gm_event',
      summary: `The scene advances to ${progressLabel(1)} — The Rune-Ward`,
    })
  })

  it('clears the whole party’s pending checks on an accepted advance', async () => {
    const tools = createFakeTools({
      get: campaignGet({ sceneIndex: 0 }),
      query: ok({
        records: [
          {
            recordId: 'roll-1',
            data: {
              campaignId: DEFAULT_CAMPAIGN_ID,
              entryType: 'roll',
              targetDc: 12,
              outcome: 'success',
            },
          },
          {
            recordId: 'char-ash',
            data: { campaignId: DEFAULT_CAMPAIGN_ID, pendingStat: 'dex', pendingDc: 12 },
          },
          {
            recordId: 'char-borin',
            data: { campaignId: DEFAULT_CAMPAIGN_ID, pendingStat: 'wis', pendingDc: 9 },
          },
          // A sheet that owes nothing must not be written for nothing.
          { recordId: 'char-quiet', data: { campaignId: DEFAULT_CAMPAIGN_ID } },
        ],
        count: 4,
      }),
    })

    const result = await applyGmMutation(
      context(tools, { mutation: { kind: 'update_scene', scene: { sceneIndex: 1 } } }),
    )

    expect(result).toMatchObject({ success: true, data: { scene: { sceneIndex: 1 } } })
    // The requests belonged to the scene the table just closed (ADR 0030).
    expect(tools.update).toHaveBeenCalledWith('characters', 'char-ash', {
      pendingStat: '',
      pendingDc: 0,
    })
    expect(tools.update).toHaveBeenCalledWith('characters', 'char-borin', {
      pendingStat: '',
      pendingDc: 0,
    })
    expect(tools.update).not.toHaveBeenCalledWith('characters', 'char-quiet', expect.anything())
    // The campaign row carries no gate any more.
    expect(tools.update).toHaveBeenCalledWith('campaigns', DEFAULT_CAMPAIGN_ID, {
      ...sceneColumns(1),
    })
  })

  it('refuses the advance when a pending check cannot be cleared', async () => {
    // The checks belong to the scene being closed, so the clear runs before the
    // scene write: a failure leaves the table where it was rather than half moved.
    const tools = createFakeTools({
      get: campaignGet({ sceneIndex: 0 }),
      query: ok({
        records: [
          {
            recordId: 'roll-1',
            data: {
              campaignId: DEFAULT_CAMPAIGN_ID,
              entryType: 'roll',
              targetDc: 12,
              outcome: 'success',
            },
          },
          {
            recordId: 'char-ash',
            data: { campaignId: DEFAULT_CAMPAIGN_ID, pendingStat: 'dex', pendingDc: 12 },
          },
        ],
        count: 2,
      }),
      update: failed('write_refused', 'update refused'),
    })

    const result = await applyGmMutation(
      context(tools, { mutation: { kind: 'update_scene', scene: { sceneIndex: 1 } } }),
    )

    expect(result).toEqual({
      success: false,
      code: 'write_failed',
      error: 'update refused',
      details: { stage: 'pending_clear', applied: [] },
    })
    expect(tools.update).not.toHaveBeenCalledWith('campaigns', DEFAULT_CAMPAIGN_ID, expect.anything())
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('lets the model override the new scene columns without changing the position', async () => {
    const tools = createFakeTools({
      get: campaignGet({ sceneIndex: 0 }),
      query: ok({
        records: [
          {
            recordId: 'roll-1',
            data: {
              campaignId: DEFAULT_CAMPAIGN_ID,
              entryType: 'roll',
              targetDc: 12,
              outcome: 'critical_success',
            },
          },
        ],
        count: 1,
      }),
    })

    await applyGmMutation(
      context(tools, {
        mutation: {
          kind: 'update_scene',
          scene: { sceneIndex: 1, activeThreatDc: 16, sceneSummary: 'The ward burns.' },
        },
      }),
    )

    expect(tools.update).toHaveBeenCalledWith('campaigns', DEFAULT_CAMPAIGN_ID, {
      ...sceneColumns(1),
      activeThreatDc: 16,
      sceneSummary: 'The ward burns.',
    })
  })

  it('refuses the advance when the scene DC has no success recorded', async () => {
    const tools = createFakeTools({
      get: campaignGet({ sceneIndex: 0 }),
      query: ok({
        records: [
          {
            recordId: 'roll-1',
            data: {
              campaignId: DEFAULT_CAMPAIGN_ID,
              entryType: 'roll',
              targetDc: 12,
              outcome: 'failure',
            },
          },
        ],
        count: 1,
      }),
    })

    const result = await applyGmMutation(
      context(tools, { mutation: { kind: 'update_scene', scene: { sceneIndex: 1 } } }),
    )

    if (result.success) throw new Error('expected scene_not_complete, got success')
    expect(result.code).toBe('scene_not_complete')
    expect(result.error).toContain('DC 12')
    expect(tools.update).not.toHaveBeenCalled()
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('refuses a jump of more than one scene before reading rolls', async () => {
    const tools = createFakeTools({ get: campaignGet({ sceneIndex: 0 }) })

    const result = await applyGmMutation(
      context(tools, { mutation: { kind: 'update_scene', scene: { sceneIndex: 2 } } }),
    )

    if (result.success) throw new Error('expected invalid_scene, got success')
    expect(result.code).toBe('invalid_scene')
    expect(tools.query).not.toHaveBeenCalled()
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('refuses the advance while the fight is unfinished', async () => {
    const tools = createFakeTools({
      get: campaignGet({
        sceneIndex: 2,
        enemyName: 'Runebound Sentinel',
        enemyHp: 6,
        enemyMaxHp: 24,
      }),
    })

    const result = await applyGmMutation(
      context(tools, { mutation: { kind: 'update_scene', scene: { sceneIndex: 3 } } }),
    )

    if (result.success) throw new Error('expected scene_not_complete, got success')
    expect(result.code).toBe('scene_not_complete')
    expect(result.error).toContain('0 HP')
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('advances a defeat scene once the enemy is at 0 HP', async () => {
    const tools = createFakeTools({
      get: campaignGet({
        sceneIndex: 2,
        enemyName: 'Runebound Sentinel',
        enemyHp: 0,
        enemyMaxHp: 24,
      }),
    })

    const result = await applyGmMutation(
      context(tools, { mutation: { kind: 'update_scene', scene: { sceneIndex: 3 } } }),
    )

    if (!result.success) throw new Error(`expected success, got ${result.code}`)
    expect(tools.update).toHaveBeenCalledWith('campaigns', DEFAULT_CAMPAIGN_ID, {
      ...sceneColumns(3),
    })
  })

  it('keeps the in-scene write ungated when no sceneIndex arrives', async () => {
    const tools = createFakeTools({ get: campaignGet() })

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'update_scene', scene: { locationName: 'The Drowned Stair' } },
      }),
    )

    if (!result.success) throw new Error(`expected success, got ${result.code}`)
    expect(tools.get).not.toHaveBeenCalled()
    expect(tools.query).not.toHaveBeenCalled()
    expect(tools.update).toHaveBeenCalledWith('campaigns', DEFAULT_CAMPAIGN_ID, {
      locationName: 'The Drowned Stair',
    })
    if (result.data.kind !== 'update_scene') throw new Error('expected update_scene')
    expect(result.data.scene.sceneIndex).toBeUndefined()
  })
})

describe('applyGmMutation enemy damage (ADR 0024)', () => {
  it('clamps at 0, writes the HP and logs exactly one combat row', async () => {
    const tools = createFakeTools({
      get: campaignGet({
        enemyName: 'Runebound Sentinel',
        enemyHp: 4,
        enemyMaxHp: 24,
      }),
    })

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'enemy_damage', amount: 10, reason: 'The arrow finds the gap' },
      }),
    )

    expect(result).toMatchObject({
      success: true,
      data: {
        kind: 'enemy_damage',
        enemy: { name: 'Runebound Sentinel', before: 4, after: 0, maxHp: 24, applied: 4 },
        logged: true,
      },
    })
    expect(tools.update).toHaveBeenCalledWith('campaigns', DEFAULT_CAMPAIGN_ID, { enemyHp: 0 })
    const logs = tools.create.mock.calls.filter((call) => call[0] === 'roll-logs')
    expect(logs).toHaveLength(1)
    expect(logs[0][1]).toMatchObject({
      campaignId: DEFAULT_CAMPAIGN_ID,
      characterName: 'Runebound Sentinel',
      entryType: 'combat',
      summary: 'Runebound Sentinel takes 4 damage (0/24) — The arrow finds the gap',
    })
  })

  it('clamps above maxHp instead of trusting a stale enemyHp', async () => {
    const tools = createFakeTools({
      get: campaignGet({
        enemyName: 'Runebound Sentinel',
        enemyHp: 30,
        enemyMaxHp: 24,
      }),
    })

    const result = await applyGmMutation(
      context(tools, { mutation: { kind: 'enemy_damage', amount: 1 } }),
    )

    if (!result.success) throw new Error(`expected success, got ${result.code}`)
    expect(result.data).toMatchObject({
      kind: 'enemy_damage',
      enemy: { before: 30, after: 24, maxHp: 24, applied: 6 },
    })
    expect(tools.update).toHaveBeenCalledWith('campaigns', DEFAULT_CAMPAIGN_ID, { enemyHp: 24 })
  })

  it('refuses when the scene has no enemy', async () => {
    const tools = createFakeTools({
      get: campaignGet({ enemyName: '', enemyHp: 0, enemyMaxHp: 0 }),
    })

    const result = await applyGmMutation(
      context(tools, { mutation: { kind: 'enemy_damage', amount: 6 } }),
    )

    if (result.success) throw new Error('expected enemy_not_found, got success')
    expect(result.code).toBe('enemy_not_found')
    expect(tools.update).not.toHaveBeenCalled()
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('rejects an amount outside 1..50 before reading the campaign', async () => {
    const tools = createFakeTools({ get: campaignGet() })

    const result = await applyGmMutation(
      context(tools, { mutation: { kind: 'enemy_damage', amount: 0 } }),
    )

    if (result.success) throw new Error('expected invalid_params, got success')
    expect(result.code).toBe('invalid_params')
    expect(tools.get).not.toHaveBeenCalled()
  })
})

/**
 * One action, one number (`P5.19`): the GM records the check it is about to ask
 * for, and the campaign carries it until a roll answers it. A request is not an
 * outcome, so it writes no `roll-logs` row — the table learns of it from the
 * live campaign row, not from the feed.
 */
describe('applyGmMutation request_check (P5.19)', () => {
  it('writes the pending pair on the target character and no roll-logs row', async () => {
    const tools = createFakeTools({ get: characterGet(18, 24) })

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'request_check', characterId: 'char-kaelen', stat: 'dex', dc: 17 },
      }),
    )

    expect(result).toMatchObject({
      success: true,
      data: {
        kind: 'request_check',
        pending: { characterId: 'char-kaelen', characterName: 'Kaelen', stat: 'dex', dc: 17 },
        logged: false,
      },
    })
    expect(tools.update).toHaveBeenCalledTimes(1)
    expect(tools.update).toHaveBeenCalledWith('characters', 'char-kaelen', {
      pendingStat: 'dex',
      pendingDc: 17,
    })
    // A request for a roll is not a roll: no evidence row, and the campaign row
    // (which has no gate any more, ADR 0030) is not written.
    expect(tools.create).not.toHaveBeenCalled()
    expect(tools.update).not.toHaveBeenCalledWith('campaigns', expect.anything(), expect.anything())
  })

  it('refuses a character outside this campaign and writes nothing', async () => {
    const tools = createFakeTools({ get: characterGet(18, 24, 'other-campaign') })

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'request_check', characterId: 'char-kaelen', stat: 'wis', dc: 12 },
      }),
    )

    if (result.success) throw new Error('expected character_not_found, got success')
    expect(result.code).toBe('character_not_found')
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('refuses a character that cannot be read', async () => {
    const tools = createFakeTools()

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'request_check', characterId: 'char-missing', stat: 'int', dc: 10 },
      }),
    )

    if (result.success) throw new Error('expected character_not_found, got success')
    expect(result.code).toBe('character_not_found')
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('bounds the DC to 5..30 and the stat to the six abilities', async () => {
    for (const mutation of [
      { kind: 'request_check', characterId: 'char-kaelen', stat: 'dex', dc: 4 },
      { kind: 'request_check', characterId: 'char-kaelen', stat: 'dex', dc: 31 },
      { kind: 'request_check', characterId: 'char-kaelen', stat: 'dex', dc: 12.5 },
      { kind: 'request_check', characterId: 'char-kaelen', stat: 'luck', dc: 12 },
      { kind: 'request_check', characterId: '', stat: 'dex', dc: 12 },
    ]) {
      const tools = createFakeTools({ get: characterGet(18, 24) })

      const result = await applyGmMutation(context(tools, { mutation }))

      if (result.success) throw new Error(`expected invalid_params for ${JSON.stringify(mutation)}`)
      expect(result.code).toBe('invalid_params')
      expect(tools.get).not.toHaveBeenCalled()
      expect(tools.update).not.toHaveBeenCalled()
    }
  })

  it('reports write_failed when the campaign row cannot be updated', async () => {
    const tools = createFakeTools({
      get: characterGet(18, 24),
      update: failed('schema_validation_failed', 'pendingStat is not a valid option'),
    })

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'request_check', characterId: 'char-kaelen', stat: 'con', dc: 13 },
      }),
    )

    expect(result).toEqual({
      success: false,
      code: 'write_failed',
      error: 'pendingStat is not a valid option',
      details: { stage: 'request_check', applied: [] },
    })
    expect(tools.create).not.toHaveBeenCalled()
  })
})

/**
 * "Start New Campaign" is a new game at the same table (ADR 0025, 0026): the
 * scene, every pack and the roll log return to the start; characters keep their
 * identity and regain full HP. One `gm_event` row is written last, so a reset
 * cannot delete its own evidence.
 */
describe('startCampaign', () => {
  /** Two characters at one table: a wounded Vanguard and a downed Marksman. */
  const ROSTER = {
    records: [
      {
        recordId: 'char-ash',
        data: {
          userId: 'user-alice',
          campaignId: DEFAULT_CAMPAIGN_ID,
          name: 'Ash',
          archetype: 'Vanguard',
          hp: 3,
          maxHp: 24,
        },
      },
      {
        recordId: 'char-borin',
        data: {
          userId: 'user-bob',
          campaignId: DEFAULT_CAMPAIGN_ID,
          name: 'Borin',
          archetype: 'Marksman',
          hp: 0,
          maxHp: 19,
        },
      },
    ],
    count: 2,
  }

  it('refuses a caller with no character and deletes nothing', async () => {
    const tools = createFakeTools()

    const result = await startCampaign(context(tools))

    if (result.success) throw new Error('expected not_at_table, got success')
    expect(result.code).toBe('not_at_table')
    // Nothing is drained, written or healed for someone who is not at the table.
    expect(tools.deleteWhere).not.toHaveBeenCalled()
    expect(tools.create).not.toHaveBeenCalled()
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('fails closed when the membership read fails', async () => {
    const tools = createFakeTools({ query: failed('do_unavailable', 'record room unavailable') })

    const result = await startCampaign(context(tools))

    expect(result).toEqual({
      success: false,
      code: 'write_failed',
      error: 'record room unavailable',
      details: { stage: 'membership', applied: [] },
    })
    expect(tools.deleteWhere).not.toHaveBeenCalled()
  })

  it('clears packs and the log, heals, re-kits and writes its marker last', async () => {
    const tools = createFakeTools({ query: ok(ROSTER) })
    tools.deleteWhere.mockImplementation(async (collection: string) =>
      ok({ deleted: collection === 'inventory' ? 2 : collection === 'gm-messages' ? 3 : 5 }),
    )

    const result = await startCampaign(context(tools))

    expect(result).toEqual({
      success: true,
      data: {
        sceneIndex: 0,
        progress: 'Act I · Scene 1 of 5',
        clearedRolls: 5,
        clearedMessages: 3,
        clearedItems: 2,
        healedCharacters: 2,
        grantedItems: 4,
        itemsMissing: [],
        logged: true,
      },
    })

    // Both collections are drained before anything is written (ADR 0026).
    expect(tools.deleteWhere).toHaveBeenNthCalledWith(
      1,
      'inventory',
      { campaignId: DEFAULT_CAMPAIGN_ID },
      100,
    )
    expect(tools.deleteWhere).toHaveBeenNthCalledWith(
      2,
      'roll-logs',
      { campaignId: DEFAULT_CAMPAIGN_ID },
      100,
    )
    // A new game is a new conversation (ADR 0027): the GM thread goes too.
    expect(tools.deleteWhere).toHaveBeenNthCalledWith(
      3,
      'gm-messages',
      { campaignId: DEFAULT_CAMPAIGN_ID },
      100,
    )

    // The scene is scene 0 of the arc, under the campaign's existing title: the
    // campaign row carries no pending check any more (ADR 0030).
    expect(tools.create.mock.calls[0]).toEqual([
      'campaigns',
      { title: DEFAULT_CAMPAIGN_SEED.title, ...sceneColumns(0), roundNumber: 1 },
      DEFAULT_CAMPAIGN_ID,
    ])

    // HP comes from each row's own maxHp, never from the caller, and the same
    // write clears that character's pending check (ADR 0030).
    expect(tools.update).toHaveBeenNthCalledWith(1, 'characters', 'char-ash', {
      hp: 24,
      pendingStat: '',
      pendingDc: 0,
      actedRound: 0,
    })
    expect(tools.update).toHaveBeenNthCalledWith(2, 'characters', 'char-borin', {
      hp: 19,
      pendingStat: '',
      pendingDc: 0,
      actedRound: 0,
    })

    // Starter kits are the Forge rows, owned by each character's owner.
    const itemWrites = tools.create.mock.calls.filter((call) => call[0] === 'inventory')
    expect(itemWrites).toHaveLength(4)
    expect(itemWrites[0][1]).toMatchObject({
      userId: 'user-alice',
      characterId: 'char-ash',
      campaignId: DEFAULT_CAMPAIGN_ID,
      itemName: ARCHETYPE_PRESETS.Vanguard.starterItems[0].itemName,
      quantity: 1,
    })
    expect(itemWrites[2][1]).toMatchObject({
      userId: 'user-bob',
      characterId: 'char-borin',
      itemName: ARCHETYPE_PRESETS.Marksman.starterItems[0].itemName,
    })

    // Exactly one marker row, and it is the last write of the reset.
    const logWrites = tools.create.mock.calls.filter((call) => call[0] === 'roll-logs')
    expect(logWrites).toHaveLength(1)
    expect(logWrites[0][1]).toEqual({
      campaignId: DEFAULT_CAMPAIGN_ID,
      characterName: 'Game Master',
      entryType: 'gm_event',
      outcome: 'info',
      summary: 'A new game begins — Act I, Scene 1',
    })
    expect(tools.create.mock.calls.at(-1)?.[0]).toBe('roll-logs')
    const lastDrain = Math.max(...tools.deleteWhere.mock.invocationCallOrder)
    const markerOrder = tools.create.mock.invocationCallOrder.at(-1) ?? 0
    expect(lastDrain).toBeLessThan(markerOrder)
  })

  it('keeps the existing campaign title on the reset row', async () => {
    const tools = createFakeTools({
      query: ok({
        records: [
          { recordId: DEFAULT_CAMPAIGN_ID, data: { title: 'The Table of Ash' } },
          ...ROSTER.records,
        ],
        count: 3,
      }),
    })

    await startCampaign(context(tools))

    expect(tools.create.mock.calls[0][1]).toMatchObject({ title: 'The Table of Ash' })
  })

  it('clears every character’s pending check on the reset', async () => {
    // A reset is a new game: the previous run's requests must not survive it and
    // leave a sheet with one live stat (P5.19, ADR 0030). It travels in the same
    // write that restores HP, so no character row is touched twice.
    const tools = createFakeTools({ query: ok(ROSTER) })

    await startCampaign(context(tools))

    expect(tools.update).toHaveBeenCalledTimes(2)
    for (const recordId of ['char-ash', 'char-borin']) {
      expect(tools.update).toHaveBeenCalledWith('characters', recordId, {
        hp: recordId === 'char-ash' ? 24 : 19,
        pendingStat: '',
        pendingDc: 0,
        // A new game is round one, and nobody has acted in it yet (ADR 0031).
        actedRound: 0,
      })
    }
    // The campaign row does not carry the gate any more.
    expect(tools.create.mock.calls[0][1]).not.toHaveProperty('pendingStat')
  })

  it('stops at a failed drain and reports the stages that landed', async () => {
    const tools = createFakeTools({
      query: ok(ROSTER),
      deleteWhere: failed('write_refused', 'delete refused'),
    })

    const result = await startCampaign(context(tools))

    expect(result).toEqual({
      success: false,
      code: 'write_failed',
      error: 'delete refused',
      details: { stage: 'inventory', applied: [] },
    })
    expect(tools.create).not.toHaveBeenCalled()
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('names characters it could not kit instead of inventing a preset', async () => {
    const tools = createFakeTools({
      query: ok({
        records: [
          {
            recordId: 'char-odd',
            data: {
              userId: 'user-alice',
              campaignId: DEFAULT_CAMPAIGN_ID,
              name: 'Ash',
              archetype: 'Bard',
              hp: 3,
              maxHp: 24,
            },
          },
        ],
        count: 1,
      }),
    })

    const result = await startCampaign(context(tools))

    if (!result.success) throw new Error(`expected success, got ${result.code}`)
    expect(result.data.grantedItems).toBe(0)
    expect(result.data.healedCharacters).toBe(1)
    expect(result.data.itemsMissing).toEqual(['Ash: unknown archetype "Bard"'])
    // The reset still ends with its marker: the table is at Act I either way.
    expect(tools.create.mock.calls.at(-1)?.[0]).toBe('roll-logs')
  })
})
