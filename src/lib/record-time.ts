/**
 * The time of a record envelope, whatever shape the wire hands us (`P5.46`).
 *
 * The record room's `_created_at` is not one type: this app's own tables store
 * ISO text for `gm-messages` and epoch **numbers** for `roll-logs`, and a
 * subscription can deliver either form. `Date.parse(value)` on a number returns
 * `NaN`, so code that assumed a string silently read every timestamp as `0` —
 * which turned "the GM has spoken since your last move" into "always", leaving
 * `AWAITING YOUR MOVE…` on screen for a player who had just sent.
 *
 * Ordering and comparison helpers take `unknown` and normalise here instead of
 * repeating a cast at each call site.
 *
 * Pure: no React, no SDK.
 */

/** Epoch milliseconds for an ISO string, epoch number (ms or s) or `Date`. */
export function recordTime(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0
    // Seconds are ~1.7e9; milliseconds ~1.7e12.
    return value < 1e12 ? Math.round(value * 1000) : value
  }
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? time : 0
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/** Newest timestamp of a list, or 0 when none is readable. */
export function newestRecordTime(rows: readonly { createdAt?: unknown }[]): number {
  let newest = 0
  for (const row of rows) {
    const time = recordTime(row.createdAt)
    if (time > newest) newest = time
  }
  return newest
}
