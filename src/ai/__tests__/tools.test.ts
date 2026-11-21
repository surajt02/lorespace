import { describe, expect, it, vi } from 'vitest'
import type { ToolSet } from 'ai'
import type { AgentToolContext } from 'deepspace/worker'
import { buildSystemPrompt, buildTools } from '../tools'
import { DEFAULT_CAMPAIGN_ID } from '../../constants'
import type { Env } from '../../../worker.js'

/**
 * The AI surface's tool set and prompt — `P5.2`, `P5.3`, `P5.5`, `P5.11`,
 * `P5.12`).
 *
 * Every tool `buildTools` returns is also auto-exposed over `/_deepspace/agent/*`
 * and MCP, so this file pins three boundaries:
 *
 * - the allowlist (`P5.4`): no delete tool, ever;
 * - the chat-turn gate (ADR 0022): a write tool refuses anywhere but the
 *   shared table thread (`POST /api/gm/chat`), without touching the record room;
 * - the snapshot's projection: named columns only, far under the 30 KB tool cap.
 *
 * It also pins the GM brief's load-bearing sentences, because the prompt is
 * product behaviour rendered to players.
 */

/** The seven built-ins the GM may use — record/schema/user reads and writes. */
const ALLOWED_KEYS = [
  'records_create',
  'records_get',
  'records_query',
  'records_update',
  'schema_describe',
  'schema_list',
  'user_current',
]

/** The six GM tools `P5.3`/`P5.18`/`P5.19` add. */
const GM_KEYS = [
  'get_campaign_snapshot',
  'modify_character_hp',
  'grant_character_loot',
  'update_campaign_scene',
  'damage_enemy',
  'request_check',
]

const OWNER_USER_ID = 'owner-user'
const CHAT_URL = 'https://app.test/api/gm/chat'
const AGENT_URL = 'https://app.test/_deepspace/agent/tools'
/** The SDK's per-player chat (`/assistant`), which is no longer a GM turn. */
const ASSISTANT_URL = 'https://app.test/api/ai/chat'

function fakeExecutor() {
  return vi.fn().mockResolvedValue({ success: true })
}

