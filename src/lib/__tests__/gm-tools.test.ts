import { describe, expect, it } from 'vitest'
import {
  GM_READ_TOOLS,
  GM_TOOL_NAMES,
  GM_WRITE_TOOLS,
  gmToolAllowedForPath,
  toGmMutation,
} from '../gm-tools'

/**
 * The GM tools' pure half (`P5.11`, `P5.12`, ADR 0022).
 *
 * Two claims are pinned here:
 *
 * - a write tool may run **only** on the in-app chat turn, and an unknown tool
 *   name is refused;
 * - a model's arguments become an `applyGmMutation` mutation by explicit field
 *   mapping, never by passing the raw object through — unknown keys are
 *   stripped and invalid enums/lengths are refused.
 */

describe('GM tool names', () => {
  it('names one read tool and three write tools', () => {
    expect(GM_READ_TOOLS).toEqual(['get_campaign_snapshot'])
    expect(GM_WRITE_TOOLS).toEqual([
      'modify_character_hp',
      'grant_character_loot',
      'update_campaign_scene',
    ])
    expect(GM_TOOL_NAMES).toHaveLength(4)
  })
})

describe('gmToolAllowedForPath', () => {
  it('allows the read tool on every path', () => {
    for (const path of [
      '/api/ai/chat',
      '/_deepspace/agent/tools',
      '/api/actions/applyGmMutation',
      '/home',
    ]) {
      expect(gmToolAllowedForPath('get_campaign_snapshot', path)).toBe(true)
    }
  })

  it('allows each write tool only on /api/ai/chat', () => {
    for (const tool of GM_WRITE_TOOLS) {
      expect(gmToolAllowedForPath(tool, '/api/ai/chat')).toBe(true)
      expect(gmToolAllowedForPath(tool, '/_deepspace/agent/tools')).toBe(false)
      expect(gmToolAllowedForPath(tool, '/api/ai/chats')).toBe(false)
      expect(gmToolAllowedForPath(tool, '/api/actions/applyGmMutation')).toBe(false)
      expect(gmToolAllowedForPath(tool, '')).toBe(false)
    }
  })

  it('refuses an unknown tool name', () => {
    expect(gmToolAllowedForPath('records_delete', '/api/ai/chat')).toBe(false)
    expect(gmToolAllowedForPath('', '/api/ai/chat')).toBe(false)
  })
})

describe('toGmMutation', () => {
  it('maps modify_character_hp to a character_hp mutation', () => {
    expect(
      toGmMutation('modify_character_hp', {
        characterId: 'char-1',
        delta: -6,
        reason: 'The blade bites',
      }),
    ).toEqual({
      kind: 'character_hp',
      characterId: 'char-1',
      delta: -6,
      reason: 'The blade bites',
    })
  })

  it('omits an absent reason rather than sending undefined', () => {
    const mutation = toGmMutation('modify_character_hp', { characterId: 'char-1', delta: 4 })

    expect(mutation).toEqual({ kind: 'character_hp', characterId: 'char-1', delta: 4 })
    expect(mutation && 'reason' in mutation).toBe(false)
  })

  it('maps grant_character_loot to a grant_loot mutation with one item', () => {
    expect(
      toGmMutation('grant_character_loot', {
        characterId: 'char-1',
        itemName: 'Sunfire Vial',
        category: 'consumable',
        description: 'Heals 2d4+2',
        quantity: 2,
      }),
    ).toEqual({
      kind: 'grant_loot',
      characterId: 'char-1',
      item: {
        itemName: 'Sunfire Vial',
        category: 'consumable',
        description: 'Heals 2d4+2',
        quantity: 2,
      },
    })
  })

  it('keeps only the fields that arrived on a minimal loot grant', () => {
    expect(
      toGmMutation('grant_character_loot', { characterId: 'char-1', itemName: 'Rusted Key' }),
    ).toEqual({
      kind: 'grant_loot',
      characterId: 'char-1',
      item: { itemName: 'Rusted Key' },
    })
  })

  it('maps update_campaign_scene to an update_scene mutation', () => {
    expect(
      toGmMutation('update_campaign_scene', {
        locationName: 'The Drowned Stair',
        atmosphereTag: 'dungeon',
        activeThreatDc: 14,
        enemyName: 'Gloom Wisp',
        enemyHp: 12,
        enemyMaxHp: 12,
      }),
    ).toEqual({
      kind: 'update_scene',
      scene: {
        locationName: 'The Drowned Stair',
        atmosphereTag: 'dungeon',
        activeThreatDc: 14,
        enemyName: 'Gloom Wisp',
        enemyHp: 12,
        enemyMaxHp: 12,
      },
    })
  })

  it('strips unknown keys instead of forwarding a model object', () => {
    const hp = toGmMutation('modify_character_hp', {
      characterId: 'char-1',
      delta: -6,
      hp: 0,
      campaignId: 'other-campaign',
    })
    expect(hp).toEqual({ kind: 'character_hp', characterId: 'char-1', delta: -6 })

    const scene = toGmMutation('update_campaign_scene', {
      locationName: 'The Ashen Threshold',
      title: 'A new campaign title',
    })
    expect(scene).toEqual({
      kind: 'update_scene',
      scene: { locationName: 'The Ashen Threshold' },
    })
    expect(JSON.stringify(scene)).not.toContain('title')
  })

  it('rejects a reason longer than 200 characters', () => {
    expect(
      toGmMutation('modify_character_hp', {
        characterId: 'char-1',
        delta: -1,
        reason: 'x'.repeat(201),
      }),
    ).toBeNull()
  })

  it('rejects a category outside the schema options', () => {
    expect(
      toGmMutation('grant_character_loot', {
        characterId: 'char-1',
        itemName: 'Crown of Ash',
        category: 'relic',
      }),
    ).toBeNull()
  })

  it('rejects a non-integer delta and a missing characterId', () => {
    expect(toGmMutation('modify_character_hp', { characterId: 'char-1', delta: 1.5 })).toBeNull()
    expect(toGmMutation('modify_character_hp', { delta: -1 })).toBeNull()
    expect(toGmMutation('modify_character_hp', undefined)).toBeNull()
  })

  it('returns null for an unknown tool name', () => {
    expect(toGmMutation('records_update', { collection: 'campaigns' })).toBeNull()
    expect(toGmMutation('get_campaign_snapshot', {})).toBeNull()
  })
})
