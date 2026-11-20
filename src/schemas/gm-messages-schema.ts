/**
 * GM Messages Feature - Schema
 *
 * The **shared table thread**: one GM conversation per campaign, read by every
 * player at the table and by the signed-out window (ADR 0014 keeps the table
 * readable by link, and the GM's narration is the table's story, not a private
 * one). It replaces the per-player `ai-messages` transcript as the console's
 * source, because two private chats narrate one roll twice.
 *
 * The Worker is the only writer, exactly like `roll-logs`: members read the
 * thread, they never write it. A message the browser could create would be a
 * message that never went to the model, and the thread would stop being a
 * record of what the GM was actually told.
 *
 * `characterName` names who spoke (empty for the GM), so the panel can label a
 * row without a second read, and `parts` keeps the AI SDK message payload for
 * the same reason the SDK's `ai-messages` does.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const gmMessagesSchema: CollectionSchema = {
  name: 'gm-messages',
  columns: [
    { name: 'campaignId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    {
      name: 'role',
      storage: 'text',
      interpretation: { kind: 'select', options: ['user', 'assistant'] },
      required: true,
    },
    // The speaking character ("Joeblo"); empty on the GM's rows.
    { name: 'characterName', storage: 'text', interpretation: 'plain', default: '' },
    { name: 'content', storage: 'text', interpretation: 'plain', required: true },
    // The AI SDK message parts, verbatim (`storage: 'text'` + json, as the SDK's
    // own `ai-messages` declares them).
    { name: 'parts', storage: 'text', interpretation: { kind: 'json' } },
  ],
  permissions: {
    '*': { read: true, create: false, update: false, delete: false },
    // Signed-out is the anonymous role: it reads the table's story.
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
