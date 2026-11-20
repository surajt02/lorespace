/**
 * Whose move is it, as the client reads it (ADR 0031, amended 2026-11-20).
 *
 * The engine owns the round (`campaigns.roundNumber`, `characters.actedRound`,
 * `round-pacing.ts`) and *waiting is a UI indicator, not prose* — the GM no
 * longer names who owes a move. But the indicator is not "you are behind the
 * round": that reading lit it for every player the instant a round rolled over,
 * so it never went away.
 *
 * What the line means is **the table is waiting on you**: someone else has
 * already moved since the GM last spoke, and you have not. Read from the thread
 * rather than from the round counters, because the thread is the event the
 * player just performed — the same rows already drive the panel, and it needs no
 * subscription to another collection.
 *
 * Consequences, all intended:
 * - after you send, your line clears (you moved after the GM);
 * - when the other player sends first, the line appears on *your* screen only;
 * - when everyone has moved, it clears for everyone until the next round;
 * - a solo table never shows it, because nobody is ever waiting on you.
 *
 * Pure: no React, no SDK, no network, no server import.
 */

/** The one shape this reads out of a `gm-messages` row. */
export interface TurnEvent {
  role?: unknown
  characterName?: unknown
  createdAt?: unknown
}

/** The speaker an engine beat is stored under; a beat is not a move. */
const BEAT_SENTINEL = '__beat__'

function at(event: TurnEvent): number {
  return typeof event.createdAt === 'string' ? Date.parse(event.createdAt) || 0 : 0
}

function speaker(event: TurnEvent): string {
  return typeof event.characterName === 'string' ? event.characterName.trim() : ''
}

/**
 * True when the table is blocked on this player: an assistant turn has happened,
 * another character has moved since it, and this character has not.
 *
 * `myName` is required: without it there is no "you" to wait on, so the line
 * stays hidden rather than showing to everybody.
 */
export function awaitingMyMove({
  events,
  myName,
}: {
  events: readonly TurnEvent[]
  myName: string | undefined
}): boolean {
  const me = myName?.trim() ?? ''
  if (me === '') return false

  let lastGmAt = 0
  let myLastMoveAt = 0
  let othersLastMoveAt = 0

  for (const event of events) {
    const when = at(event)
    if (when === 0) continue
    if (event.role === 'assistant') {
      if (when > lastGmAt) lastGmAt = when
      continue
    }
    if (event.role !== 'user') continue
    const who = speaker(event)
    // A beat is the engine talking to itself, never a player's move.
    if (who === '' || who === BEAT_SENTINEL) continue
    if (who === me) {
      if (when > myLastMoveAt) myLastMoveAt = when
    } else if (when > othersLastMoveAt) {
      othersLastMoveAt = when
    }
  }

  // Someone else moved after the GM's last word, and I have not moved since it.
  return othersLastMoveAt > lastGmAt && myLastMoveAt < othersLastMoveAt
}

/**
 * The line itself, lowercase; the panel uppercases it with CSS like every other
 * pixel-font label, so the string and the markup never disagree about case.
 */
export function waitingLabel(): string {
  return 'awaiting your move…'
}
