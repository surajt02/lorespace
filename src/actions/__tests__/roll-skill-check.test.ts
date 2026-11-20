import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionTools, ActionResult } from 'deepspace/worker'
import type { Env } from '../../../worker'
import { DEFAULT_CAMPAIGN_ID } from '../../constants'
import { rollSkillCheck } from '../index'

/**
 * The gate on `rollSkillCheck` (ADR 0005, `P4.4`).
 *
 * Every action runs with per-record RBAC off (`ctx.tools` carry `X-App-Action`),
 * so the record room enforces nothing: these tests are what proves the action
 * refuses a character that is not the caller's — and that it refuses *before*
 * rolling or writing — that a missing DC is a failure rather than a roll
 * against 0, and that the row it writes carries server-computed values only
 * (`userId` from `userBound`, `rolledAt` from the timestamp trigger, never from
 * this file).
 *
 * The entropy is stubbed where a specific face matters, so a crit boundary is
 * exercised exactly instead of by retry.
 */

function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

function failed(code: string, error: string): ActionResult<never> {
  return { success: false, code, error }
}

interface FakeToolsOptions {
  get?: (collection: string) => ActionResult<unknown>
  create?: ActionResult<unknown>
  /**
   * The roster read the table-wide authorisation makes when the caller owes
   * nothing. An empty party is the default, so a test that only cares about the
   * caller's own row does not have to spell it out.
   */
  query?: ActionResult<unknown>
}

/** `tools.get` per collection, because the action reads a character then a campaign. */
function createFakeTools(options: FakeToolsOptions = {}) {
  return {
    create: vi.fn().mockResolvedValue(options.create ?? ok({ recordId: 'log-1' })),
    update: vi.fn().mockResolvedValue(ok({ recordId: DEFAULT_CAMPAIGN_ID })),
    remove: vi.fn(),
    deleteWhere: vi.fn(),
    get: vi
      .fn()
      .mockImplementation(async (collection: string) =>
        options.get
          ? options.get(collection)
          : failed('not_found', `${collection} not found`),
      ),
    query: vi.fn().mockResolvedValue(options.query ?? roster([])),
    integration: vi.fn(),
    registerUser: vi.fn(),
  }
}

type FakeTools = ReturnType<typeof createFakeTools>

const CALLER_ID = 'user-alice'

function context(tools: FakeTools, params: Record<string, unknown> = {}) {
  return {
    userId: CALLER_ID,
    params,
    tools: tools as unknown as ActionTools,
    env: { OWNER_USER_ID: 'user-owner' } as unknown as Env,
    callerJwt: '',
  }
}

/** A `characters` row's data, owned by the caller unless a test says otherwise. */
function characterData(overrides: Record<string, unknown> = {}) {
  return {
    userId: CALLER_ID,
    campaignId: DEFAULT_CAMPAIGN_ID,
    name: 'Kaelen',
    hp: 24,
    maxHp: 24,
    str: 16,
    dex: 12,
    con: 14,
    int: 8,
    wis: 10,
    cha: 11,
    ...overrides,
  }
}

/** A `characters` row owned by the caller unless a test says otherwise. */
function characterGet(overrides: Record<string, unknown> = {}) {
  return ok({ record: { recordId: 'char-kaelen', data: characterData(overrides) } })
}

/** The seeded campaign's row; `activeThreatDc` is 12 in the seed (ADR 0011). */
function campaignGet(overrides: Record<string, unknown> = {}) {
  return ok({ record: { recordId: DEFAULT_CAMPAIGN_ID, data: { activeThreatDc: 12, ...overrides } } })
}

/** A `characters` roster read: the party-wide authorisation's one query. */
function roster(records: { recordId: string; data: Record<string, unknown> }[]) {
  return ok({ records, count: records.length })
}

/** Another character's row, as the roster query returns it. */
function otherCharacter(overrides: Record<string, unknown> = {}, recordId = 'char-joeblo') {
  return {
    recordId,
    data: { ...characterData(), name: 'Joeblo', userId: 'user-bob', ...overrides },
  }
}

