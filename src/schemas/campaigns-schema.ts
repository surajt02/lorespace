/**
 * Campaigns Feature - Schema
 *
 * The single shared campaign every player reads. `DEFAULT_CAMPAIGN_ID` names
 * the seeded record (Phase 2); this file only declares the columns.
 *
 * `sceneIndex` is where the table is in the five-scene arc (ADR 0023): the
 * position, not the content — location, DC and enemy stay in the columns
 * ADR 0011 named, and `src/lib/campaign-arc.ts` is the one thing that maps an
 * index onto them. It is additive with a default, so existing rows read as
 * scene 0.
 *
 * The `pending*` trio is the one check the GM has asked for and the table has
 * not rolled yet (`P5.19`): the character it belongs to, the ability key, and
 * its own DC. It is deliberately on the campaign rather than derived from the
 * GM's prose — the sheet has to know which stat is live, and `rollSkillCheck`
 * has to refuse everything else. Empty stat / `0` DC means "nothing pending",
 * which is also the state a roll, a scene advance and a reset return it to.
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
    { name: 'sceneIndex', storage: 'number', interpretation: 'plain', default: 0 },
    // The pending check (`P5.19`): one action, one DC, one character. `''` stat
    // is the "nothing pending" sentinel the select's `default` carries — the
    // same convention `roll-logs.statName` uses, since select options are UI
    // metadata rather than a write-time constraint.
    { name: 'pendingCharacterId', storage: 'text', interpretation: 'plain', default: '' },
    {
      name: 'pendingStat',
      storage: 'text',
      interpretation: { kind: 'select', options: ['str', 'dex', 'con', 'int', 'wis', 'cha'] },
      default: '',
    },
    { name: 'pendingDc', storage: 'number', interpretation: 'plain', default: 0 },
  ],
  permissions: {
    '*': { read: true, create: false, update: false, delete: false },
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: true, update: true, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
