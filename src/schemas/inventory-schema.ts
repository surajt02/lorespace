/**
 * Inventory Feature - Schema
 *
 * Items belong to a character, not to a user: ownership runs through
 * `characters` (`P2.2`), so this collection deliberately has no `userId`
 * column and members write freely.
 *
 * `characterId` is a `reference` for display metadata only — the SDK creates
 * no foreign key and no cascade. Deleting a character leaves its items, so the
 * owner→item join is the client's job (Phase 3).
 */

import type { CollectionSchema } from 'deepspace/schema'

export const inventorySchema: CollectionSchema = {
  name: 'inventory',
  columns: [
    { name: 'characterId', storage: 'text', interpretation: { kind: 'reference', targetTable: 'characters', displayColumn: 'name' }, required: true },
    { name: 'campaignId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'itemName', storage: 'text', interpretation: 'plain', required: true },
    { name: 'category', storage: 'text', interpretation: { kind: 'select', options: ['weapon', 'armor', 'consumable', 'relic', 'quest'] }, default: 'relic' },
    { name: 'description', storage: 'text', interpretation: 'plain', default: '' },
    { name: 'quantity', storage: 'number', interpretation: 'plain', default: 1 },
  ],
  permissions: {
    '*': { read: true, create: false, update: false, delete: false },
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: true, update: true, delete: true },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