interface RecordCall {
  tool: string
  params: Record<string, unknown>
  headers: Headers
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * A RecordRoom stub whose `fetch` answers the tools `applyGmMutation` uses:
 * one character read, one characters/campaigns update, one roll-logs create.
 */
function fakeRecordRoom() {
  const calls: RecordCall[] = []
  const stub = {
    fetch: async (request: Request): Promise<Response> => {
      const body = (await request.json()) as { tool: string; params: Record<string, unknown> }
      calls.push({ tool: body.tool, params: body.params, headers: request.headers })
      switch (body.tool) {
        case 'records.get':
          // The GM's writes read either a character (HP) or the campaign row
          // (enemy damage, scene advance), so the stub answers by collection.
          if (body.params.collection === 'campaigns') {
            return jsonResponse({
              success: true,
              data: {
                record: {
                  recordId: DEFAULT_CAMPAIGN_ID,
                  data: {
                    title: 'Chronicles of the Obsidian Vault',
                    sceneIndex: 2,
                    locationName: 'The Sunken Reliquary',
                    atmosphereTag: 'combat',
                    sceneSummary: 'The Sentinel wakes.',
                    activeThreatDc: 13,
                    enemyName: 'Runebound Sentinel',
                    enemyHp: 24,
                    enemyMaxHp: 24,
                  },
                },
              },
            })
          }
          return jsonResponse({
            success: true,
            data: {
              record: {
                recordId: 'char-1',
                data: {
                  userId: 'alice',
                  campaignId: DEFAULT_CAMPAIGN_ID,
                  name: 'Kaelen',
                  hp: 18,
                  maxHp: 24,
                },
              },
            },
          })
        case 'records.update':
          return jsonResponse({ success: true, data: { recordId: 'char-1' } })
        case 'records.create':
          return jsonResponse({ success: true, data: { recordId: 'created-1' } })
        default:
          return jsonResponse({ success: false, error: `unexpected tool ${body.tool}` })
      }
    },
  }
  return { stub, calls }
}

function fakeContext(url: string) {
  const room = fakeRecordRoom()
  const get = vi.fn(() => room.stub)
  const idFromName = vi.fn((name: string) => name)
  const env = {
    APP_NAME: 'lorespace',
    DEEPSPACE_APP_ID: 'app-test',
    OWNER_USER_ID,
    APP_OWNER_JWT: 'owner-jwt',
    RECORD_ROOMS: { idFromName, get },
  } as unknown as Env
  const context: AgentToolContext<Env> = {
    env,
    userId: 'alice',
    request: new Request(url, { method: 'POST' }),
  }
  return { context, calls: room.calls, roomGet: get }
}

/**
 * Calls a tool the way the AI SDK does. The SDK's `execute` options carry a
 * tool call id and the originating messages; nothing here reads them.
 */
async function run(
  tools: ToolSet,
  name: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const built = tools[name]
  if (!built?.execute) throw new Error(`tool ${name} has no execute`)
  return built.execute(params, {
    toolCallId: `call-${name}`,
    messages: [],
    context: {},
  })
}

describe('buildTools', () => {
  it('builds the seven allowed built-ins plus the six GM tools', () => {
    const { context } = fakeContext(CHAT_URL)
    const tools = buildTools(fakeExecutor(), context)

    expect(Object.keys(tools).sort()).toEqual([...ALLOWED_KEYS, ...GM_KEYS].sort())
    expect(Object.keys(tools)).toHaveLength(13)
  })

  it('never exposes a delete tool', () => {
    const { context } = fakeContext(CHAT_URL)
    const tools = buildTools(fakeExecutor(), context)

    // The old list carried `records.delete`, which mapped to `records_delete`.
    // No key may name it — however it would be spelled.
    expect(Object.keys(tools).filter((key) => key.includes('delete'))).toEqual([])
    expect(tools).not.toHaveProperty('records_delete')
  })

  it('forwards the built-in tool name and the assistant defaults to the executor', async () => {
    const executor = fakeExecutor()
    const { context } = fakeContext(CHAT_URL)
    const tools = buildTools(executor, context)

    await run(tools, 'records_query', { collection: 'characters' })

    // The underscored key is the model-facing name; the executor takes the
    // SDK's dotted name. `applyAiToolDefaults` supplies the page limit in the
    // AI layer only, which is the one thing this wrapper adds.
    expect(executor).toHaveBeenCalledTimes(1)
    expect(executor).toHaveBeenCalledWith('records.query', {
      collection: 'characters',
      limit: 50,
    })
  })
})

describe('get_campaign_snapshot', () => {
  const campaignRow = {
    recordId: DEFAULT_CAMPAIGN_ID,
    data: {
      title: 'The Ashen Threshold',
      locationName: 'The Ashen Threshold',
      atmosphereTag: 'exploration',
      sceneSummary: 'Ash falls on a broken gate.',
      activeThreatDc: 12,
      enemyName: 'Gloom Wisp',
      enemyHp: 9,
      enemyMaxHp: 12,
      // The round (ADR 0031): the first adventurer has acted in it, the others
      // have not — which is what "who is still waiting" is read from.
      roundNumber: 3,
      createdBy: 'owner-user',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  }

  function characterRow(index: number) {
    return {
      recordId: `char-${index}`,
      data: {
        userId: `player-${index}`,
        campaignId: DEFAULT_CAMPAIGN_ID,
        name: `Adventurer ${index}`,
        archetype: 'Vanguard',
        hp: 18,
        maxHp: 24,
        ac: 15,
        str: 14,
        dex: 12,
        con: 13,
        int: 10,
        wis: 11,
        cha: 9,
        // Only the first adventurer owes a check: the snapshot must show each
        // character's own pending pair, not one campaign-wide slot (ADR 0030).
        pendingStat: index === 0 ? 'wis' : '',
        pendingDc: index === 0 ? 13 : 0,
        actedRound: index === 0 ? 3 : 2,
        createdBy: `player-${index}`,
      },
    }
  }

  function rollRow(index: number) {
    return {
      recordId: `roll-${index}`,
      data: {
        userId: `player-${index}`,
        campaignId: DEFAULT_CAMPAIGN_ID,
        characterName: `Adventurer ${index}`,
        entryType: 'roll',
        statName: 'dex',
        rawRoll: 14,
        modifier: 1,
        total: 15,
        targetDc: 14,
        outcome: 'success',
        summary: 'Adventurer 1 rolls DEX: 14 + 1 = 15 vs DC 14 — success',
        rolledAt: 1_760_000_000_000 + index,
      },
    }
  }

  function snapshotExecutor() {
    return vi.fn(async (_tool: string, params: Record<string, unknown>) => {
      switch (params.collection) {
        case 'campaigns':
          return { success: true, data: { records: [campaignRow] } }
        case 'characters':
          return {
            success: true,
            data: { records: [0, 1, 2, 3].map(characterRow) },
          }
        case 'roll-logs':
          return {
            success: true,
            data: { records: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(rollRow) },
          }
        default:
          return { success: false, error: `unexpected collection ${String(params.collection)}` }
      }
    })
  }

  it('returns only the projected columns and stays under the 30 KB tool cap', async () => {
    const executor = snapshotExecutor()
    const { context } = fakeContext(CHAT_URL)
    const tools = buildTools(executor, context)

    const result = (await run(tools, 'get_campaign_snapshot', {})) as {
      success: boolean
      campaign: Record<string, unknown>
      characters: Array<Record<string, unknown>>
      recentRolls: Array<Record<string, unknown>>
    }

    expect(result.success).toBe(true)
    // Projection, not a row copy: no tenant columns, no bookkeeping columns.
    expect(Object.keys(result.campaign).sort()).toEqual(
      [
        'recordId',
        'title',
        'locationName',
        'atmosphereTag',
        'sceneSummary',
        'activeThreatDc',
        'enemyName',
        'enemyHp',
        'enemyMaxHp',
        'roundNumber',
      ].sort(),
    )
    expect(Object.keys(result.characters[0]).sort()).toEqual(
      [
        'recordId',
        'name',
        'archetype',
        'hp',
        'maxHp',
        'ac',
        'str',
        'dex',
        'con',
        'int',
        'wis',
        'cha',
        'pendingStat',
        'pendingDc',
        'actedRound',
      ].sort(),
    )
    // The owed check is visible per character, which is what stops the GM
    // re-arming one that is already live (P5.31).
    expect(result.characters[0]).toMatchObject({ pendingStat: 'wis', pendingDc: 13 })
    expect(result.characters[1]).toMatchObject({ pendingStat: '', pendingDc: 0 })
    // The round and who has acted in it (ADR 0031). The GM compares the two
    // numbers itself, which is why no derived "waiting" field is projected.
    expect(result.campaign).toMatchObject({ roundNumber: 3 })
    expect(result.characters[0]).toMatchObject({ actedRound: 3 })
    expect(result.characters[1]).toMatchObject({ actedRound: 2 })
    expect(Object.keys(result.recentRolls[0]).sort()).toEqual(
      [
        'recordId',
        'entryType',
        'characterName',
        'statName',
        'rawRoll',
        'modifier',
        'total',
        'targetDc',
        'outcome',
        'summary',
        'rolledAt',
      ].sort(),
    )
    expect(result.characters).toHaveLength(4)
    expect(result.recentRolls).toHaveLength(10)
    expect(JSON.stringify(result)).not.toContain('createdBy')
    expect(JSON.stringify(result)).not.toContain('campaignId')
    expect(JSON.stringify(result).length).toBeLessThan(30000)
  })

  it('filters characters and rolls by the one campaign and reads 10 rolls', async () => {
    const executor = snapshotExecutor()
    const { context } = fakeContext(CHAT_URL)
    const tools = buildTools(executor, context)

    await run(tools, 'get_campaign_snapshot', {})

    expect(executor).toHaveBeenCalledWith('records.query', {
      collection: 'campaigns',
      limit: 1,
    })
    expect(executor).toHaveBeenCalledWith('records.query', {
      collection: 'characters',
      where: { campaignId: DEFAULT_CAMPAIGN_ID },
    })
    expect(executor).toHaveBeenCalledWith('records.query', {
      collection: 'roll-logs',
      where: { campaignId: DEFAULT_CAMPAIGN_ID },
      limit: 10,
    })
  })

  it('reports a failed underlying query as snapshot_failed', async () => {
    const executor = vi.fn().mockResolvedValue({ success: false, error: 'room unavailable' })
    const { context } = fakeContext(CHAT_URL)
    const tools = buildTools(executor, context)

    await expect(run(tools, 'get_campaign_snapshot', {})).resolves.toEqual({
      success: false,
      code: 'snapshot_failed',
      error: 'room unavailable',
    })
  })
})

describe('GM write tools outside the GM chat turn', () => {
  it.each(GM_KEYS.filter((key) => key !== 'get_campaign_snapshot'))(
    '%s refuses on the agent surface without touching the record room',
    async (name) => {
      const executor = fakeExecutor()
      const { context, calls, roomGet } = fakeContext(AGENT_URL)
      const tools = buildTools(executor, context)

      const result = await run(tools, name, {
        characterId: 'char-1',
        delta: -6,
        itemName: 'Sunfire Vial',
        locationName: 'The Drowned Stair',
      })

      expect(result).toEqual({ success: false, code: 'gm_tools_chat_only' })
      expect(roomGet).not.toHaveBeenCalled()
      expect(calls).toEqual([])
      expect(executor).not.toHaveBeenCalled()
    },
  )

  // `/assistant` shares `/api/ai/chat`; a member could otherwise drive the GM's
  // owner-credentialed writes from that generic page (ADR 0022).
  it.each(GM_KEYS.filter((key) => key !== 'get_campaign_snapshot'))(
    '%s refuses on the per-player assistant route',
    async (name) => {
      const executor = fakeExecutor()
      const { context, calls, roomGet } = fakeContext(ASSISTANT_URL)
      const tools = buildTools(executor, context)

      const result = await run(tools, name, {
        characterId: 'char-1',
        delta: -6,
        itemName: 'Sunfire Vial',
        locationName: 'The Drowned Stair',
      })

      expect(result).toEqual({ success: false, code: 'gm_tools_chat_only' })
      expect(roomGet).not.toHaveBeenCalled()
      expect(calls).toEqual([])
      expect(executor).not.toHaveBeenCalled()
    },
  )
})

describe('GM write tools inside the GM chat turn', () => {
  it('runs an HP write as the owner and returns the action result', async () => {
    const executor = fakeExecutor()
    const { context, calls } = fakeContext(CHAT_URL)
    const tools = buildTools(executor, context)

    const result = await run(tools, 'modify_character_hp', {
      characterId: 'char-1',
      delta: -6,
      reason: 'The blade bites',
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        kind: 'character_hp',
        characterId: 'char-1',
        hp: { before: 18, after: 12, maxHp: 24, appliedDelta: -6 },
        logged: true,
      },
    })

    // Every write went out on the owner-credential action path, which is what
    // turns per-record RBAC off — the identity is the owner, not the caller.
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.headers.get('X-App-Action')).toBe('true')
      expect(call.headers.get('X-User-Id')).toBe(OWNER_USER_ID)
    }
    const logWrite = calls.find(
      (call) => call.tool === 'records.create' && call.params.collection === 'roll-logs',
    )
    expect(logWrite).toBeDefined()
    expect(logWrite?.params.data).toMatchObject({
      entryType: 'combat',
      characterName: 'Kaelen',
    })
    expect(JSON.stringify(logWrite?.params.data)).toContain('The blade bites')
  })

