/**
 * AI Tool Definitions — the record tools plus the AI Game Master's tools,
 * exposed to the Vercel AI SDK.
 *
 * The assistant can read AND modify data. Per-collection RBAC at the DO
 * layer is the actual security boundary — the user's role determines what
 * each tool call is allowed to do, regardless of what's in this allowlist.
 * Trim entries below if you want a stricter assistant for your app.
 *
 * The six GM tools are different: their writes run as the **app owner**
 * through `applyGmMutation` (ADR 0017), so they are not bounded by the caller's
 * RBAC. The gate that keeps that safe is `gmToolAllowedForPath` — writes only
 * run inside the in-app chat turn, because every tool here is also exposed over
 * HTTP and MCP (ADR 0022).
 */

import { jsonSchema, tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod/v4'
import { BUILT_IN_TOOLS, applyAiToolDefaults } from 'deepspace/worker'
import type { AgentToolContext, ToolSchema, CollectionSchema } from 'deepspace/worker'
import { applyGmMutation } from '../actions/index.js'
import { DEFAULT_CAMPAIGN_ID } from '../constants.js'
import {
  GM_READ_TOOLS,
  GM_WRITE_TOOLS,
  gmToolAllowedForPath,
  gmWriteInputSchemas,
  toGmMutation,
} from '../lib/gm-tools.js'
import type { GmToolName, GmWriteToolName } from '../lib/gm-tools.js'
import { createActionTools } from '../server/action-routes.js'
// Type-only — TypeScript strips it at runtime, so this file never imports the
// worker entry (which imports `buildTools` from here).
import type { Env } from '../../worker.js'

type ToolExecutor = (toolName: string, params: Record<string, unknown>) => Promise<unknown>

/**
 * What the GM's tools get besides the SDK's agent context: the characters who
 * are actually at the table this turn (the caller plus everyone who has spoken
 * in the thread). The snapshot is filtered to them, so a stale character row —
 * a test account's sheet, a player who has gone home — is never narrated.
 */
export type GmToolContext = AgentToolContext<Env> & {
  presentCharacterNames?: readonly string[]
}

// Deleting a record is deliberately absent from this list (`P5.4`): the GM
// never needs it, there is no soft delete or transaction to undo it, and every
// tool in this set is also auto-exposed over MCP. Re-add only as a narrow,
// confirmed GM tool. Deletes stay reachable through the actions' own wiring
// (`src/server/action-routes.ts`), never through the AI surface.
const ALLOWED_TOOL_NAMES = [
  'schema.list',
  'schema.describe',
  'records.query',
  'records.get',
  'records.create',
  'records.update',
  'user.current',
]

// ============================================================================
// System prompt
// ============================================================================

type Interpretation = CollectionSchema['columns'][number]['interpretation']

/**
 * Interpretation is `string | Record<string, unknown>`. When it's an object
 * the convention across the SDK's schemas is `{ kind: string, ... }`.
 * Narrow safely to a human-readable name.
 */
function interpretationLabel(interpretation: Interpretation): string {
  if (typeof interpretation === 'string') return interpretation
  const kind = interpretation.kind
  return typeof kind === 'string' ? kind : 'object'
}

/**
 * The LoreSpace GM brief (`P5.5`, `P5.20`). This is product behaviour rendered
 * to players, so it lives here beside the tools it names, and each rule is
 * stated as an instruction the model can follow rather than as background.
 *
 * Three decisions it carries:
 *
 * - Engine owns outcomes (ADR 0009): the model chooses inputs — a DC, a delta,
 *   an item, a scene — and code computes every result. So the prompt insists on
 *   tool first, prose second, and forbids inventing dice or totals.
 * - The GM is a storyteller, not a referee reading out a rulebook (`P5.20`):
 *   in-world voice only, no mechanics recap, obstacles rather than an option
 *   list.
 * - One action, one number (`P5.19`, ADR 0030): the check a character owes is
 *   two columns on that character's row, so the DC is per action, the sheet
 *   knows which stat is live, and two players can owe separate rolls at once.
 *
 * The round is paced by the engine, not ordered by the GM (ADR 0031):
 * `roundNumber` and each character's `actedRound` are read from the snapshot,
 * every action is resolved as it arrives, and **waiting is a UI indicator** — the
 * console tells a player they owe a move, so the GM never reminds or names the
 * waiting. No turn queue, no addressing syntax, and no restating the table.
 */
export function buildSystemPrompt(appName: string, schemas: CollectionSchema[]): string {
  const schemaSummary = schemas
    .map((s) => {
      const cols = (s.columns ?? [])
        .map((c) => `${c.name}:${interpretationLabel(c.interpretation)}${c.required ? '!' : ''}`)
        .join(', ')
      return `- ${s.name}${cols ? ` (${cols})` : ''}`
    })
    .join('\n')

  return [
    `You are the Game Master for ${appName}: a small dark-fantasy table. You run`,
    'the world and keep its state true.',
    '',
    'VOICE — THIS IS THE PRODUCT',
    '- Speak only in-world: the place, the people, what they see and hear.',
    '- Never write mechanics words: "DC", "check", "stakes", "tool", "log",',
    '  "applied", any tool name. Never announce a roll; ask in-world with the',
    '  number: "Roll DEX against 18."',
    '- Never recap what you did mechanically; if a roll does not answer, say so.',
    '- Describe: obstacles, sounds, smells, danger. Never list options, hint at a',
    '  DC, or explain the rules.',
    '- Name who you address inside the prose ("Vesper, what are you doing?").',
    '  No headers, no lists, 2-4 short paragraphs.',
    '',
    'THE ROUND',
    '- Call `get_campaign_snapshot` before a new beat: party HP, owed',
    '  checks, `roundNumber`, `actedRound`, `roll-logs`.',
    '- `actedRound` equal to `roundNumber` means that character has acted; lower',
    '  means behind. A new `roundNumber` means the scene has moved on.',
    '- You receive a whole round: several players\' actions may arrive together',
    '  and you answer all of them in one turn. Rolls may arrive together too.',
    '- The latest human messages tell you who is acting: they arrive as',
    '  "Name: what they do". Never ask which player it is, never attribute an',
    '  action or a roll to another sheet. No turn order, no "@GM" addressing.',
    '- The app tells players when they owe a move. Never remind anyone to',
    '  act, never name who is waiting.',
    '- Resolve each action as it arrives: its consequence lands that same turn.',
    '- Never act for a character not in the snapshot; never ask or act',
    '  for a character who has already acted this round: an absent sheet is',
    '  away from the table.',
    '- Do not restate. Never repeat the scene, the party HP or another',
    "  character's condition unless this turn changed it; never summarise the",
    '  table; never repeat a previous paragraph. Answer only the action in front',
    '  of you: one or two short paragraphs mid-round.',
    '',
    'TWO-STAGE RESOLUTION',
    '- One action, one number. Before asking for a roll, call `request_check`',
    "  with the character, the ability and that action's own DC. A jump and",
    '  a lever differ: set the DC per action, never per scene, never through',
    "  `update_campaign_scene`'s `activeThreatDc`.",
    '- A check exists only once `request_check` returned success: naming a roll',
    '  without calling it strands the table. Never re-arm an owed',
    '  `pendingStat`/`pendingDc`.',
    '- Wait for that roll: the app accepts only the check you asked for.',
    '  Never fabricate dice, totals or outcomes; the app rolls and writes the row.',
    '',
    'RESOLVING A ROLL',
    '- When a roll is reported, verify it in `recentRolls` and use its exact',
    '  numbers. Narrate each roll for its own roller only; never a character whose',
    '  roll is not in the batch.',
    '- Call the matching write tool in the same turn: `modify_character_hp`,',
    '  `grant_character_loot`, `damage_enemy` or `update_campaign_scene`.',
    '  Tool first, prose second. Never state an outcome with no row behind it.',
    '',
    'COMBAT IS CONVERSATION',
    '- No attack button, no turn order: a player attacks by saying what they do.',
    "  Treat it as a risky action — `request_check` sets that shot's DC,",
    '  `sceneSummary` names the enemy, then ask.',
    '- One consequence per roll: hit → `damage_enemy` (amount + reason); miss →',
    '  `modify_character_hp` on the attacker. At 0 HP → narrate the defeat and',
    '  advance one scene in the same turn with `update_campaign_scene` and',
    '  `sceneIndex`.',
    '- Attribute a roll to the roller, never to whoever narrated last, and never',
    '  ask for the same check twice.',
    "- `sceneSummary` is the place and the situation, never a character's action.",
    '',
    'THE ARC',
    '- The campaign is five scenes; `sceneIndex` (0-4) is where',
    '  the table is. It moves one forward only when the app agrees the scene is',
    '  over (one success at the scene DC, or the enemy at 0 HP); a refused write',
    '  means it has not ended — narrate inside it.',
    '- Never skip or move backwards; never invent a location the snapshot lacks.',
    '',
    'THE RULES',
    '- Six attributes (str, dex, con, int, wis, cha), armour class, HP. No',
    '  conditions, initiative, XP.',
    '- Items are healing consumables or quest items.',
    '- HP is clamped 0..maxHp: pass a delta, never a total.',
    '',
    'Available collections (for `records.*` calls):',
    schemaSummary || '(none)',
  ].join('\n')
}

// ============================================================================
// Tool definitions
// ============================================================================

/** The snapshot's projected columns — never the whole row (30 KB tool cap). */
const CAMPAIGN_COLUMNS = [
  'title',
  'locationName',
  'atmosphereTag',
  'sceneSummary',
  'activeThreatDc',
  'enemyName',
  'enemyHp',
  'enemyMaxHp',
  // The round (ADR 0031): the GM compares it to each character's `actedRound`
  // to see who is still waiting on it. One number.
  'roundNumber',
] as const

const CHARACTER_COLUMNS = [
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
  // Each character's own owed check (ADR 0030). Without these the model cannot
  // see that a check is already pending and re-arms it; two small columns are
  // nothing against the 30 KB cap.
  'pendingStat',
  'pendingDc',
  // Who has acted in the round (ADR 0031): equal to `campaigns.roundNumber`
  // means done, lower means the GM still has to stage them. One number per row.
  'actedRound',
] as const

const ROLL_COLUMNS = [
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
] as const

/** The subset of a `records.query` result this file reads. */
interface QueryPayload {
  success?: boolean
  error?: string
  data?: { records?: unknown }
}

interface SnapshotRow {
  recordId: string
  data: Record<string, unknown>
}

type QueryOutcome = { ok: true; rows: SnapshotRow[] } | { ok: false; error: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname
  } catch {
    return ''
  }
}

