import { describe, expect, it } from 'vitest'
import type { RecordData } from 'deepspace'
import {
  buildParty,
  freshRolls,
  parsePresenceState,
  type PresenceRoll,
} from '@/lib/party-presence'
import { PREVIEW_CHARACTERS, type CharacterRow } from '@/lib/preview-data'

/**
 * Unit tests for the presence payload guards and the roster join (`P4.1`,
 * `P4.3`, `P4.5`).
 *
 * Presence state is attacker-shaped input, so these pin the two things that
 * matter: a malformed payload is dropped rather than half-rendered, and HP comes
 * from the `characters` row — a peer cannot move their hit points by claiming a
 * different total over the socket. Values are asserted directly; no snapshots,
 * no jsdom, no socket.
 */

const [KAELEN, VESPER] = PREVIEW_CHARACTERS as [
  RecordData<CharacterRow>,
  RecordData<CharacterRow>,
]

const MOUNTED_AT = 1_800_000_000_000

/** A well-formed payload; each test breaks one field of a copy. */
function state(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    characterId: VESPER.recordId,
    characterName: VESPER.data.name,
    archetype: VESPER.data.archetype,
    ...overrides,
  }
}

/** A well-formed `lastRoll`; `at` defaults to after mount so it is fresh. */
function roll(overrides: Partial<PresenceRoll> = {}): PresenceRoll {
  return {
    rollLogId: 'roll-vesper-1',
    statName: 'dex',
    rawRoll: 14,
    modifier: 3,
    total: 17,
    targetDc: 12,
    outcome: 'success',
    at: MOUNTED_AT + 1_000,
    ...overrides,
  }
}

describe('parsePresenceState', () => {
  it('reads a well-formed payload whole', () => {
    const parsed = parsePresenceState(state({ lastRoll: roll() }))

    expect(parsed.characterId).toBe(VESPER.recordId)
    expect(parsed.lastRoll).toEqual(roll())
  })

  it('returns two nulls for an empty payload', () => {
    expect(parsePresenceState({})).toEqual({ characterId: null, lastRoll: null })
  })

  it('drops only the bad half', () => {
    // A bad roll must not cost a peer their place in the roster, and a missing
    // character must not hide a roll that really happened.
    expect(parsePresenceState(state({ lastRoll: { rollLogId: 'x' } })).characterId).toBe(
      VESPER.recordId,
    )
    expect(parsePresenceState(state({ lastRoll: { rollLogId: 'x' } })).lastRoll).toBeNull()
    expect(parsePresenceState({ lastRoll: roll() })).toEqual({
      characterId: null,
      lastRoll: roll(),
    })
  })

  it('rejects a non-string characterId', () => {
    expect(parsePresenceState(state({ characterId: 42 })).characterId).toBeNull()
    expect(parsePresenceState(state({ characterId: '' })).characterId).toBeNull()
  })

  it('rejects a string rawRoll', () => {
    // The likeliest forgery: numbers arriving as strings, which would render as
    // text and never compare equal to a number.
    const parsed = parsePresenceState(state({ lastRoll: roll({ rawRoll: '14' as never }) }))

    expect(parsed.lastRoll).toBeNull()
  })

  it('rejects an unknown outcome', () => {
    expect(
      parsePresenceState(state({ lastRoll: roll({ outcome: 'legendary' as never }) })).lastRoll,
    ).toBeNull()
  })

  it('rejects an unknown statName', () => {
    expect(
      parsePresenceState(state({ lastRoll: roll({ statName: 'luck' as never }) })).lastRoll,
    ).toBeNull()
  })

  it('rejects a missing or empty rollLogId', () => {
    const { rollLogId: _dropped, ...withoutId } = roll()
    expect(parsePresenceState(state({ lastRoll: withoutId })).lastRoll).toBeNull()
    expect(
      parsePresenceState(state({ lastRoll: roll({ rollLogId: '' }) })).lastRoll,
    ).toBeNull()
  })

  it('rejects a non-finite number', () => {
    expect(
      parsePresenceState(state({ lastRoll: roll({ total: Number.NaN }) })).lastRoll,
    ).toBeNull()
    expect(
      parsePresenceState(state({ lastRoll: roll({ at: Number.POSITIVE_INFINITY }) })).lastRoll,
    ).toBeNull()
  })

  it('accepts a roll stamped in the future', () => {
    // Clock skew is not a payload error; `freshRolls` decides what to announce.
    const future = roll({ at: Date.now() + 60_000 })

    expect(parsePresenceState(state({ lastRoll: future })).lastRoll).toEqual(future)
  })
})

