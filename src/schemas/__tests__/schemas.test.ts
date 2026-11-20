import { describe, expect, it } from 'vitest'
import { lintSchema, lintSchemas } from 'deepspace/worker'
import { schemas } from '../../schemas'
import { DEFAULT_CAMPAIGN_ID, DEFAULT_CAMPAIGN_PRESENCE_SCOPE } from '../../constants'

/**
 * The schema lint gate. `lintSchema` is warn-only — it returns problems and
 * logs them, it never throws — so without this test a mis-declared column
 * (an `ownerField` that is not `userBound` on a collection a client may create
 * in, a `userBound` column that is not text, a `visibilityField` out of step
 * with `read: true`) would ship silently and surface as confusing RBAC
 * behaviour at runtime. `lintSchemas` adds the set-level rules, which
 * `lintSchema` cannot see.
 *
 * Runs in Node in well under a second (`npm run test:unit`).
 */
describe('registered collection schemas', () => {
  for (const schema of schemas) {
    it(`\`${schema.name}\` has no schema lint findings`, () => {
      expect(lintSchema(schema)).toEqual([])
    })
  }

  it('the whole set has no lint findings (set-level rules)', () => {
    expect(lintSchemas(schemas)).toEqual([])
  })

  /**
   * Pins registration itself, not just the schemas: a duplicated entry or a
   * messaging drop-in creeping into `schemas` fails here rather than widening
   * every `records.*` query and AI/MCP tool by accident (`D2`). The two
   * `ai-chat` collections are here deliberately (`P5.1`) — registering them is
   * what turns `/api/ai/chat` on.
   */
  it('registers exactly the nine collections, with no messaging drop-ins', () => {
    expect(schemas.map((schema) => schema.name).sort()).toEqual([
      'ai-chats',
      'ai-messages',
      'campaigns',
      'characters',
      'gm-messages',
      'inventory',
      'roll-logs',
      'settings',
      'users',
    ])
  })
})

/**
 * The id Phase 2 seeds and Phase 3/4 filter on, and the presence room Phase 4
 * joins. Changing the literal here is a data migration; this test is the
 * reminder that it is not a rename.
 */
describe('default campaign constants', () => {
  it('names the shared campaign record', () => {
    expect(DEFAULT_CAMPAIGN_ID).toBe('default-campaign')
  })

  it('derives the presence scope from the campaign id', () => {
    expect(DEFAULT_CAMPAIGN_PRESENCE_SCOPE).toBe('campaign:default-campaign')
  })
})

/**
 * Column-level pins for the fields later phases write by name: Phase 3 filters
 * characters on `campaignId`, Phase 4 writes `rolledAt`/`summary` roll rows and
 * broadcasts into the presence scope, Phase 5's GM tools read the same column
 * names. Lint cannot see a rename or a changed default, so these assertions —
 * not `lintSchema` — are what make § Contracts in the phase plan enforceable.
 * The write side (who may create, update or delete a row) is pinned by
 * ADR 0015/0016 in its own `describe` below.
 */