/** Runs one record read as the caller and normalizes the wire payload. */
async function queryRecords(
  executor: ToolExecutor,
  collection: string,
  options: Record<string, unknown>,
): Promise<QueryOutcome> {
  let payload: unknown
  try {
    payload = await executor('records.query', { collection, ...options })
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, error: `records.query returned no payload for ${collection}` }
  }
  const { success, error, data } = payload as QueryPayload
  if (success === false) {
    return {
      ok: false,
      error: typeof error === 'string' && error !== '' ? error : `records.query failed for ${collection}`,
    }
  }
  if (!Array.isArray(data?.records)) {
    return { ok: false, error: `records.query returned no records for ${collection}` }
  }
  const rows: SnapshotRow[] = []
  for (const record of data.records) {
    if (typeof record !== 'object' || record === null) continue
    const { recordId, data: recordData } = record as { recordId?: unknown; data?: unknown }
    if (typeof recordId !== 'string') continue
    rows.push({
      recordId,
      data:
        typeof recordData === 'object' && recordData !== null
          ? (recordData as Record<string, unknown>)
          : {},
    })
  }
  return { ok: true, rows }
}

/** `recordId` plus the named columns only — a projection, not a row copy. */
function project(row: SnapshotRow, columns: readonly string[]): Record<string, unknown> {
  const projected: Record<string, unknown> = { recordId: row.recordId }
  for (const column of columns) {
    const value = row.data[column]
    if (value !== undefined) projected[column] = value
  }
  return projected
}

