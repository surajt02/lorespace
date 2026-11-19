import { describe, expect, it, vi } from 'vitest'
import type { ActionTools, ActionResult } from 'deepspace/worker'
import type { Env } from '../../../worker'
import { DEFAULT_CAMPAIGN_ID } from '../../constants'
import { DEFAULT_CAMPAIGN_SEED } from '../../lib/campaign-seed'
import { ARCHETYPE_PRESETS, CONSUMABLE_EFFECTS, calculateArmorClass } from '../../lib/d20'
import { PREVIEW_CAMPAIGN } from '../../lib/preview-data'
import {
  actions,
  applyGmMutation,
  deleteCharacter,
  ensureDefaultCampaign,
  forgeCharacter,
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
      data: { userId, campaignId, hp, maxHp },
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
  // second roll path would have to be added here on purpose.
  it('registers exactly the six server actions', () => {
    expect(Object.keys(actions).sort()).toEqual([
      'applyGmMutation',
      'deleteCharacter',
      'ensureDefaultCampaign',
      'forgeCharacter',
      'rollSkillCheck',
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
      data: { kind: 'update_scene', scene: { applied: ['locationName', 'atmosphereTag'] } },
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
    // All 13 `characters` columns, and nothing the caller supplied for hp/ac.
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
