import { describe, expect, it } from 'vitest'
import { isMechanicsSentence, stripMechanicsTalk } from '@/lib/mechanics-talk'

/**
 * `P5.48`: the model sometimes narrates its own bookkeeping. The player must not
 * see it, so machinery sentences are removed from the finished turn.
 */
describe('isMechanicsSentence', () => {
  it('catches the leaks seen live', () => {
    expect(
      isMechanicsSentence('I armed the WIS check for Mr. Peanut at DC 13; no check was owed on their row before this.'),
    ).toBe(true)
    expect(
      isMechanicsSentence('The snapshot shows the WIS check is already owed to Mr. Peanut at DC 13, and it is live, so I have left it alone.'),
    ).toBe(true)
  })

  it('catches bare apparatus words', () => {
    expect(isMechanicsSentence('The pendingStat on their row is empty.')).toBe(true)
    expect(isMechanicsSentence('I will call request_check now.')).toBe(true)
    expect(isMechanicsSentence('Nothing in the roll-logs answers that.')).toBe(true)
  })

  it('leaves in-world prose alone, including an ask with a number', () => {
    expect(isMechanicsSentence('Beneath the flagstones, a dark bar runs toward the brazier.')).toBe(false)
    expect(isMechanicsSentence('Roll WIS against 13 to feel the wrongness in the air.')).toBe(false)
  })
})

describe('stripMechanicsTalk', () => {
  it('keeps the narration and drops the bookkeeping', () => {
    const prose = [
      'The iron gives a low groan and the seam widens.',
      'I armed the WIS check for Mr. Peanut at DC 13; no check was owed on their row before this.',
      'Cold air spills through, carrying the smell of wet stone.',
    ].join(' ')
    const { text, removed } = stripMechanicsTalk(prose)
    expect(removed).toBe(1)
    expect(text).toContain('The iron gives a low groan')
    expect(text).toContain('Cold air spills through')
    expect(text).not.toContain('armed')
    expect(text).not.toContain('DC 13')
  })

  it('returns empty when the whole turn was machinery', () => {
    const { text, removed } = stripMechanicsTalk(
      'The snapshot shows the check is owed. I left it alone.',
    )
    expect(removed).toBe(2)
    expect(text).toBe('')
  })

  it('keeps paragraphs when nothing is stripped', () => {
    const prose = 'First beat.\n\nSecond beat.'
    expect(stripMechanicsTalk(prose)).toEqual({ text: 'First beat.\n\nSecond beat.', removed: 0 })
  })
})
