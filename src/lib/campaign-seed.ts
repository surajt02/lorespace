/**
 * The seeded campaign row — one source for the scene every table starts in.
 *
 * `ensureDefaultCampaign` (ADR 0007) writes this row and the signed-out preview
 * (`PREVIEW_CAMPAIGN`) renders it, so both import from here: an edit reaches
 * the live seed and the fixture together instead of letting them drift.
 *
 * No React and no `deepspace` import — worker code imports this module.
 */

/** `campaigns` — the eight columns registered in `campaigns-schema.ts`. */
export interface CampaignRow {
  title: string
  locationName: string
  atmosphereTag: string
  sceneSummary: string
  activeThreatDc: number
  enemyName: string
  enemyHp: number
  enemyMaxHp: number
}

/**
 * ADR 0011's first scene state — the threshold: exploration, DC 12, no enemy
 * in play. The dungeon/Sentinel state arrives later through `update_scene`,
 * not through the seed.
 */
export const DEFAULT_CAMPAIGN_SEED: CampaignRow = {
  title: 'Chronicles of the Obsidian Vault',
  locationName: 'The Ashen Threshold',
  atmosphereTag: 'exploration',
  sceneSummary:
    'Ash drifts across a broken causeway. Runic fire burns green in the braziers, and a sealed door waits beyond them.',
  activeThreatDc: 12,
  enemyName: '',
  enemyHp: 0,
  enemyMaxHp: 0,
}

/** `campaigns.atmosphereTag`'s select options, in schema order. */
const ATMOSPHERE_TAGS: readonly string[] = [
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
  return ATMOSPHERE_TAGS.includes(value)
}
