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
 * The pending check is no longer here: it belongs to a character
 * (`characters.pendingStat` / `pendingDc`, ADR 0030), because two players can
 * each owe their own roll and one campaign-wide slot blocked or overwrote them.
 * `sceneIndex` and the scene columns are the whole of the shared state now,
 * plus the round.
 *
 * `roundNumber` is the table's round (ADR 0031): a player's turn stamps
 * `characters.actedRound` with it, and the engine increments it once every
 * online character has acted. Nothing else advances it — no timer, no idle
 * turn. It is additive with a default, so existing rows read as round 1.
 *
 * `lastRollTurnAt` is the roll cursor (ADR 0031, amended 2026-11-20): the
 * creation time of the newest `roll-logs` row already handed to the model, as
 * epoch milliseconds. The route claims a batch by writing it **before** it
 * streams, so every open window can ask for the roll turn and exactly one of
 * them finds new rows. `0` means "no roll has been answered in this game", and
 * a row without a `createdAt` sorts older than any cursor. Additive with a
 * default, like the round.
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
    { name: 'roundNumber', storage: 'number', interpretation: 'plain', default: 1 },
    { name: 'lastRollTurnAt', storage: 'number', interpretation: 'plain', default: 0 },
  ],
  permissions: {
    '*': { read: true, create: false, update: false, delete: false },
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: true, update: true, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
