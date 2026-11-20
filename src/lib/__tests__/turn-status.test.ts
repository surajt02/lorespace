import { describe, expect, it } from 'vitest'
import { awaitsMove, waitingLabel } from '@/lib/turn-status'

/**
 * Unit tests for the client's half of round pacing (ADR 0031, amended
 * 2026-11-20): which sheet is told to move, and with what words.
 *
 * The server (`round-pacing.ts`) is the authority on `actedRound`; these tests
 * pin only the display rule — behind means waiting, and anything unprovable
 * means nothing — so a broken row can never trap a player behind a line.
 */

describe('awaitsMove', () => {
  it('is true when the character acted in an earlier round', () => {
    expect(awaitsMove({ roundNumber: 3, actedRound: 2 })).toBe(true)
  })

  it('is false when the character has already acted this round', () => {
    expect(awaitsMove({ roundNumber: 3, actedRound: 3 })).toBe(false)
  })

  it('is false when the sheet is ahead of the campaign', () => {
    // A stale campaign read or a sheet marked by a round that has since reset:
    // not a claim to a move.
    expect(awaitsMove({ roundNumber: 2, actedRound: 3 })).toBe(false)
  })

  it('is false when either number is missing', () => {
    expect(awaitsMove({ roundNumber: undefined, actedRound: 2 })).toBe(false)
    expect(awaitsMove({ roundNumber: 3, actedRound: undefined })).toBe(false)
    expect(awaitsMove({ roundNumber: undefined, actedRound: undefined })).toBe(false)
  })

  it('is false when either number is not finite', () => {
    expect(awaitsMove({ roundNumber: Number.NaN, actedRound: 2 })).toBe(false)
    expect(awaitsMove({ roundNumber: 3, actedRound: Number.NaN })).toBe(false)
    expect(awaitsMove({ roundNumber: Number.POSITIVE_INFINITY, actedRound: 2 })).toBe(false)
  })

  it('is false for the campaign default round with an unmarked sheet', () => {
    // `actedRound` defaults to 0, so a table that has never played reads as
    // waiting once it is on round 1 — which is exactly the opening beat.
    expect(awaitsMove({ roundNumber: 1, actedRound: 0 })).toBe(true)
  })
})

describe('waitingLabel', () => {
  it('is lowercase, so CSS owns the case', () => {
    expect(waitingLabel()).toBe('awaiting your move…')
  })
})