describe('data-model contracts later phases depend on', () => {
  const schemaNamed = (name: string) => {
    const schema = schemas.find((candidate) => candidate.name === name)
    if (!schema) throw new Error(`collection '${name}' is not registered`)
    return schema
  }

  it('keeps the campaign scene at twelve columns, with the arc position a number', () => {
    const campaigns = schemaNamed('campaigns')
    const sceneIndex = campaigns.columns.find((column) => column.name === 'sceneIndex')

    expect(campaigns.columns).toHaveLength(12)
    expect(sceneIndex?.storage).toBe('number')
    expect(sceneIndex?.default).toBe(0)
    expect(sceneIndex?.required).toBeUndefined()
  })

  /**
   * The pending check (`P5.19`): three additive columns on the campaign, and the
   * "nothing pending" defaults a roll, an advance and a reset return them to.
   * `pendingStat` selects over the real six abilities — `wis`, never the
   * `wy` typo — because `rollSkillCheck` refuses anything not in this list.
   */
  it('keeps the pending check on the campaign, defaulting to nothing pending', () => {
    const campaigns = schemaNamed('campaigns')
    const column = (name: string) => campaigns.columns.find((entry) => entry.name === name)

    expect(column('pendingCharacterId')?.storage).toBe('text')
    expect(column('pendingCharacterId')?.default).toBe('')
    expect(column('pendingStat')?.interpretation).toEqual({
      kind: 'select',
      options: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
    })
    expect(column('pendingStat')?.default).toBe('')
    expect(column('pendingDc')?.storage).toBe('number')
    expect(column('pendingDc')?.default).toBe(0)
    // Additive: none of the three is required, so an existing row still reads.
    for (const name of ['pendingCharacterId', 'pendingStat', 'pendingDc']) {
      expect(column(name)?.required).toBeUndefined()
    }
  })

  /**
   * The shared GM thread must be readable by the signed-out window (ADR 0014)
   * and writable by nobody but the Worker: every client role loses create,
   * update and delete, so a message in the thread is a message the model got.
   */
  it('makes the GM thread readable by everyone and writable only by the server', () => {
    const gmMessages = schemaNamed('gm-messages')
    const column = (name: string) => gmMessages.columns.find((entry) => entry.name === name)

    expect(gmMessages.columns).toHaveLength(5)
    expect(column('campaignId')?.required).toBe(true)
    expect(column('role')?.interpretation).toEqual({
      kind: 'select',
      options: ['user', 'assistant'],
    })
    expect(column('characterName')?.default).toBe('')
    expect(column('content')?.required).toBe(true)
    expect(column('parts')?.interpretation).toEqual({ kind: 'json' })
    expect(gmMessages.ownerField).toBeUndefined()

    expect(gmMessages.permissions.viewer).toEqual({
      read: true,
      create: false,
      update: false,
      delete: false,
    })
    expect(gmMessages.permissions.member).toEqual({
      read: true,
      create: false,
      update: false,
      delete: false,
    })
    expect(gmMessages.permissions['*']?.read).toBe(true)
    expect(gmMessages.permissions.admin).toEqual({
      read: true,
      create: true,
      update: true,
      delete: true,
    })
  })

  it('keeps one character row per user per campaign, owned via userId', () => {
    const characters = schemaNamed('characters')
    const userId = characters.columns.find((column) => column.name === 'userId')

    expect(characters.columns).toHaveLength(13)
    expect(characters.ownerField).toBe('userId')
    expect(characters.uniqueOn).toEqual(['userId', 'campaignId'])
    expect(userId?.userBound).toBe(true)
    expect(userId?.immutable).toBe(true)
  })

  it('keeps inventory at seven columns, owned by userId and named by character', () => {
    const inventory = schemaNamed('inventory')
    const userId = inventory.columns.find((column) => column.name === 'userId')
    const characterId = inventory.columns.find((column) => column.name === 'characterId')

    expect(inventory.columns).toHaveLength(7)
    expect(inventory.ownerField).toBe('userId')
    expect(userId?.required).toBe(true)
    expect(userId?.immutable).toBe(true)
    expect(characterId?.interpretation).toEqual({
      kind: 'reference',
      targetTable: 'characters',
      displayColumn: 'name',
    })
  })

  it('narrows inventory categories to the four that have a meaning', () => {
    const category = schemaNamed('inventory').columns.find((column) => column.name === 'category')

    expect(category?.interpretation).toEqual({
      kind: 'select',
      options: ['weapon', 'armor', 'consumable', 'quest'],
    })
    expect(category?.default).toBe('quest')
  })

  it('replaces the Cleric archetype with the ranged Marksman', () => {
    const archetype = schemaNamed('characters').columns.find((column) => column.name === 'archetype')

    expect(archetype?.interpretation).toEqual({
      kind: 'select',
      options: ['Vanguard', 'Shadowblade', 'Arcanist', 'Marksman'],
    })
  })

  it('declares the six ability keys as the statName select (P4.15)', () => {
    const statName = schemaNamed('roll-logs').columns.find((column) => column.name === 'statName')

    // The action writes the lower-case key and the GM will read this column; a
    // free-text field would let a roll log claim a stat the rules do not have.
    expect(statName?.interpretation).toEqual({
      kind: 'select',
      options: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
    })
    expect(statName?.default).toBe('')
  })

  it('stamps rolledAt from summary and defines no createdAt column', () => {
    const rollLogs = schemaNamed('roll-logs')
    const rolledAt = rollLogs.columns.find((column) => column.name === 'rolledAt')

    expect(rollLogs.columns).toHaveLength(12)
    expect(rolledAt?.storage).toBe('number')
    expect(rolledAt?.timestampTrigger).toEqual({ field: 'summary' })
    expect(rollLogs.columns.some((column) => column.name === 'createdAt')).toBe(false)
  })
})

/**
 * The write side of the two collections Phase 3 made live, pinned because the
 * browser must not be able to author character state (ADR 0015). `characters`
 * is read-only to members — Forge and HP are actions — and `inventory` writes
 * are scoped to the row's owner, so `Use` and `Discard` cannot reach another
 * player's pack.
 */
describe('character and inventory write permissions (ADR 0015/0016)', () => {
  const schemaNamed = (name: string) => {
    const schema = schemas.find((candidate) => candidate.name === name)
    if (!schema) throw new Error(`collection '${name}' is not registered`)
    return schema
  }

  it('makes character rows read-only for members', () => {
    expect(schemaNamed('characters').permissions.member).toEqual({
      read: true,
      create: false,
      update: false,
      delete: false,
    })
  })

  // ADR 0005 turned the roll into the server's: members may read history but
  // never author it, or a forged total reaches the GM. Pinned the same way as
  // `characters` above, because the action credential skips per-record RBAC and
  // nothing else would notice the flip back (`P4.12`).
  it('makes roll history read-only for members', () => {
    expect(schemaNamed('roll-logs').permissions.member).toEqual({
      read: true,
      create: false,
      update: false,
      delete: false,
    })
  })

  it('allows members to discard only their own items, never to edit them', () => {
    // `update` is deliberately off: effects are keyed by item name, so a
    // rename would mint charges (ADR 0015/0016). Discard needs `delete: 'own'`.
    expect(schemaNamed('inventory').permissions.member).toEqual({
      read: true,
      create: false,
      update: false,
      delete: 'own',
    })
  })
})