  it('runs a scene write as the owner and logs a gm_event row', async () => {
    const { context, calls } = fakeContext(CHAT_URL)
    const tools = buildTools(fakeExecutor(), context)

    const result = await run(tools, 'update_campaign_scene', {
      locationName: 'The Drowned Stair',
      atmosphereTag: 'dungeon',
      activeThreatDc: 14,
    })

    expect(result).toMatchObject({ success: true, data: { kind: 'update_scene', logged: true } })
    const update = calls.find((call) => call.tool === 'records.update')
    expect(update?.params).toMatchObject({
      collection: 'campaigns',
      recordId: DEFAULT_CAMPAIGN_ID,
      data: { locationName: 'The Drowned Stair', activeThreatDc: 14 },
    })
  })

  it('runs a damage_enemy write as the owner and logs a combat row', async () => {
    const { context, calls } = fakeContext(CHAT_URL)
    const tools = buildTools(fakeExecutor(), context)

    const result = await run(tools, 'damage_enemy', {
      amount: 6,
      reason: 'The arrow finds the gap',
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        kind: 'enemy_damage',
        enemy: { name: 'Runebound Sentinel', before: 24, after: 18, maxHp: 24, applied: 6 },
        logged: true,
      },
    })
    const update = calls.find((call) => call.tool === 'records.update')
    expect(update?.params).toMatchObject({
      collection: 'campaigns',
      recordId: DEFAULT_CAMPAIGN_ID,
      data: { enemyHp: 18 },
    })
    for (const call of calls) {
      expect(call.headers.get('X-User-Id')).toBe(OWNER_USER_ID)
    }
    const logWrite = calls.find(
      (call) => call.tool === 'records.create' && call.params.collection === 'roll-logs',
    )
    expect(logWrite?.params.data).toMatchObject({
      entryType: 'combat',
      characterName: 'Runebound Sentinel',
    })
    expect(JSON.stringify(logWrite?.params.data)).toContain('The arrow finds the gap')
  })

  it('runs a request_check as the owner and writes no roll-logs row', async () => {
    const { context, calls } = fakeContext(CHAT_URL)
    const tools = buildTools(fakeExecutor(), context)

    const result = await run(tools, 'request_check', {
      characterId: 'char-1',
      stat: 'dex',
      dc: 17,
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        kind: 'request_check',
        pending: { characterId: 'char-1', characterName: 'Kaelen', stat: 'dex', dc: 17 },
        logged: false,
      },
    })
    const update = calls.find((call) => call.tool === 'records.update')
    expect(update?.params).toMatchObject({
      collection: 'characters',
      recordId: 'char-1',
      data: { pendingStat: 'dex', pendingDc: 17 },
    })
    // A request is not an outcome: nothing goes into the feed for it.
    expect(calls.some((call) => call.params.collection === 'roll-logs')).toBe(false)
    for (const call of calls) {
      expect(call.headers.get('X-User-Id')).toBe(OWNER_USER_ID)
    }
  })

  it('refuses invalid input before building the owner action context', async () => {
    const { context, calls, roomGet } = fakeContext(CHAT_URL)
    const tools = buildTools(fakeExecutor(), context)

    const result = await run(tools, 'grant_character_loot', {
      characterId: 'char-1',
      itemName: 'Crown of Ash',
      category: 'relic',
    })

    expect(result).toEqual({
      success: false,
      code: 'invalid_params',
      error: 'Invalid input for grant_character_loot',
    })
    expect(roomGet).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })
})

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt('lorespace', [])

  it('is the GM brief: snapshot-first, two-stage resolution, roll verification', () => {
    expect(prompt).toContain('get_campaign_snapshot')
    expect(prompt).toContain('roll-logs')
    expect(prompt).toContain('TWO-STAGE RESOLUTION')
    expect(prompt).toContain('activeThreatDc')
    expect(prompt.toLowerCase()).toContain('never fabricate')
    expect(prompt).toContain('verify it')
  })

  it('states the turn policy and the tool-first order in plain wording', () => {
    expect(prompt).toContain('latest human message')
    expect(prompt).toContain('no turn order')
    expect(prompt).toContain('Tool first, prose second')
    expect(prompt).not.toContain('ADR')
  })

  it('states the combat and arc rules the actions enforce', () => {
    expect(prompt).toContain('damage_enemy')
    expect(prompt).toContain('sceneIndex')
    expect(prompt).toContain('five scenes')
    expect(prompt).toContain('COMBAT IS CONVERSATION')
    expect(prompt).toContain('THE ARC')
    // Narration first, then the check, then the verified consequence (ADR 0024).
    expect(prompt).toContain('attack')
    expect(prompt.toLowerCase()).toContain('never invent')
  })

  it('drops the generic app-assistant framing and stays short', () => {
    expect(prompt).not.toContain('DeepSpace')
    expect(prompt).not.toMatch(/assistant for the/i)
    expect(prompt.split(/\s+/).length).toBeLessThan(700)
    expect(prompt).toContain('Available collections')
  })

  /**
   * The voice rules (`P5.20`) are the product: a GM that reads out a DC and
   * recaps what it refused is a rules engine, not a storyteller. These are the
   * phrases the live probe showed leaking into prose, so they are pinned absent.
   */
  it('forbids mechanics talk in the GM prose', () => {
    expect(prompt).not.toContain('the stakes')
    expect(prompt).not.toContain("I'll call for")
    expect(prompt).toContain('VOICE — THIS IS THE PRODUCT')
    expect(prompt).toContain('in-world')
    expect(prompt).toContain('Never recap what you did mechanically')
    expect(prompt).toContain('Never list')
    expect(prompt).toContain('Roll DEX against 18')
  })

  it('tells the GM who is acting and to set a DC per action', () => {
    // Attribution: the player's message carries their character's name, so the
    // GM must never ask which player it is (P5.20).
    expect(prompt).toContain('Name: what they do')
    expect(prompt).toContain('Never ask which player it is')
    // Per-action DC: the request is a record, not the scene's single number.
    expect(prompt).toContain('request_check')
    expect(prompt).toContain('One action, one number')
    expect(prompt).toContain('set the DC per action')
  })

  /**
   * Round pacing (`P5.32`, `P5.33`, ADR 0031). Amended 2026-11-20: the engine
   * owns the round and its numbers, but **waiting is a UI indicator** — the
   * console tells a player they owe a move, so the brief must stop asking the GM
   * to stage or name the waiting and must forbid restating the table, which is
   * what bloated the chat in live two-window play.
   */
  it('reads the round from the snapshot without staging or reminding anyone', () => {
    expect(prompt).toContain('THE ROUND')
    expect(prompt).toContain('roundNumber')
    expect(prompt).toContain('actedRound')
    expect(prompt).toContain('Never remind anyone to')
    expect(prompt).toContain('never name who is waiting')
    expect(prompt).toContain('A new `roundNumber` means the scene has moved on')
    expect(prompt).toContain('Resolve each action as it arrives')
    expect(prompt).toContain('never ask or act')
    expect(prompt).toContain('for a character who has already acted this round')
    // The staging/reminder language is what the amendment deleted: the console
    // says it now, so the GM repeating it restates the table every turn.
    expect(prompt).not.toContain('address every character who has not acted')
    expect(prompt).not.toContain('name each')
    expect(prompt).not.toContain('a new `roundNumber` means the whole table waits')
    expect(prompt).not.toContain('Stage the table')
    // The single-address rule is what made a two-player table read as two
    // private games sharing a dice log (ADR 0031).
    expect(prompt).not.toContain('Address exactly one character')
  })

  /**
   * Anti-repetition (ADR 0031 amendment): every mid-round reply restated the
   * party's HP and the scene, so the thread filled with near-identical turns.
   */
  it('forbids restating the scene, the party or the previous paragraph', () => {
    expect(prompt).toContain('Do not restate')
    expect(prompt).toContain('unless this turn changed it')
    expect(prompt).toContain('never summarise the')
    expect(prompt).toContain('never repeat a previous paragraph')
    expect(prompt).toContain('one or two short paragraphs mid-round')
  })

  /**
   * Roll batching (`P5.33`, ADR 0031 amended 2026-11-20): the route now calls
   * the model once per roll batch, so several rolls can reach the GM in one turn.
   * Without this the model answers the first die and advances the rest of the
   * table on the back of it.
   */
  it('says a whole round may arrive at once and rolls may arrive together', () => {
    expect(prompt).toContain('You receive a whole round')
    expect(prompt).toContain('answer all of them in one turn')
    expect(prompt).toContain('Rolls may arrive together too')
    expect(prompt).toContain('Narrate each roll for its own roller only')
    expect(prompt).toContain('never a character whose')
    expect(prompt).toContain('roll is not in the batch')
    // A roll is not "alone" any more: that sentence is what made one die look
    // like a whole turn's worth of story.
    expect(prompt).not.toContain('A roll arrives alone')
  })
})
