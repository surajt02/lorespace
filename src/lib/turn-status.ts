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

import { recordTime } from '@/lib/record-time'

/** The one shape this reads out of a `gm-messages` row. */
export interface TurnEvent {
  role?: unknown
  characterName?: unknown
  createdAt?: unknown
  /**
   * A raw record envelope (`RecordData<GmMessageRow>`) carries the same fields
   * under `data`. Both shapes are accepted: passing an envelope to a reader that
   * expected flattened fields made every event invisible, so "is a move due"
   * answered `true` forever (`P5.47`).
   */
  data?: { role?: unknown; characterName?: unknown } | null
}

/** The speaker an engine beat is stored under; a beat is not a move. */
const BEAT_SENTINEL = '__beat__'

function at(event: TurnEvent): number {
  return recordTime(event.createdAt)
}

function roleOf(event: TurnEvent): string {
  if (typeof event.role === 'string') return event.role
  const nested = event.data?.role
  return typeof nested === 'string' ? nested : ''
}

function speaker(event: TurnEvent): string {
  const direct = typeof event.characterName === 'string' ? event.characterName : ''
  const nested = typeof event.data?.characterName === 'string' ? event.data.characterName : ''
  return (direct || nested).trim()
}

/**
 * Is this player's move outstanding? (`P5.34` amended, `P5.43`)
 *
 * "Your move is due" means the GM has spoken since your last move — or the story
 * has not started and you have not moved yet. The line above the composer and the
 * CONTINUE button are the same condition, from two sides: the line says you owe a
 * move, the button lets you pass it.
 *
 * Read from the thread rather than the round counters, because the thread is the
 * event the player performed: the line clears the moment you send (your row is
 * newer than the GM's) and returns when the GM answers. The earlier reading — "you
 * are behind the round" — re-lit it on every rollover and read as permanently on;
 * requiring another player to have moved first hid it exactly when you were due.
 */
export function moveDue({
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
  for (const event of events) {
    const when = at(event)
    if (when === 0) continue
    if (roleOf(event) === 'assistant') {
      if (when > lastGmAt) lastGmAt = when
      continue
    }
    if (roleOf(event) !== 'user') continue
    const who = speaker(event)
    // A beat is the engine talking to itself, never a player's move.
    if (who === '' || who === BEAT_SENTINEL) continue
    if (who === me && when > myLastMoveAt) myLastMoveAt = when
  }

  // Due unless the viewer has already taken a move since the GM's last word.
  return myLastMoveAt === 0 || myLastMoveAt < lastGmAt
}

/**
 * The line itself, lowercase; the panel uppercases it with CSS like every other
 * pixel-font label, so the string and the markup never disagree about case.
 */
export function waitingLabel(): string {
  return 'awaiting your move…'
}

/**
 * Which window asks for the roll turn? (`P5.40`)
 *
 * Every open window sees every new `roll-logs` row, so both used to fire the same
 * request — two model calls for one batch, and the claim race. The roller's own
 * window is the one that asks: it is the window that pressed the button, so it is
 * open by definition. A viewer with no character (or a row with no speaker) still
 * asks, so an unattributed roll can never go unnarrated.
 */
export function ownsRollTurn({
  newestRollName,
  myName,
}: {
  newestRollName: string | undefined
  myName: string | undefined
}): boolean {
  const roller = newestRollName?.trim() ?? ''
  const me = myName?.trim() ?? ''
  if (roller === '') return true
  if (me === '') return true
  return roller === me
}

/**
 * The CONTINUE button uses `moveDue` (`P5.43`): a pass is offered exactly while a
 * move is outstanding, and hides once the viewer's move is in for the round — two
 * passes would be two actions in one round.
 */

/**
 * The line itself, lowercase; the panel uppercases it with CSS like every other
 * pixel-font label, so the string and the markup never disagree about case.
 */