/**
 * The party is who is at the table, not every `characters` row. The list is the
 * caller plus the thread's recent speakers; an empty or absent list falls back
 * to every row so a caller that cannot know better (a local agent) still sees
 * the table rather than nothing.
 */
function presentCharacters(
  rows: SnapshotRow[],
  names?: readonly string[],
): SnapshotRow[] {
  if (!names || names.length === 0) return rows
  const wanted = new Set(
    names
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.length > 0),
  )
  if (wanted.size === 0) return rows
  return rows.filter((row) => {
    const name = row.data.name
    return typeof name === 'string' && wanted.has(name.trim().toLowerCase())
  })
}

function snapshotFailed(error: string) {
  return { success: false as const, code: 'snapshot_failed' as const, error }
}

/** The GM's one read: campaign, party and the ten newest roll rows. */
async function readCampaignSnapshot(
  executor: ToolExecutor,
  presentCharacterNames?: readonly string[],
): Promise<Record<string, unknown>> {
  const campaign = await queryRecords(executor, 'campaigns', { limit: 1 })
  if (!campaign.ok) return snapshotFailed(campaign.error)

  const characters = await queryRecords(executor, 'characters', {
    where: { campaignId: DEFAULT_CAMPAIGN_ID },
  })
  if (!characters.ok) return snapshotFailed(characters.error)

  const rolls = await queryRecords(executor, 'roll-logs', {
    where: { campaignId: DEFAULT_CAMPAIGN_ID },
    limit: 10,
  })
  if (!rolls.ok) return snapshotFailed(rolls.error)

  return {
    success: true,
    campaign: campaign.rows[0] ? project(campaign.rows[0], CAMPAIGN_COLUMNS) : null,
    characters: presentCharacters(characters.rows, presentCharacterNames).map((row) =>
      project(row, CHARACTER_COLUMNS),
    ),
    recentRolls: rolls.rows.map((row) => project(row, ROLL_COLUMNS)),
  }
}

