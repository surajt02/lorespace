/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 *
 * Messaging drop-in schemas (CHANNELS_SCHEMA, MESSAGES_SCHEMA, REACTIONS_SCHEMA,
 * CHANNEL_MEMBERS_SCHEMA, READ_RECEIPTS_SCHEMA) are deliberately not registered
 * until a feature reads them (`D2`). Adding one later is a one-line change:
 * 0.44.2 runs `CREATE TABLE IF NOT EXISTS` at RecordRoom init.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { campaignsSchema } from './schemas/campaigns-schema'
import { charactersSchema } from './schemas/characters-schema'
import { inventorySchema } from './schemas/inventory-schema'
import { rollLogsSchema } from './schemas/roll-logs-schema'
import { gmMessagesSchema } from './schemas/gm-messages-schema'

import { aiChatSchemas } from './schemas/ai-chat-schema'

export const schemas: CollectionSchema[] = [
  ...aiChatSchemas,
  usersSchema,
  settingsSchema,
  campaignsSchema,
  charactersSchema,
  inventorySchema,
  rollLogsSchema,
  gmMessagesSchema,
]
