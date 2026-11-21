import { describe, expect, it } from 'vitest'
import { awaitingMyMove, canContinue, ownsRollTurn, waitingLabel } from '@/lib/turn-status'

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

describe('awaitingMyMove', () => {
  it('shows when someone else moved after the GM and you have not', () => {
    const events = [gm('2026-01-01T00:00:00Z'), move('Kaelen', '2026-01-01T00:00:05Z')]
    expect(awaitingMyMove({ events, myName: 'Vesper' })).toBe(true)
  })

  it('hides the moment you move', () => {
    const events = [
      gm('2026-01-01T00:00:00Z'),
      move('Kaelen', '2026-01-01T00:00:05Z'),
      move('Vesper', '2026-01-01T00:00:09Z'),
    ]
    expect(awaitingMyMove({ events, myName: 'Vesper' })).toBe(false)
  })

  it('hides for the player who moved first, shows for the other', () => {
    const events = [gm('2026-01-01T00:00:00Z'), move('Vesper', '2026-01-01T00:00:05Z')]
    // Vesper has just moved: nothing is owed by her.
    expect(awaitingMyMove({ events, myName: 'Vesper' })).toBe(false)
    // Kaelen has not: the table is on him.
    expect(awaitingMyMove({ events, myName: 'Kaelen' })).toBe(true)
  })

  it('never shows on a solo table', () => {
    const events = [gm('2026-01-01T00:00:00Z'), move('Vesper', '2026-01-01T00:00:05Z')]
    expect(awaitingMyMove({ events, myName: 'Vesper' })).toBe(false)
  })

  it('clears once the GM answers both moves', () => {
    const events = [
      gm('2026-01-01T00:00:00Z'),
      move('Kaelen', '2026-01-01T00:00:05Z'),
      gm('2026-01-01T00:00:10Z'),
    ]
    expect(awaitingMyMove({ events, myName: 'Vesper' })).toBe(false)
  })

  it('ignores beats, empty names and unreadable timestamps', () => {
    const events = [
      gm('2026-01-01T00:00:00Z'),
      beat('2026-01-01T00:00:05Z'),
      { role: 'user', characterName: '', createdAt: '2026-01-01T00:00:06Z' },
      { role: 'user', characterName: 'Kaelen', createdAt: 'not a date' },
    ]
    expect(awaitingMyMove({ events, myName: 'Vesper' })).toBe(false)
  })

  it('needs a name to wait on', () => {
    const events = [gm('2026-01-01T00:00:00Z'), move('Kaelen', '2026-01-01T00:00:05Z')]
    expect(awaitingMyMove({ events, myName: undefined })).toBe(false)
    expect(awaitingMyMove({ events, myName: '  ' })).toBe(false)
  })

  it('keeps the label lowercase for CSS to uppercase', () => {
    expect(waitingLabel()).toBe('awaiting your move…')
  })
})

describe('ownsRollTurn', () => {
  it('only the roller window asks', () => {
    expect(ownsRollTurn({ newestRollName: 'Vesper', myName: 'Vesper' })).toBe(true)
    expect(ownsRollTurn({ newestRollName: 'Vesper', myName: 'Kaelen' })).toBe(false)
  })

  it('lets an unattributed roll or a viewer without a character ask', () => {
    expect(ownsRollTurn({ newestRollName: '', myName: 'Kaelen' })).toBe(true)
    expect(ownsRollTurn({ newestRollName: 'Vesper', myName: undefined })).toBe(true)
  })

  it('ignores whitespace', () => {
    expect(ownsRollTurn({ newestRollName: ' Vesper ', myName: 'Vesper' })).toBe(true)
  })
})

describe('canContinue', () => {
  it('offers the pass while a move is outstanding', () => {
    const events = [gm('2026-01-01T00:00:00Z')]
    expect(canContinue({ events, myName: 'Vesper' })).toBe(true)
  })

  it('hides it once this player has moved since the GM spoke', () => {
    const events = [gm('2026-01-01T00:00:00Z'), move('Vesper', '2026-01-01T00:00:05Z')]
    expect(canContinue({ events, myName: 'Vesper' })).toBe(false)
    // The other player still owes theirs.
    expect(canContinue({ events, myName: 'Kaelen' })).toBe(true)
  })

  it('offers it again after the GM answers', () => {
    const events = [
      gm('2026-01-01T00:00:00Z'),
      move('Vesper', '2026-01-01T00:00:05Z'),
      gm('2026-01-01T00:00:10Z'),
    ]
    expect(canContinue({ events, myName: 'Vesper' })).toBe(true)
  })

  it('offers it before the story opens', () => {
    expect(canContinue({ events: [], myName: 'Vesper' })).toBe(true)
  })

  it('ignores beats and needs a name', () => {
    const events = [gm('2026-01-01T00:00:00Z'), beat('2026-01-01T00:00:05Z')]
    expect(canContinue({ events, myName: 'Vesper' })).toBe(true)
    expect(canContinue({ events, myName: undefined })).toBe(false)
  })
})
