/**
 * Characters Feature - Schema
 *
 * One character per user per campaign. `userId` is `userBound` (the SDK stamps
 * it, a client cannot spoof it) and `ownerField` points at it, which is what
 * lets "the player's own character" be resolved for reads.
 *
 * Members never write this collection (ADR 0015): forging a character and
 * every stat change go through the bearer actions in `src/actions/index.ts`,
 * which run with per-record RBAC off and check ownership themselves. The
 * browser therefore cannot set `hp`, `ac`, or `userId` at all.
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
    { name: 'archetype', storage: 'text', interpretation: { kind: 'select', options: ['Vanguard', 'Shadowblade', 'Arcanist', 'Marksman'] }, required: true },
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
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
