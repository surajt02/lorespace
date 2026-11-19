/**
 * The campaign arc — five scenes across three acts, as pure data (ADR 0023).
 *
 * This module is the scaffold the GM expands inside: the model chooses DCs,
 * damage and prose within a scene, but the arc itself — how many scenes there
 * are, what each one is, and what closes it — is code, not content. That is how
 * "Act I · Scene 2 of 5" becomes representable and how the engine, not the
 * model, decides when a scene is over (ADR 0009).
 *
 * `sceneColumns` speaks the `campaigns` row's own column names, so
 * `startCampaign` (scene 0) and an engine-gated scene advance write the same
 * eight values in the same order. The one rule the mapping encodes: an enemy
 * exists only for a `defeat` scene, and it starts at full HP.
 *
 * No SDK, no React and no randomness: worker code imports this module.
 */

/** `campaigns.atmosphereTag`'s select options, in schema order. */
export type CampaignAtmosphereTag = 'exploration' | 'combat' | 'tavern' | 'dungeon' | 'boss'

/** What ends a scene: one successful check at the scene DC, or the enemy at 0. */
export type CampaignSceneExit = 'check' | 'defeat'

/** One scene of the scaffold: what it is, where it is, and what closes it. */
export interface CampaignScene {
  /** The act's label, as the banner and the GM brief render it. */
  act: string
  /** Zero-based act position, so Act I is `0`. */
  actIndex: number
  /** The scene's name in the arc ("The Sentinel"). */
  title: string
  locationName: string
  atmosphereTag: CampaignAtmosphereTag
  sceneSummary: string
  activeThreatDc: number
  /** Empty for a scene with no enemy; a `defeat` scene always names one. */
  enemyName: string
  /** `0` for a scene with no enemy. */
  enemyMaxHp: number
  exit: CampaignSceneExit
}

/**
 * The `campaigns` columns one scene sets. `sceneIndex` is the position in the
 * arc (ADR 0023's one new column), and it is part of this shape so a writer
 * cannot set a scene's content and forget where the table is.
 */
export interface CampaignSceneColumns {
  sceneIndex: number
  locationName: string
  atmosphereTag: CampaignAtmosphereTag
  sceneSummary: string
  activeThreatDc: number
  enemyName: string
  enemyHp: number
  enemyMaxHp: number
}

/**
 * The arc, in play order.
 *
 * Scene 1 is the seed row's own threshold (same location, summary and DC), so a
 * fresh table and a reset table open on the same words. The Sentinel carries
 * ADR 0011's Runebound Sentinel — the one enemy the rules depth allows
 * (ADR 0010) — and every `defeat` scene is followed by a `check` scene, so a
 * fight is always something the table earns its way into and out of.
 */
export const CAMPAIGN_ARC: readonly CampaignScene[] = [
  {
    act: 'Act I',
    actIndex: 0,
    title: 'The Threshold',
    locationName: 'The Ashen Threshold',
    atmosphereTag: 'exploration',
    sceneSummary:
      'Ash drifts across a broken causeway. Runic fire burns green in the braziers, and a sealed door waits beyond them.',
    activeThreatDc: 12,
    enemyName: '',
    enemyMaxHp: 0,
    exit: 'check',
  },
  {
    act: 'Act I',
    actIndex: 0,
    title: 'The Rune-Ward',
    locationName: 'The Rune-Ward',
    atmosphereTag: 'dungeon',
    sceneSummary:
      'A ward of cold script bars the causeway, and the green fire bends toward it whenever a hand comes close. The door beyond stays shut until the runes are read.',
    activeThreatDc: 13,
    enemyName: '',
    enemyMaxHp: 0,
    exit: 'check',
  },
  {
    act: 'Act II',
    actIndex: 1,
    title: 'The Sentinel',
    locationName: 'The Sunken Reliquary',
    atmosphereTag: 'combat',
    sceneSummary:
      'The ward breaks and the hall floods with green light. Something armoured in old bronze stands between the party and the door: the Runebound Sentinel, and it has been waiting.',
    activeThreatDc: 13,
    enemyName: 'Runebound Sentinel',
    enemyMaxHp: 24,
    exit: 'defeat',
  },
  {
    act: 'Act II',
    actIndex: 1,
    title: 'The Sealed Door',
    locationName: 'The Sealed Door',
    atmosphereTag: 'dungeon',
    sceneSummary:
      'Beyond the sentinel, the sealed door is a slab of black stone with a single rune-shaped keyhole. The braziers gutter; whatever answers the door will not wait long.',
    activeThreatDc: 15,
    enemyName: '',
    enemyMaxHp: 0,
    exit: 'check',
  },
  {
    act: 'Act III',
    actIndex: 2,
    title: 'The Vault',
    locationName: 'The Obsidian Vault',
    atmosphereTag: 'boss',
    sceneSummary:
      'The door gives onto a vault no torch has touched: shelves of black glass, a stone plinth, and the thing the sentinel was bound to guard. This is the end of the run, one way or the other.',
    activeThreatDc: 14,
    enemyName: '',
    enemyMaxHp: 0,
    exit: 'check',
  },
]

/** Five scenes, in the order the engine checks them. */
export const SCENE_COUNT = CAMPAIGN_ARC.length

/**
 * The scene at `index`, or `null` outside the arc.
 *
 * Every reader that takes an index from a row (not a literal) goes through
 * here: `sceneIndex` is a number column, so a stale or hand-edited value must
 * be a refusal to narrate, never a crash.
 */
export function sceneAt(index: number): CampaignScene | null {
  if (!Number.isInteger(index) || index < 0 || index >= SCENE_COUNT) return null
  return CAMPAIGN_ARC[index] ?? null
}

/**
 * The exact `campaigns` columns for scene `index`.
 *
 * Throws for an index outside the arc: every caller is a literal or a value
 * `sceneAt` already validated, so an out-of-range index is a programming error,
 * not a user input. Use `sceneAt` when the index comes from a record.
 */
export function sceneColumns(index: number): CampaignSceneColumns {
  const scene = sceneAt(index)
  if (!scene) throw new RangeError(`No campaign scene at index ${index}`)
  const hasEnemy = scene.exit === 'defeat'
  return {
    sceneIndex: index,
    locationName: scene.locationName,
    atmosphereTag: scene.atmosphereTag,
    sceneSummary: scene.sceneSummary,
    activeThreatDc: scene.activeThreatDc,
    enemyName: hasEnemy ? scene.enemyName : '',
    enemyHp: hasEnemy ? scene.enemyMaxHp : 0,
    enemyMaxHp: hasEnemy ? scene.enemyMaxHp : 0,
  }
}

/**
 * Where the table is, as the banner and the GM's evidence rows say it:
 * `'Act I · Scene 2 of 5'`. Empty outside the arc, matching `sceneAt`'s
 * "nothing to show" rather than inventing a position.
 */
export function progressLabel(index: number): string {
  const scene = sceneAt(index)
  if (!scene) return ''
  return `${scene.act} · Scene ${index + 1} of ${SCENE_COUNT}`
}
