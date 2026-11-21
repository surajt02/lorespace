import { describe, expect, it } from 'vitest'
import { newestRecordTime, recordTime } from '@/lib/record-time'

/**
 * `P5.46`: record `createdAt` arrives as ISO text for some collections and epoch
 * numbers for others. Reading a number with `Date.parse` yielded `NaN` → `0`, so
 * every timestamp compared equal and `AWAITING YOUR MOVE…` never cleared after a
 * player sent.
 */
describe('recordTime', () => {
  it('reads ISO text', () => {
    expect(recordTime('2026-01-01T00:00:05.000Z')).toBe(Date.parse('2026-01-01T00:00:05.000Z'))
  })

  it('reads epoch milliseconds', () => {
    expect(recordTime(1_790_000_000_000)).toBe(1_790_000_000_000)
  })

  it('reads epoch seconds', () => {
    expect(recordTime(1_790_000_000)).toBe(1_790_000_000_000)
  })

  it('reads a Date', () => {
    const at = new Date('2026-01-01T00:00:05.000Z')
    expect(recordTime(at)).toBe(at.getTime())
  })

  it('returns 0 for anything unreadable', () => {
    expect(recordTime(undefined)).toBe(0)
    expect(recordTime(null)).toBe(0)
    expect(recordTime('')).toBe(0)
    expect(recordTime('not a date')).toBe(0)
    expect(recordTime(Number.NaN)).toBe(0)
    expect(recordTime(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('orders mixed shapes correctly (the bug: all zeros)', () => {
    const rows = [
      { createdAt: '2026-01-01T00:00:05.000Z' },
      { createdAt: Date.parse('2026-01-01T00:00:09.000Z') },
    ]
    expect(newestRecordTime(rows)).toBe(Date.parse('2026-01-01T00:00:09.000Z'))
    expect(newestRecordTime([])).toBe(0)
  })
})
