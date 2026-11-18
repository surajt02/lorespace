import { describe, expect, it, vi } from 'vitest'
import type { ActionTools, ActionResult } from 'deepspace/worker'
import type { Env } from '../../../worker'
import { DEFAULT_CAMPAIGN_ID } from '../../constants'
import { DEFAULT_CAMPAIGN_SEED } from '../../lib/campaign-seed'
import { PREVIEW_CAMPAIGN } from '../../lib/preview-data'
import { applyGmMutation, ensureDefaultCampaign } from '../index'

/**
 * The gate on the actions' own authorization.
 *
 * Both actions run with per-record RBAC off (`ctx.tools` carry `X-App-Action`),
 * so the record room enforces nothing: these tests are what proves
 * `applyGmMutation` refuses a caller with no seat and that the seed writes the
 * same values the signed-out fixture renders. A fake `ActionTools` records the
 * calls, so "no write happened" is asserted, not assumed.
 */

function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

function failed(code: string, error: string): ActionResult<never> {
  return { success: false, code, error }
}

interface FakeToolsOptions {
  query?: ActionResult<unknown>
  get?: ActionResult<unknown>
  create?: ActionResult<unknown>
  update?: ActionResult<unknown>
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
    remove: vi.fn().mockResolvedValue(ok({ recordId: 'removed-record' })),
    deleteWhere: vi.fn().mockResolvedValue(ok({ deleted: 0 })),
    get: vi.fn().mockResolvedValue(options.get ?? failed('not_found', 'Character not found')),
    // Applies `where.recordId` to the canned rows, because the seed's existence
    // check depends on it: a row with another id must not answer for the seeded
    // one. Any other `where` (the membership read) passes the rows through.
    query: vi.fn().mockImplementation(async (_collection: string, query?: { where?: Record<string, unknown> }) => {
      const base = options.query ?? ok({ records: [], count: 0 })
      if (!base.success) return base
      const recordId = query?.where?.recordId
      if (typeof recordId !== 'string') return base
      const rows = (base.data as { records: { recordId: string }[] }).records.filter(
        (record) => record.recordId === recordId,
      )
      return ok({ records: rows, count: rows.length })
    }),
    integration: vi.fn(),
    registerUser: vi.fn(),
  }
}

type FakeTools = ReturnType<typeof createFakeTools>

function context(tools: FakeTools, params: Record<string, unknown> = {}) {
  return {
    userId: 'user-alice',
    params,
    tools: tools as unknown as ActionTools,
    env: {} as Env,
    callerJwt: '',
  }
}

/** The membership read: `user-alice` has one character at the table. */
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
function characterGet(hp: number, maxHp: number, campaignId = DEFAULT_CAMPAIGN_ID) {
  return ok({
    record: {
      recordId: 'char-kaelen',
      data: { userId: 'user-alice', campaignId, hp, maxHp },
    },
  })
}

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
  it('refuses a caller with no character in the campaign before any target read or write', async () => {
    const tools = createFakeTools({ get: characterGet(10, 20) })

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'character_hp', characterId: 'char-kaelen', delta: -3 },
      }),
    )

    expect(result).toEqual({
      success: false,
      code: 'no_character',
      error: expect.any(String),
    })
    expect(tools.query).toHaveBeenCalledWith('characters', {
      where: { userId: 'user-alice', campaignId: DEFAULT_CAMPAIGN_ID },
      limit: 1,
    })
    expect(tools.get).not.toHaveBeenCalled()
    expect(tools.update).not.toHaveBeenCalled()
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('fails closed when the membership check itself fails', async () => {
    const tools = createFakeTools({ query: failed('do_unavailable', 'record room unavailable') })

    const result = await applyGmMutation(
      context(tools, {
        mutation: { kind: 'character_hp', characterId: 'char-kaelen', delta: -3 },
      }),
    )

    expect(result).toEqual({
      success: false,
      code: 'no_character',
      error: 'record room unavailable',
      details: { stage: 'membership' },
    })
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('clamps character_hp at 0 and reports the applied delta', async () => {
    const tools = createFakeTools({ query: ok(MEMBER_QUERY), get: characterGet(4, 20) })

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
      },
    })
    expect(tools.update).toHaveBeenCalledWith('characters', 'char-kaelen', { hp: 0 })
    // The target is read by the caller's own recordId, never by index.
    expect(tools.get).toHaveBeenCalledWith('characters', 'char-kaelen')
    // `characters.userId` is userBound + immutable: never in an update.
    expect(tools.update.mock.calls[0][2]).not.toHaveProperty('userId')
  })

  it('clamps character_hp at maxHp and reports the applied delta', async () => {
    const tools = createFakeTools({ query: ok(MEMBER_QUERY), get: characterGet(18, 20) })

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
      },
    })
    expect(tools.update).toHaveBeenCalledWith('characters', 'char-kaelen', { hp: 20 })
  })

  it('refuses a target character in another campaign', async () => {
    const tools = createFakeTools({
      query: ok(MEMBER_QUERY),
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
      query: ok(MEMBER_QUERY),
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
      },
    })
  })

  it('writes only whitelisted scene columns and ignores title and unknown keys', async () => {
    const tools = createFakeTools({ query: ok(MEMBER_QUERY) })

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
      data: { kind: 'update_scene', scene: { applied: ['locationName', 'atmosphereTag'] } },
    })
  })

  it('reports write_failed with the stage and what landed when the only write fails', async () => {
    // `write_failed` carries an ordered best-effort report because there are no
    // transactions. Every kind currently writes one record, so a failure here
    // means nothing landed; the `applied` field stays on the wire for a future
    // multi-write mutation.
    const tools = createFakeTools({
      query: ok(MEMBER_QUERY),
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
})
