/**
 * Campaigns Feature - Schema
 *
 * The single shared campaign every player reads. `DEFAULT_CAMPAIGN_ID` names
 * the seeded record (Phase 2); this file only declares the columns.
 *
 * `'*'` and `viewer` both carry read-only access on purpose: `viewer` is the
 * anonymous role today, `'*'` is the SDK's catch-all fallback for any role
 * added later. Members play (update), they do not delete the campaign.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const campaignsSchema: CollectionSchema = {
  name: 'campaigns',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain', required: true },
    { name: 'locationName', storage: 'text', interpretation: 'plain', default: 'The Ashen Threshold' },
    { name: 'atmosphereTag', storage: 'text', interpretation: { kind: 'select', options: ['exploration', 'combat', 'tavern', 'dungeon', 'boss'] }, default: 'exploration' },
    { name: 'sceneSummary', storage: 'text', interpretation: 'plain', default: '' },
    { name: 'activeThreatDc', storage: 'number', interpretation: 'plain', default: 12 },
    { name: 'enemyName', storage: 'text', interpretation: 'plain', default: '' },
    { name: 'enemyHp', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'enemyMaxHp', storage: 'number', interpretation: 'plain', default: 0 },
  ],
  permissions: {
    '*': { read: true, create: false, update: false, delete: false },
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: true, update: true, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