/** `tools.get` answering a character then the campaign. */
function getRouter(routes: {
  characters?: ActionResult<unknown>
  campaigns?: ActionResult<unknown>
}) {
  return (collection: string) =>
    routes[collection as 'characters' | 'campaigns'] ??
    failed('not_found', `${collection} not found`)
}

/**
 * Forces the next draw to a given face: byte `face - 1` is always accepted and
 * maps straight through, so the action still goes via `rollD20FromBytes` and
 * the only thing stubbed is the entropy (ADR 0005 keeps the roll server-side —
 * the test supplies the bytes, exactly as the plan's `src/lib/rng.ts` contract
 * allows).
 */
function stubSeed(face: number) {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((
    array: Uint8Array,
  ) => {
    array.fill(face - 1)
    return array
  }) as unknown as typeof globalThis.crypto.getRandomValues)
}

afterEach(() => {
  vi.restoreAllMocks()
})

const CREATED_COLUMNS = [
  'campaignId',
  'characterName',
  'entryType',
  'modifier',
  'outcome',
  'rawRoll',
  'statName',
  'summary',
  'targetDc',
  'total',
]

const VALID_OUTCOMES = ['critical_success', 'success', 'failure', 'critical_failure']

describe('rollSkillCheck parameters', () => {
  it('rejects a stat name that is not one of the six abilities', async () => {
    const tools = createFakeTools({ get: getRouter({}) })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'luck' }),
    )

    expect(result).toMatchObject({ success: false, code: 'invalid_params' })
    expect(tools.get).not.toHaveBeenCalled()
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('rejects a missing character id', async () => {
    const tools = createFakeTools({ get: getRouter({}) })

    const result = await rollSkillCheck(context(tools, { statName: 'dex' }))

    expect(result).toMatchObject({ success: false, code: 'invalid_params' })
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('ignores a client-supplied rawRoll or campaignId', async () => {
    // Zod strips unknown keys: the row is the server's numbers, not the caller's.
    stubSeed(7)
    const tools = createFakeTools({ get: getRouter({ characters: characterGet(), campaigns: campaignGet() }) })

    const result = await rollSkillCheck(
      context(tools, {
        characterId: 'char-kaelen',
        statName: 'dex',
        rawRoll: 20,
        campaignId: 'someone-elses-table',
      }),
    )

    expect(result).toMatchObject({ success: true, data: { rawRoll: 7 } })
    expect(tools.create.mock.calls[0][1]).toMatchObject({ campaignId: DEFAULT_CAMPAIGN_ID })
  })
})

describe('rollSkillCheck authorization', () => {
  it('reports a character that cannot be read as character_not_found', async () => {
    const tools = createFakeTools({
      get: getRouter({ characters: failed('not_found', 'no such character') }),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-missing', statName: 'dex' }),
    )

    expect(result).toMatchObject({ success: false, code: 'character_not_found' })
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('refuses another player’s character and writes nothing', async () => {
    const tools = createFakeTools({
      get: getRouter({ characters: characterGet({ userId: 'user-bob' }), campaigns: campaignGet() }),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'dex' }),
    )

    expect(result).toMatchObject({ success: false, code: 'not_owner' })
    expect(tools.create).not.toHaveBeenCalled()
    // Ownership is checked before the campaign read, so a non-owner learns
    // nothing about the table.
    expect(tools.get).toHaveBeenCalledTimes(1)
  })
})

describe('rollSkillCheck DC', () => {
  it('fails when the campaign row cannot be read', async () => {
    const tools = createFakeTools({
      get: getRouter({
        characters: characterGet(),
        campaigns: failed('not_found', 'no such campaign'),
      }),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'dex' }),
    )

    expect(result).toMatchObject({ success: false, code: 'campaign_not_found' })
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('fails rather than rolling against a DC of 0 when activeThreatDc is not a number', async () => {
    // A roll against 0 always succeeds; that would log a meaningless success.
    for (const activeThreatDc of [undefined, null, '', '12', Number.NaN]) {
      const tools = createFakeTools({
        get: getRouter({ characters: characterGet(), campaigns: campaignGet({ activeThreatDc }) }),
      })

      const result = await rollSkillCheck(
        context(tools, { characterId: 'char-kaelen', statName: 'dex' }),
      )

      expect(result).toMatchObject({ success: false, code: 'campaign_not_found' })
      expect(tools.create).not.toHaveBeenCalled()
    }
  })
})

describe('rollSkillCheck happy path', () => {
  it('writes exactly the ten server-owned columns and returns them', async () => {
    // DEX 12 → +1; face 13 → total 14 against DC 12 → success.
    stubSeed(13)
    const tools = createFakeTools({
      get: getRouter({ characters: characterGet(), campaigns: campaignGet() }),
      create: ok({ recordId: 'log-42' }),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'dex' }),
    )

    expect(tools.create).toHaveBeenCalledTimes(1)
    const [collection, row] = tools.create.mock.calls[0] as [string, Record<string, unknown>]
    expect(collection).toBe('roll-logs')
    expect(Object.keys(row).sort()).toEqual(CREATED_COLUMNS)
    // userBound on `userId`, timestampTrigger on `rolledAt`: neither is ours to send.
    expect(row).not.toHaveProperty('userId')
    expect(row).not.toHaveProperty('rolledAt')
    expect(row).toEqual({
      campaignId: DEFAULT_CAMPAIGN_ID,
      characterName: 'Kaelen',
      entryType: 'roll',
      statName: 'dex',
      rawRoll: 13,
      modifier: 1,
      total: 14,
      targetDc: 12,
      outcome: 'success',
      summary: 'DEX check: d20(13) +1 = 14 vs DC 12 — success',
    })

    expect(result).toEqual({
      success: true,
      data: {
        rawRoll: 13,
        modifier: 1,
        total: 14,
        targetDc: 12,
        outcome: 'success',
        rollLogId: 'log-42',
      },
    })
  })

  it('reads the DC from the campaign the character belongs to', async () => {
    stubSeed(11)
    const tools = createFakeTools({
      get: getRouter({ characters: characterGet(), campaigns: campaignGet({ activeThreatDc: 15 }) }),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'str' }),
    )

    // The character's own row is checked against the one campaign id, then the
    // DC is read by that constant — never from the caller.
    expect(tools.get).toHaveBeenLastCalledWith('campaigns', DEFAULT_CAMPAIGN_ID)
    // STR 16 → +3; 11 + 3 = 14 < 15 → failure, with the live DC not a default.
    expect(result).toMatchObject({
      success: true,
      data: { rawRoll: 11, modifier: 3, total: 14, targetDc: 15, outcome: 'failure' },
    })
  })

  it('refuses a character from another campaign before reading any DC', async () => {
    const tools = createFakeTools({
      get: getRouter({
        characters: characterGet({ campaignId: 'other-campaign' }),
        campaigns: campaignGet({ activeThreatDc: 15 }),
      }),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'str' }),
    )

    expect(result).toMatchObject({ success: false, code: 'character_not_found' })
    // No DC read, no roll, no row: one campaign, one table.
    expect(tools.get).not.toHaveBeenCalledWith('campaigns', expect.anything())
    expect(tools.create).not.toHaveBeenCalled()
  })
})

describe('rollSkillCheck outcomes', () => {
  it('crits on a natural 20 whatever the DC', async () => {
    stubSeed(20)
    const tools = createFakeTools({
      get: getRouter({ characters: characterGet(), campaigns: campaignGet({ activeThreatDc: 99 }) }),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'dex' }),
    )

    expect(result).toMatchObject({
      success: true,
      data: { rawRoll: 20, modifier: 1, total: 21, targetDc: 99, outcome: 'critical_success' },
    })
  })

  it('critically fails on a natural 1 even when the total clears the DC', async () => {
    stubSeed(1)
    const tools = createFakeTools({
      get: getRouter({ characters: characterGet(), campaigns: campaignGet({ activeThreatDc: 0 }) }),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'str' }),
    )

    expect(result).toMatchObject({
      success: true,
      data: { rawRoll: 1, modifier: 3, total: 4, targetDc: 0, outcome: 'critical_failure' },
    })
  })

  it('keeps the returned payload and the written row in agreement on a real draw', async () => {
    // No seed stub: the action draws from `crypto`, and the invariants that hold
    // for every roll must hold for this one — one d20 face, one modifier, the
    // total as their sum, one of the four outcomes, and a row that says the same.
    const tools = createFakeTools({
      get: getRouter({ characters: characterGet(), campaigns: campaignGet() }),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'wis' }),
    )

    expect(result.success).toBe(true)
    if (!result.success) return
    const { rawRoll, modifier, total, targetDc, outcome, rollLogId } = result.data
    expect(Number.isInteger(rawRoll)).toBe(true)
    expect(rawRoll).toBeGreaterThanOrEqual(1)
    expect(rawRoll).toBeLessThanOrEqual(20)
    expect(modifier).toBe(0) // WIS 10
    expect(total).toBe(rawRoll + modifier)
    expect(targetDc).toBe(12)
    expect(VALID_OUTCOMES).toContain(outcome)
    expect(rollLogId).toBe('log-1')

    const [, row] = tools.create.mock.calls[0] as [string, Record<string, unknown>]
    expect(row).toMatchObject({ rawRoll, modifier, total, targetDc, outcome, statName: 'wis' })
  })
})

