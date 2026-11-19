/**
 * Inventory Feature - Schema
 *
 * An item belongs to a **character** for display and to a **user** for
 * authorization. `characterId` is metadata only — the join that renders a pack
 * — while `userId` is the `ownerField`, so `update: 'own'` / `delete: 'own'`
 * mean "an item in your own pack" (ADR 0015, closing the `P2.2` hole where any
 * member could delete any row).
 *
 * `userId` is plain text, not `userBound`: creation is server-side, and the
 * GM's `applyGmMutation` creates loot owned by *another* user, so the action
 * passes the owner explicitly. Members may delete their own rows
 * (`Use`, `Discard`) but cannot create them (ADR 0015/0016).
 *
 * `characterId` is a `reference` for display metadata only — the SDK creates
 * no foreign key and no cascade. Deleting a character leaves its items, so the
 * owner→item join is the client's job (Phase 3).
 */

import type { CollectionSchema } from 'deepspace/schema'

export const inventorySchema: CollectionSchema = {
  name: 'inventory',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'characterId', storage: 'text', interpretation: { kind: 'reference', targetTable: 'characters', displayColumn: 'name' }, required: true },
    { name: 'campaignId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'itemName', storage: 'text', interpretation: 'plain', required: true },
    { name: 'category', storage: 'text', interpretation: { kind: 'select', options: ['weapon', 'armor', 'consumable', 'quest'] }, default: 'quest' },
    { name: 'description', storage: 'text', interpretation: 'plain', default: '' },
    { name: 'quantity', storage: 'number', interpretation: 'plain', default: 1 },
  ],
  ownerField: 'userId',
  permissions: {
    '*': { read: true, create: false, update: false, delete: false },
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