/**
 * Runs one GM write: gate first (ADR 0022), then validate and map the input,
 * then the one owner-credentialed mutation implementation. Never throws across
 * the tool boundary — the model gets a refusal object it can narrate around.
 */
async function runGmWrite(
  toolName: GmWriteToolName,
  input: unknown,
  context: AgentToolContext<Env>,
): Promise<unknown> {
  if (!gmToolAllowedForPath(toolName, requestPath(context.request))) {
    return { success: false, code: 'gm_tools_chat_only' }
  }

  const mutation = toGmMutation(toolName, input)
  if (!mutation) {
    return { success: false, code: 'invalid_params', error: `Invalid input for ${toolName}` }
  }

  const { env } = context
  try {
    return await applyGmMutation({
      userId: env.OWNER_USER_ID,
      params: { mutation },
      tools: createActionTools(env, env.OWNER_USER_ID, env.APP_OWNER_JWT),
      env,
      callerJwt: env.APP_OWNER_JWT,
    })
  } catch (error) {
    return { success: false, code: 'gm_write_failed', error: errorMessage(error) }
  }
}

const GM_TOOL_DESCRIPTIONS: Record<GmToolName, string> = {
  get_campaign_snapshot:
    "Read the table's current state: the campaign scene, the stats, HP and already-owed check of every character who is online, and the ten newest roll-log entries. Read-only, and the only way to verify a reported roll.",
  modify_character_hp:
    "Move one character's HP by a delta (negative for damage, positive for healing). The app clamps to 0..maxHp and writes a combat row; use the returned before/after numbers in your narration.",
  grant_character_loot:
    "Put one item into a character's pack and record it as a GM event. Items are consumables (healing) or quest items.",
  update_campaign_scene:
    'Set the current location, atmosphere or enemy for the table, and record a scene change after one. Do not use its activeThreatDc to set a check: a check gets its own DC through request_check. Pass sceneIndex only to advance one scene, after the current scene is over.',
  damage_enemy:
    "Damage the scene's enemy when a narrated attack hits. The app clamps its HP to 0..maxHp and writes a combat row; use the returned before/after numbers in your narration.",
  request_check:
    "Ask one character for one ability check at a steady DC of your choosing (5-30) before you ask for it in prose. The app records the request on that character's row: only that stat is rollable for them, and their sheet shows this DC. Check the snapshot first — a check already pending on their row is live, so never re-arm or change it. Set a different DC for every action.",
}

