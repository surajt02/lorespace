/**
 * Characters Feature - Schema
 *
 * One character per user per campaign. `userId` is `userBound` (the SDK stamps
 * it, a client cannot spoof it) and `ownerField` points at it, which is what
 * makes `update: 'own'` / `delete: 'own'` mean "the player's own character".
 *
 * `uniqueOn` is enforced by the record layer's duplicate pre-check (a hard
 * refusal); the DDL unique index alone is warn-only.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const charactersSchema: CollectionSchema = {
  name: 'characters',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true, required: true },
    { name: 'campaignId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    { name: 'archetype', storage: 'text', interpretation: { kind: 'select', options: ['Vanguard', 'Shadowblade', 'Arcanist', 'Cleric'] }, required: true },
    { name: 'hp', storage: 'number', interpretation: 'plain', required: true },
    { name: 'maxHp', storage: 'number', interpretation: 'plain', required: true },
    { name: 'ac', storage: 'number', interpretation: 'plain', required: true },
    { name: 'str', storage: 'number', interpretation: 'plain', required: true },
    { name: 'dex', storage: 'number', interpretation: 'plain', required: true },
    { name: 'con', storage: 'number', interpretation: 'plain', required: true },
    { name: 'int', storage: 'number', interpretation: 'plain', required: true },
    { name: 'wis', storage: 'number', interpretation: 'plain', required: true },
    { name: 'cha', storage: 'number', interpretation: 'plain', required: true },
  ],
  ownerField: 'userId',
  uniqueOn: ['userId', 'campaignId'],
  permissions: {
    '*': { read: true, create: false, update: false, delete: false },
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
