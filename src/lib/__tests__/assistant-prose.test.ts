import { describe, expect, it } from 'vitest'
import { assistantProse } from '@/lib/assistant-prose'

/**
 * `P5.41`: the SDK's `text` is the last step's prose, so a turn that narrated and
 * then called a tool arrives with `text: ''`. Persisting that empty string was
 * rejected by the record layer ("Required field 'content' is missing") and the
 * player's window showed a message with no reply.
 */
describe('assistantProse', () => {
  it('uses the SDK text when it has any', () => {
    expect(assistantProse('  The door holds.  ', [])).toBe('The door holds.')
  })

  it('recovers prose from an earlier step when the last one is tool-only', () => {
    const messages = [
      { role: 'user', content: 'I push the door.' },
      { role: 'assistant', content: [{ type: 'text', text: 'The iron gives a hand.' } , { type: 'tool-call', toolName: 'request_check' }] },
      { role: 'tool', content: [{ type: 'tool-result', result: { success: true } }] },
      { role: 'assistant', content: [{ type: 'tool-call', toolName: 'get_campaign_snapshot' }] },
    ]
    expect(assistantProse('', messages)).toBe('The iron gives a hand.')
  })

  it('joins every narrated step', () => {
    const messages = [
      { role: 'assistant', content: 'First beat.' },
      { role: 'assistant', content: [{ type: 'text', text: 'Second beat.' }] },
    ]
    expect(assistantProse('', messages)).toBe('First beat.\n\nSecond beat.')
  })

  it('returns empty only when the turn truly wrote nothing', () => {
    expect(assistantProse('', [])).toBe('')
    expect(
      assistantProse('', [
        { role: 'assistant', content: [{ type: 'tool-call', toolName: 'request_check' }] },
        { role: 'tool', content: 'ok' },
      ]),
    ).toBe('')
  })

  it('survives malformed message content', () => {
    expect(assistantProse('', [{ role: 'assistant', content: null }, null as never])).toBe('')
  })
})
