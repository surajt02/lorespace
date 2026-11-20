/**
 * The seeded campaign row — one source for the scene every table starts in.
 *
 * The scene columns are `sceneColumns(0)` of `campaign-arc.ts` (ADR 0023), not
 * a second copy of them: a fresh seed and a "Start New Campaign" reset open on
 * the same location, atmosphere, summary, DC and enemy state, and neither can
 * drift from the other. `ensureDefaultCampaign` (ADR 0007) writes this row and
 * the signed-out preview (`PREVIEW_CAMPAIGN`) renders it.
 *
 * No React and no `deepspace` import — worker code imports this module.
 */

import { sceneColumns } from './campaign-arc'
import type { CampaignAtmosphereTag } from './campaign-arc'

/** `campaigns` — the columns registered in `campaigns-schema.ts`. */
export interface CampaignRow {
  title: string
  sceneIndex: number
  locationName: string
  atmosphereTag: string
  sceneSummary: string
  activeThreatDc: number
  enemyName: string
  enemyHp: number
  enemyMaxHp: number
  /**
   * The table's round (ADR 0031). Additive: a row written before rounds existed
   * reads as absent, and the console then claims no move for anybody.
   */
  roundNumber?: number
  /**
   * The newest `roll-logs` creation time already handed to the model (ADR 0031,
   * amended 2026-11-20), as epoch milliseconds. `0` means no roll turn yet.
   */
  lastRollTurnAt?: number
}

/**
 * ADR 0023's first scene — the threshold: Act I, exploration, DC 12, no enemy in
 * play. The dungeon/Sentinel states arrive through scene progression, not
 * through the seed.
 */
export const DEFAULT_CAMPAIGN_SEED: CampaignRow = {
  title: 'Chronicles of the Obsidian Vault',
  ...sceneColumns(0),
}

/** `campaigns.atmosphereTag`'s select options, in schema order. */
const ATMOSPHERE_TAGS: readonly CampaignAtmosphereTag[] = [
  'exploration',
  'combat',
  'tavern',
  'dungeon',
  'boss',
]

/**
 * Guards `applyGmMutation`'s `update_scene`: the schema's select would refuse
 * any other tag, and a selective write must not fail the whole mutation for a
 * value the caller could have checked up front.
 */
export function isAtmosphereTag(value: string): boolean {
  return (ATMOSPHERE_TAGS as readonly string[]).includes(value)
}
