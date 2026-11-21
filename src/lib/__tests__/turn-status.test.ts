import { describe, expect, it } from 'vitest'
import { moveDue, ownsRollTurn, waitingLabel } from '@/lib/turn-status'

/**
 * `P5.34`/`P5.37`: the line means "the table is waiting on you", not "you are
 * behind the round". It reads the thread, so it clears when you move and never
 * appears on a solo table.
 */
function gm(at: string) {
  return { role: 'assistant', characterName: 'Game Master', createdAt: at }
}
function move(who: string, at: string) {
  return { role: 'user', characterName: who, createdAt: at }
}
const beat = (at: string) => ({ role: 'user', characterName: '__beat__', createdAt: at })

describe('moveDue', () => {
  it('is due when the GM has spoken since your last move', () => {
    const events = [gm('2026-01-01T00:00:00Z')]
    expect(moveDue({ events, myName: 'Vesper' })).toBe(true)
  })

  it('clears the moment you move', () => {
    const events = [gm('2026-01-01T00:00:00Z'), move('Vesper', '2026-01-01T00:00:05Z')]
    expect(moveDue({ events, myName: 'Vesper' })).toBe(false)
    // The other player still owes theirs.
    expect(moveDue({ events, myName: 'Kaelen' })).toBe(true)
  })

  it('comes back when the GM answers', () => {
    const events = [
      gm('2026-01-01T00:00:00Z'),
      move('Vesper', '2026-01-01T00:00:05Z'),
      gm('2026-01-01T00:00:10Z'),
    ]
    expect(moveDue({ events, myName: 'Vesper' })).toBe(true)
  })

  it('applies on a solo table too', () => {
    const events = [gm('2026-01-01T00:00:00Z'), move('Vesper', '2026-01-01T00:00:05Z')]
    expect(moveDue({ events, myName: 'Vesper' })).toBe(false)
    const after = [...events, gm('2026-01-01T00:00:10Z')]
    expect(moveDue({ events: after, myName: 'Vesper' })).toBe(true)
  })

  it('is due before the story opens, and needs a name', () => {
    expect(moveDue({ events: [], myName: 'Vesper' })).toBe(true)
    expect(moveDue({ events: [], myName: undefined })).toBe(false)
  })

  it('ignores beats, empty names and unreadable timestamps', () => {
    const events = [
      gm('2026-01-01T00:00:00Z'),
      move('Vesper', '2026-01-01T00:00:05Z'),
      beat('2026-01-01T00:00:06Z'),
      { role: 'user', characterName: 'Kaelen', createdAt: 'not a date' },
    ]
    expect(moveDue({ events, myName: 'Vesper' })).toBe(false)
  })

  it('keeps the label lowercase for CSS to uppercase', () => {
    expect(waitingLabel()).toBe('awaiting your move…')
  })
})

