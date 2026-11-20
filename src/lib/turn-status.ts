/**
 * Whose move is it, as the client reads it (ADR 0031, amended 2026-11-20).
 *
 * The engine owns the round: `campaigns.roundNumber` is the round and
 * `characters.actedRound` is the last round that character acted in
 * (`round-pacing.ts`, server-side). Since the amendment, *waiting is a UI
 * indicator, not prose* — the GM no longer names who owes a move, because doing
 * so made every mid-round reply restate the table. The console shows this line
 * instead.
 *
 * Tolerance matches the rest of the display layer (`pendingOf`): a row that
 * cannot prove it is behind never claims to be waiting. An absent, hand-edited
 * or non-finite number reads as "not waiting", so a broken row dims nothing and
 * cannot trap a player behind a line that never goes away.
 *
 * Pure: no React, no SDK, no network, no server import.
 */

/**
 * The two numbers a sheet needs before it may claim a move.
 *
 * Both are additive columns, so both may be missing on a row written before the
 * round existed — hence `unknown`-tolerant callers and the finite check here.
 */
export interface TurnStatusSource {
  roundNumber: number | undefined
  actedRound: number | undefined
}

/**
 * True only when this character is behind the campaign's round: they acted in an
 * earlier round, so the table is waiting on them.
 *
 * Equal means they have already acted this round; ahead (a stale campaign read,
 * or a sheet marked by a round that has since reset) is not a claim to a move
 * either — the GM stages nobody who is not behind.
 */
export function awaitsMove({ roundNumber, actedRound }: TurnStatusSource): boolean {
  if (typeof roundNumber !== 'number' || !Number.isFinite(roundNumber)) return false
  if (typeof actedRound !== 'number' || !Number.isFinite(actedRound)) return false
  return actedRound < roundNumber
}

/**
 * The line itself, lowercase; the panel uppercases it with CSS like every other
 * pixel-font label, so the string and the markup never disagree about case.
 */
export function waitingLabel(): string {
  return 'awaiting your move…'
}