describe('rollSkillCheck write failure', () => {
  it('reports write_failed at stage roll_log and returns no payload', async () => {
    stubSeed(13)
    const tools = createFakeTools({
      get: getRouter({ characters: characterGet(), campaigns: campaignGet() }),
      create: failed('schema_validation_failed', 'rolledAt is required'),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'dex' }),
    )

    expect(result).toEqual({
      success: false,
      code: 'write_failed',
      error: 'rolledAt is required',
      details: { stage: 'roll_log', applied: [] },
    })
  })
})

/**
 * Each character carries its own pending check (`P5.19`, ADR 0030). The GM's
 * request lives on the roller's row, so the action — not the browser — decides
 * whether a roll was asked for, which DC it is against, and when the request is
 * spent. Another sheet's request is invisible here and can never gate this one.
 */
describe('rollSkillCheck pending check', () => {
  /** The caller's row with an unanswered request on Kaelen's DEX at DC 17. */
  function pendingCharacter(overrides: Record<string, unknown> = {}) {
    return characterGet({ pendingStat: 'dex', pendingDc: 17, ...overrides })
  }

  it('refuses a stat that was not requested, writing nothing', async () => {
    const tools = createFakeTools({
      get: getRouter({ characters: pendingCharacter(), campaigns: campaignGet() }),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'int' }),
    )

    expect(result).toEqual({
      success: false,
      code: 'roll_not_requested',
      error: 'You are being asked for a DEX check; INT was not requested',
    })
    // No die was spent: the refusal is before the draw and before the row.
    expect(tools.create).not.toHaveBeenCalled()
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('clears only the roller’s own request, never another sheet or the campaign', async () => {
    // Ash owes a DEX check; Joeblo owes one too, and nothing here may spend it.
    stubSeed(20)
    const tools = createFakeTools({
      get: getRouter({ characters: pendingCharacter(), campaigns: campaignGet() }),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'dex' }),
    )

    expect(result).toMatchObject({ success: true, data: { targetDc: 17 } })
    // Exactly one write, to the roller's row: the campaign carries no gate any
    // more, and another character's pending pair is theirs until they roll.
    expect(tools.update.mock.calls).toEqual([
      ['characters', 'char-kaelen', { pendingStat: '', pendingDc: 0 }],
    ])
  })

  it('rolls against the pending DC, not the scene DC, and clears the request', async () => {
    // DEX 12 → +1; face 13 → 14, which clears the scene's 12 but not the
    // request's 17. The row must say 17 and failure.
    stubSeed(13)
    const tools = createFakeTools({
      get: getRouter({ characters: pendingCharacter(), campaigns: campaignGet() }),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'dex' }),
    )

    expect(result).toEqual({
      success: true,
      data: {
        rawRoll: 13,
        modifier: 1,
        total: 14,
        targetDc: 17,
        outcome: 'failure',
        rollLogId: 'log-1',
      },
    })
    const [, row] = tools.create.mock.calls[0] as [string, Record<string, unknown>]
    expect(row).toMatchObject({ statName: 'dex', targetDc: 17, outcome: 'failure' })
    expect(tools.update).toHaveBeenCalledWith('characters', 'char-kaelen', {
      pendingStat: '',
      pendingDc: 0,
    })
  })

  it('spends a failed check as well: the request is answered either way', async () => {
    // A miss is still a resolution (ADR 0030): the gate must not stay armed.
    stubSeed(2)
    const tools = createFakeTools({
      get: getRouter({ characters: pendingCharacter(), campaigns: campaignGet() }),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'dex' }),
    )

    expect(result).toMatchObject({ success: true, data: { targetDc: 17, outcome: 'failure' } })
    expect(tools.update).toHaveBeenCalledWith('characters', 'char-kaelen', {
      pendingStat: '',
      pendingDc: 0,
    })
  })

  it('falls back to the scene DC when nothing is pending', async () => {
    stubSeed(13)
    const tools = createFakeTools({
      get: getRouter({
        characters: characterGet({ pendingStat: '', pendingDc: 0 }),
        campaigns: campaignGet({ activeThreatDc: 12 }),
      }),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'dex' }),
    )

    expect(result).toMatchObject({ success: true, data: { targetDc: 12, outcome: 'success' } })
    // Nothing was pending, so nothing is written back after the row.
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('ignores a half-written pending row rather than locking the sheet out', async () => {
    // A `pendingStat` outside the six, or a DC of 0, is not a request. The
    // scene DC governs, exactly as it did before P5.19.
    for (const pending of [
      { pendingStat: 'luck', pendingDc: 17 },
      { pendingStat: 'dex', pendingDc: 0 },
      { pendingStat: 'dex', pendingDc: '17' },
    ]) {
      stubSeed(13)
      const tools = createFakeTools({
        get: getRouter({
          characters: characterGet(pending),
          campaigns: campaignGet({ activeThreatDc: 12 }),
        }),
      })

      const result = await rollSkillCheck(
        context(tools, { characterId: 'char-kaelen', statName: 'int' }),
      )

      expect(result).toMatchObject({ success: true, data: { targetDc: 12 } })
      expect(tools.update).not.toHaveBeenCalled()
    }
  })

  it('keeps the roll a success when clearing the request fails', async () => {
    stubSeed(18)
    const tools = createFakeTools({
      get: getRouter({ characters: pendingCharacter(), campaigns: campaignGet() }),
    })
    tools.update.mockResolvedValue(failed('write_refused', 'update refused'))

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'dex' }),
    )

    // The row is evidence and it landed: a stale request is reported, not fatal.
    expect(result).toMatchObject({
      success: true,
      data: { targetDc: 17, rollLogId: 'log-1', details: { pendingClearFailed: 'update refused' } },
    })
  })

  it('does not clear the request when the roll itself could not be written', async () => {
    stubSeed(18)
    const tools = createFakeTools({
      get: getRouter({ characters: pendingCharacter(), campaigns: campaignGet() }),
      create: failed('write_refused', 'roll-logs refused the row'),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'dex' }),
    )

    expect(result).toMatchObject({ success: false, code: 'write_failed' })
    // The sheet still owes the check: nothing answered it.
    expect(tools.update).not.toHaveBeenCalled()
  })
})