export function buildTools(executor: ToolExecutor, context: GmToolContext): ToolSet {
  const tools: ToolSet = {}

  for (const def of BUILT_IN_TOOLS) {
    if (!ALLOWED_TOOL_NAMES.includes(def.name)) continue
    const safeName = def.name.replace('.', '_')
    tools[safeName] = tool({
      description: def.description,
      inputSchema: buildInputSchema(def),
      // Apply assistant-only param defaults (e.g. records.query page size) here
      // in the AI tool layer, so internal record readers that hit the tools
      // dispatch directly stay unbounded.
      execute: async (params: Record<string, unknown>) =>
        executor(def.name, applyAiToolDefaults(def.name, params)),
    })
  }

  tools[GM_READ_TOOLS[0]] = tool({
    description: GM_TOOL_DESCRIPTIONS.get_campaign_snapshot,
    inputSchema: z.object({}),
    execute: async () => readCampaignSnapshot(executor, context.presentCharacterNames),
  })

  for (const name of GM_WRITE_TOOLS) {
    tools[name] = tool({
      description: GM_TOOL_DESCRIPTIONS[name],
      inputSchema: gmWriteInputSchemas[name],
      execute: async (input: unknown) => runGmWrite(name, input, context),
    })
  }

  return tools
}

// ============================================================================
// Convert ToolSchema params → Zod validator + derived provider JSON Schema
// ============================================================================

/**
 * The Zod validator is the single source; the provider-facing JSON Schema is
 * derived from it with Zod's native conversion, which keeps z.record()
 * objects open (`additionalProperties: {}`). The AI SDK's own Zod conversion
 * closes every object, which would incorrectly advertise the free-form
 * `data` and `where` objects as empty — so the conversion happens here.
 */
function buildInputSchema(def: ToolSchema) {
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const [name, param] of Object.entries(def.params)) {
    let s: z.ZodTypeAny
    switch (param.type) {
      case 'string':
        s = z.string()
        break
      case 'number':
        s = z.number()
        break
      case 'boolean':
        s = z.boolean()
        break
      case 'object':
        s = z.record(z.string(), z.unknown())
        break
      case 'array':
        s = z.array(z.unknown())
        break
    }
    if (param.description) s = s.describe(param.description)
    if (!param.required) s = s.optional()
    shape[name] = s
  }

  const validator = z.object(shape)
  return jsonSchema<Record<string, unknown>>(
    z.toJSONSchema(validator) as Parameters<typeof jsonSchema>[0],
    {
      validate: async (value) => {
        const result = await validator.safeParseAsync(value)
        return result.success
          ? { success: true, value: result.data }
          : { success: false, error: result.error }
      },
    },
  )
}
