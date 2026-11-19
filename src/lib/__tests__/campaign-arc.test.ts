import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_ARC,
  SCENE_COUNT,
  progressLabel,
  sceneAt,
  sceneColumns,
} from '../campaign-arc'
import { DEFAULT_CAMPAIGN_SEED } from '../campaign-seed'

/**
 * The arc is the engine's half of the story (ADR 0023): five scenes, three
 * acts, and an exit the model cannot talk its way past. These tests pin the
 * shape the scene advance reads and the columns a reset writes — a sixth scene,
 * an enemy on a `check` scene or a DC outside the d20's reach would each be a
 * silent rules change.
 */
describe('CAMPAIGN_ARC', () => {
  it('has five scenes across three acts, in order', () => {
    expect(SCENE_COUNT).toBe(5)
    expect(CAMPAIGN_ARC.map((scene) => scene.title)).toEqual([
      'The Threshold',
      'The Rune-Ward',
      'The Sentinel',
      'The Sealed Door',
      'The Vault',
    ])
    expect(CAMPAIGN_ARC.map((scene) => scene.act)).toEqual([
      'Act I',
      'Act I',
      'Act II',
      'Act II',
      'Act III',
    ])
    // Acts never go backwards: a scene may repeat the act before it, never an
    // earlier one, and each act group is contiguous.
    const indexes = CAMPAIGN_ARC.map((scene) => scene.actIndex)
    expect(indexes).toEqual([0, 0, 1, 1, 2])
  })

  it('gives every defeat scene an enemy and every check scene none', () => {
    for (const scene of CAMPAIGN_ARC) {
      if (scene.exit === 'defeat') {
        expect(scene.enemyName).not.toBe('')
        expect(scene.enemyMaxHp).toBeGreaterThan(0)
      } else {
        expect(scene.enemyName).toBe('')
        expect(scene.enemyMaxHp).toBe(0)
      }
    }
    // At least one of each: a `defeat`-only arc would have no scene for the
    // Sentinel to stand in front of.
    expect(CAMPAIGN_ARC.some((scene) => scene.exit === 'defeat')).toBe(true)
    expect(CAMPAIGN_ARC.some((scene) => scene.exit === 'check')).toBe(true)
  })

  it('keeps every scene DC inside the d20 range', () => {
    for (const scene of CAMPAIGN_ARC) {
      expect(scene.activeThreatDc).toBeGreaterThanOrEqual(5)
      expect(scene.activeThreatDc).toBeLessThanOrEqual(20)
    }
  })

  it('writes copy and atmosphere, never a placeholder', () => {
    for (const scene of CAMPAIGN_ARC) {
      expect(scene.sceneSummary.length).toBeGreaterThan(20)
      expect(scene.locationName).not.toBe('')
      expect(scene.title).not.toBe('')
      expect(['exploration', 'combat', 'tavern', 'dungeon', 'boss']).toContain(
        scene.atmosphereTag,
      )
    }
  })
})

describe('sceneAt', () => {
  it('returns the scene at a valid index', () => {
    expect(sceneAt(0)?.title).toBe('The Threshold')
    expect(sceneAt(4)?.title).toBe('The Vault')
  })

  it('returns null outside the arc', () => {
    expect(sceneAt(-1)).toBeNull()
    expect(sceneAt(5)).toBeNull()
    expect(sceneAt(1.5)).toBeNull()
  })
})

describe('sceneColumns', () => {
  it('sets enemy HP equal to the enemy max only for a defeat scene', () => {
    const sentinel = sceneColumns(2)
    expect(sentinel.enemyName).toBe('Runebound Sentinel')
    expect(sentinel.enemyMaxHp).toBe(24)
    expect(sentinel.enemyHp).toBe(24)
    expect(sentinel.atmosphereTag).toBe('combat')

    for (const index of [0, 1, 3, 4]) {
      const columns = sceneColumns(index)
      expect(columns.enemyName).toBe('')
      expect(columns.enemyMaxHp).toBe(0)
      expect(columns.enemyHp).toBe(0)
    }
  })

  it('carries the scene index with the scene content', () => {
    for (const [index] of CAMPAIGN_ARC.entries()) {
      expect(sceneColumns(index).sceneIndex).toBe(index)
    }
  })

  it('agrees with the seed at scene 0, column for column', () => {
    const seedScene: Record<string, unknown> = { ...DEFAULT_CAMPAIGN_SEED }
    delete seedScene.title
    expect(sceneColumns(0)).toEqual(seedScene)
    // The seed is scene 0 plus a title — nothing else, and not a hardcoded
    // second copy of the threshold that could drift from the arc.
    expect(Object.keys(seedScene).sort()).toEqual(Object.keys(sceneColumns(0)).sort())
    expect(DEFAULT_CAMPAIGN_SEED.locationName).toBe('The Ashen Threshold')
    expect(DEFAULT_CAMPAIGN_SEED.activeThreatDc).toBe(12)
    expect(DEFAULT_CAMPAIGN_SEED.atmosphereTag).toBe('exploration')
    expect(DEFAULT_CAMPAIGN_SEED.sceneIndex).toBe(0)
  })

  it('throws outside the arc, where sceneAt reports null instead', () => {
    expect(() => sceneColumns(5)).toThrow(RangeError)
    expect(() => sceneColumns(-1)).toThrow(RangeError)
  })
})

describe('progressLabel', () => {
  it('labels the first and last scene of the arc', () => {
    expect(progressLabel(0)).toBe('Act I · Scene 1 of 5')
    expect(progressLabel(2)).toBe('Act II · Scene 3 of 5')
    expect(progressLabel(4)).toBe('Act III · Scene 5 of 5')
  })

  it('is empty outside the arc', () => {
    expect(progressLabel(-1)).toBe('')
    expect(progressLabel(SCENE_COUNT)).toBe('')
  })
})
