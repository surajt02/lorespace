/**
 * Roll Logs Feature - Schema
 *
 * Append-only feed of table events: dice rolls, actions, GM events and combat.
 *
 * The timestamp column is `rolledAt`, not a second creation-time column
 * (ADR 0003). The SDK already maintains `_created_at` on every row, and
 * `orderBy` with a creation-style name resolves to that system column — so a
 * custom one would be both unsortable and redundant. Order the feed by
 * `_created_at`, display `rolledAt`.
 *
 * `timestampTrigger.field` is `summary`: `summary` is required, so every row
 * that passes validation gets stamped, and a hand-seeded row without one gets
 * no `rolledAt` rather than a misleading zero.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const rollLogsSchema: CollectionSchema = {
  name: 'roll-logs',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'campaignId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'characterName', storage: 'text', interpretation: 'plain', required: true },
    { name: 'entryType', storage: 'text', interpretation: { kind: 'select', options: ['roll', 'action', 'gm_event', 'combat'] }, required: true },
    { name: 'statName', storage: 'text', interpretation: 'plain', default: '' },
    { name: 'rawRoll', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'modifier', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'total', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'targetDc', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'outcome', storage: 'text', interpretation: { kind: 'select', options: ['critical_success', 'success', 'failure', 'critical_failure', 'info'] }, default: 'info' },
    { name: 'summary', storage: 'text', interpretation: 'plain', required: true },
    { name: 'rolledAt', storage: 'number', interpretation: { kind: 'datetime' }, timestampTrigger: { field: 'summary' } },
  ],
  ownerField: 'userId',
  permissions: {
    '*': { read: true, create: false, update: false, delete: false },
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