describe('buildParty', () => {
  it('puts self first, from the character row', () => {
    const party = buildParty({
      peers: [],
      characters: PREVIEW_CHARACTERS,
      myCharacter: KAELEN,
      myUserId: KAELEN.data.userId,
    })

    expect(party).toEqual([
      {
        userId: KAELEN.data.userId,
        name: KAELEN.data.name,
        archetype: KAELEN.data.archetype,
        hp: KAELEN.data.hp,
        maxHp: KAELEN.data.maxHp,
        isSelf: true,
        hasCharacter: true,
      },
    ])
  })

  it('keeps self on the roster while presence is still empty', () => {
    // `peers` is [] on connect and on every reconnect; self must not blink out.
    const party = buildParty({
      peers: [],
      characters: [],
      myCharacter: KAELEN,
      myUserId: KAELEN.data.userId,
    })

    expect(party).toHaveLength(1)
    expect(party[0]?.isSelf).toBe(true)
  })

  it('lists no one before there is a character', () => {
    const party = buildParty({
      peers: [],
      characters: [],
      myCharacter: null,
      myUserId: 'user-me',
    })

    expect(party).toEqual([])
  })

  it('drops an anonymous peer', () => {
    const party = buildParty({
      peers: [{ userId: 'anon-1234', state: state() }],
      characters: PREVIEW_CHARACTERS,
      myCharacter: KAELEN,
      myUserId: KAELEN.data.userId,
    })

    expect(party.map((member) => member.userId)).toEqual([KAELEN.data.userId])
  })

  it('joins a peer to their character row for HP', () => {
    const party = buildParty({
      peers: [{ userId: 'user-vesper', state: state() }],
      characters: PREVIEW_CHARACTERS,
      myCharacter: KAELEN,
      myUserId: KAELEN.data.userId,
    })

    expect(party[1]).toEqual({
      userId: 'user-vesper',
      name: VESPER.data.name,
      archetype: VESPER.data.archetype,
      hp: VESPER.data.hp,
      maxHp: VESPER.data.maxHp,
      isSelf: false,
      hasCharacter: true,
    })
  })

  it('never takes HP from presence state', () => {
    // ADR 0015: HP is server-authored. A peer claiming 1/1 must still show the
    // row's 17/17.
    const party = buildParty({
      peers: [
        {
          userId: 'user-vesper',
          state: state({ hp: 1, maxHp: 1, characterName: 'Not Vesper' }),
        },
      ],
      characters: PREVIEW_CHARACTERS,
      myCharacter: null,
      myUserId: 'user-me',
    })

    expect(party[0]?.hp).toBe(VESPER.data.hp)
    expect(party[0]?.maxHp).toBe(VESPER.data.maxHp)
    expect(party[0]?.name).toBe(VESPER.data.name)
  })

  it('shows a peer with no resolvable character instead of hiding them', () => {
    const party = buildParty({
      peers: [
        { userId: 'user-vesper', state: state({ characterId: 'char-deleted' }) },
        { userId: 'user-new', state: {} },
      ],
      characters: PREVIEW_CHARACTERS,
      myCharacter: null,
      myUserId: 'user-me',
    })

    expect(party).toEqual([
      {
        userId: 'user-vesper',
        name: 'No adventurer',
        archetype: '',
        hp: 0,
        maxHp: 0,
        isSelf: false,
        hasCharacter: false,
      },
      {
        userId: 'user-new',
        name: 'No adventurer',
        archetype: '',
        hp: 0,
        maxHp: 0,
        isSelf: false,
        hasCharacter: false,
      },
    ])
  })

  it('keeps input order and lists each user once', () => {
    const party = buildParty({
      peers: [
        { userId: 'user-a', state: state() },
        { userId: 'user-b', state: state({ characterId: KAELEN.recordId }) },
        { userId: 'user-a', state: state({ characterId: KAELEN.recordId }) },
      ],
      characters: PREVIEW_CHARACTERS,
      myCharacter: KAELEN,
      myUserId: KAELEN.data.userId,
    })

    expect(party.map((member) => member.userId)).toEqual([
      KAELEN.data.userId,
      'user-a',
      'user-b',
    ])
    // The first listing wins, so a re-announced peer cannot jump the queue.
    expect(party[1]?.name).toBe(VESPER.data.name)
  })

  it('does not list self twice when presence echoes it', () => {
    const party = buildParty({
      peers: [{ userId: KAELEN.data.userId, state: state() }],
      characters: PREVIEW_CHARACTERS,
      myCharacter: KAELEN,
      myUserId: KAELEN.data.userId,
    })

    expect(party).toHaveLength(1)
    expect(party[0]?.isSelf).toBe(true)
  })
})