/**
 * Authorisation is table-wide even though storage is per character (`P5.31`,
 * ADR 0030 amendment 2026-11-20).
 *
 * Per-character storage made this action read only the caller's own row, and with
 * nothing pending on it a player fell through to the scene DC and wrote a real
 * `roll-logs` row for a stat the GM asked of someone else. These tests pin the
 * refusal: it happens before the die, before any write, and it names the sheet
 * the table is actually waiting on — while two characters who each owe a check
 * can still roll their own.
 */
describe('rollSkillCheck table-wide authorisation', () => {
  it('refuses the caller while another character owes a check, before the die', async () => {
    // The observed bug: the GM asked Joeblo for WIS and Kaelen rolled WIS too.
    const draw = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const tools = createFakeTools({
      get: getRouter({ characters: characterGet(), campaigns: campaignGet() }),
      query: roster([otherCharacter({ pendingStat: 'wis', pendingDc: 13 })]),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'wis' }),
    )

    expect(result).toEqual({
      success: false,
      code: 'check_owed_by_other',
      error: 'Joeblo is being asked for a WIS check; you have not been asked to roll',
    })
    // Nothing rolled and nothing written: no evidence, no spent request.
    expect(draw).not.toHaveBeenCalled()
    expect(tools.create).not.toHaveBeenCalled()
    expect(tools.update).not.toHaveBeenCalled()
    // The party is read from the campaign, bounded like every other roster read.
    expect(tools.query).toHaveBeenCalledWith('characters', {
      where: { campaignId: DEFAULT_CAMPAIGN_ID },
      limit: 200,
    })
  })

  it('fails closed when the party cannot be read', async () => {
    // An unreadable party must not authorise anything: same code, generic
    // message, no die and no row.
    const draw = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const tools = createFakeTools({
      get: getRouter({ characters: characterGet(), campaigns: campaignGet() }),
      query: failed('read_refused', 'the roster was refused'),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'dex' }),
    )

    expect(result).toEqual({
      success: false,
      code: 'check_owed_by_other',
      error: "The party's pending checks could not be read; the roll was refused",
    })
    expect(draw).not.toHaveBeenCalled()
    expect(tools.create).not.toHaveBeenCalled()
  })

  it('lets two characters each roll the check they owe', async () => {
    // Kaelen owes DEX 17; the roster also holds Joeblo owing WIS 9. Each sheet
    // answers its own ask, and neither ask overwrites the other (ADR 0030).
    stubSeed(18)
    const dexTools = createFakeTools({
      get: getRouter({
        characters: characterGet({ pendingStat: 'dex', pendingDc: 17 }),
        campaigns: campaignGet(),
      }),
      query: roster([otherCharacter({ pendingStat: 'wis', pendingDc: 9 })]),
    })

    const dex = await rollSkillCheck(
      context(dexTools, { characterId: 'char-kaelen', statName: 'dex' }),
    )

    expect(dex).toMatchObject({ success: true, data: { targetDc: 17 } })
    // The caller owes a check, so the party is never consulted for this roll.
    expect(dexTools.query).not.toHaveBeenCalled()

    stubSeed(10)
    const wisTools = createFakeTools({
      get: getRouter({
        characters: characterGet({
          userId: 'user-bob',
          name: 'Joeblo',
          pendingStat: 'wis',
          pendingDc: 9,
        }),
        campaigns: campaignGet(),
      }),
      query: roster([otherCharacter({ pendingStat: 'dex', pendingDc: 17 })]),
    })

    const joeblo = await rollSkillCheck({
      ...context(wisTools, { characterId: 'char-joeblo', statName: 'wis' }),
      userId: 'user-bob',
    })

    expect(joeblo).toMatchObject({ success: true, data: { targetDc: 9 } })
    expect(wisTools.query).not.toHaveBeenCalled()
  })

  it('ignores the caller’s own row in the roster read', async () => {
    // Only *another* sheet's check gates this one; the caller's row was already
    // read and owes nothing here.
    stubSeed(13)
    const tools = createFakeTools({
      get: getRouter({ characters: characterGet(), campaigns: campaignGet() }),
      query: roster([
        otherCharacter({ pendingStat: 'dex', pendingDc: 17 }, 'char-kaelen'),
      ]),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'dex' }),
    )

    expect(result).toMatchObject({ success: true, data: { targetDc: 12 } })
  })

  it('ignores a half-written roster row rather than refusing every roll', async () => {
    // A hand-edited or half-written row is not a request, so the free roll at the
    // scene DC stands — the same tolerance `pendingCheckOf` applies to the caller.
    stubSeed(13)
    const tools = createFakeTools({
      get: getRouter({ characters: characterGet(), campaigns: campaignGet() }),
      query: roster([otherCharacter({ pendingStat: 'luck', pendingDc: 14 })]),
    })

    const result = await rollSkillCheck(
      context(tools, { characterId: 'char-kaelen', statName: 'dex' }),
    )

    expect(result).toMatchObject({ success: true, data: { targetDc: 12 } })
    expect(tools.create).toHaveBeenCalledTimes(1)
  })
})
