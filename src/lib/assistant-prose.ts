/**
 * The prose of an agent turn (`P5.41`).
 *
 * The SDK hands `text` as the **last step's** text. A GM turn can narrate and
 * call a tool in the same response, in which case the final step carries the tool
 * call and no prose — so `text` is empty even though the turn said something. The
 * engine then tried to persist `content: ''`, which the record layer rejects
 * (`Required field 'content' is missing`), and the player's window saw a user
 * message with no reply.
 *
 * `responseMessages` holds every step's assistant message, so the prose is
 * recoverable from there: the text parts, in order, joined by a blank line.
 *
 * Pure: no React, no SDK.
 */

/** The shape this reads, structurally — both the SDK and tests can pass it. */
export type ProseMessage = {
  role?: unknown
  content?: unknown
}

function textOfParts(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const { type, text } = part as { type?: unknown; text?: unknown }
    if (type === 'text' && typeof text === 'string') parts.push(text)
  }
  return parts.join('')
}

/**
 * The turn's prose: the SDK's `text` when it has any, otherwise every assistant
 * message's text parts. Returns `''` only when the turn genuinely wrote nothing —
 * the caller must then skip the write rather than send an empty `content`.
 */
export function assistantProse(text: string, responseMessages: readonly ProseMessage[]): string {
  const direct = typeof text === 'string' ? text.trim() : ''
  if (direct !== '') return direct
  const collected: string[] = []
  for (const message of responseMessages) {
    if (message?.role !== 'assistant') continue
    const prose = textOfParts(message.content).trim()
    if (prose !== '') collected.push(prose)
  }
  return collected.join('\n\n').trim()
}