describe('freshRolls', () => {
  it('announces a roll made after mount', () => {
    const seen = new Set<string>()
    const fresh = freshRolls({
      peers: [{ userId: 'user-vesper', state: state({ lastRoll: roll() }) }],
      mountedAt: MOUNTED_AT,
      seen,
    })

    expect(fresh).toEqual([{ userId: 'user-vesper', roll: roll() }])
    expect(seen.has(roll().rollLogId)).toBe(true)
  })

  it('does not announce history a peer carried in', () => {
    // `updateState` merges, so `lastRoll` outlives the roll. A peer joining the
    // page must not replay it as a fresh banner.
    const seen = new Set<string>()
    const fresh = freshRolls({
      peers: [
        { userId: 'user-vesper', state: state({ lastRoll: roll({ at: MOUNTED_AT }) }) },
      ],
      mountedAt: MOUNTED_AT,
      seen,
    })

    expect(fresh).toEqual([])
    expect(seen.size).toBe(0)
  })

  it('announces a duplicate rollLogId once', () => {
    const seen = new Set<string>()
    const peer = { userId: 'user-vesper', state: state({ lastRoll: roll() }) }

    expect(freshRolls({ peers: [peer], mountedAt: MOUNTED_AT, seen })).toHaveLength(1)
    expect(freshRolls({ peers: [peer], mountedAt: MOUNTED_AT, seen })).toEqual([])
  })

  it('collapses the same rollLogId from two peers', () => {
    const seen = new Set<string>()
    const fresh = freshRolls({
      peers: [
        { userId: 'user-a', state: state({ lastRoll: roll() }) },
        { userId: 'user-b', state: state({ lastRoll: roll() }) },
      ],
      mountedAt: MOUNTED_AT,
      seen,
    })

    expect(fresh).toHaveLength(1)
  })

  it('orders two peers newest first', () => {
    const seen = new Set<string>()
    const fresh = freshRolls({
      peers: [
        {
          userId: 'user-older',
          state: state({ lastRoll: roll({ rollLogId: 'roll-older', at: MOUNTED_AT + 1_000 }) }),
        },
        {
          userId: 'user-newer',
          state: state({ lastRoll: roll({ rollLogId: 'roll-newer', at: MOUNTED_AT + 2_000 }) }),
        },
      ],
      mountedAt: MOUNTED_AT,
      seen,
    })

    expect(fresh.map((entry) => entry.roll.rollLogId)).toEqual(['roll-newer', 'roll-older'])
  })

  it('skips an anonymous peer and a malformed roll', () => {
    const seen = new Set<string>()
    const fresh = freshRolls({
      peers: [
        { userId: 'anon-1234', state: state({ lastRoll: roll() }) },
        { userId: 'user-bad', state: state({ lastRoll: { rollLogId: 'roll-bad' } }) },
      ],
      mountedAt: MOUNTED_AT,
      seen,
    })

    expect(fresh).toEqual([])
  })
})
