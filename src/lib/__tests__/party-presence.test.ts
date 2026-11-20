import { describe, expect, it } from 'vitest'
import type { RecordData } from 'deepspace'
import { buildParty, peerCharacterId, peerIsTyping } from '@/lib/party-presence'
import { PREVIEW_CHARACTERS, type CharacterRow } from '@/lib/preview-data'

/**
 * Unit tests for the presence payload guards and the roster join (`P4.1`,
 * `P4.3`, `P4.5`).
 *
 * Presence state is attacker-shaped input, so these pin the two things that
 * matter: a malformed payload is dropped rather than half-rendered, and HP comes
 * from the `characters` row — a peer cannot move their hit points by claiming a
 * different total over the socket. A roll is not part of the payload at all
 * (ADR 0021), so nothing here can be trusted for a number. `isTypingAction`
 * (`P5.9`) is the one boolean the payload adds, and it is read only as a literal
 * `true`. Values are asserted directly; no snapshots, no jsdom, no socket.
 */

const [KAELEN, VESPER] = PREVIEW_CHARACTERS as [
  RecordData<CharacterRow>,
  RecordData<CharacterRow>,
]

/** A well-formed payload; each test breaks one field of a copy. */
function state(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    characterId: VESPER.recordId,
    characterName: VESPER.data.name,
    archetype: VESPER.data.archetype,
    ...overrides,
  }
}

describe('peerCharacterId', () => {
  it('reads a well-formed payload', () => {
    expect(peerCharacterId({ characterId: 'char-kaelen', characterName: 'Kaelen' })).toBe(
      'char-kaelen',
    )
  })

  it('returns null for an empty or malformed payload', () => {
    expect(peerCharacterId({})).toBeNull()
    expect(peerCharacterId({ characterId: '' })).toBeNull()
    expect(peerCharacterId({ characterId: 42 })).toBeNull()
    expect(peerCharacterId({ characterId: null })).toBeNull()
  })

  it('ignores every other key, including a roll', () => {
    // Presence carries identity only (P4.1/P4.5, ADR 0021): a payload that also
    // claims a roll must not change which character renders.
    const state = {
      characterId: 'char-vesper',
      lastRoll: { rollLogId: 'log-1', rawRoll: 20, total: 99, outcome: 'critical_success' },
    }
    expect(peerCharacterId(state)).toBe('char-vesper')
  })
})

describe('peerIsTyping', () => {
  it('reads a literal true', () => {
    expect(peerIsTyping({ isTypingAction: true })).toBe(true)
    expect(peerIsTyping(state({ isTypingAction: true }))).toBe(true)
  })

  it('returns false when the flag is false or absent', () => {
    expect(peerIsTyping({ isTypingAction: false })).toBe(false)
    expect(peerIsTyping(state())).toBe(false)
    expect(peerIsTyping({})).toBe(false)
  })

  it('returns false for a wrong-typed or non-object payload', () => {
    // Presence is attacker-shaped: only the literal boolean counts, so a claim
    // like "yes" or 1 cannot leave the marker on.
    expect(peerIsTyping({ isTypingAction: 'true' })).toBe(false)
    expect(peerIsTyping({ isTypingAction: 1 })).toBe(false)
    expect(peerIsTyping({ isTypingAction: null })).toBe(false)
    expect(peerIsTyping(null)).toBe(false)
    expect(peerIsTyping(undefined)).toBe(false)
    expect(peerIsTyping('typing')).toBe(false)
    expect(peerIsTyping([])).toBe(false)
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

    expect(party[0]).toEqual({
      userId: KAELEN.data.userId,
      name: KAELEN.data.name,
      archetype: KAELEN.data.archetype,
      hp: KAELEN.data.hp,
      maxHp: KAELEN.data.maxHp,
      isSelf: true,
      hasCharacter: true,
      isOnline: true,
      isTyping: false,
    })
    // Parity with the signed-out preview (`P5.28`): the other party member is
    // listed, and marked offline rather than hidden.
    expect(party.map((member) => [member.name, member.isOnline])).toEqual([
      ['Kaelen', true],
      ['Vesper', false],
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

    // The anonymous peer adds nothing; the offline party member is still listed.
    expect(party.map((member) => member.userId)).toEqual([
      KAELEN.data.userId,
      VESPER.data.userId,
    ])
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
      isOnline: true,
      isTyping: false,
    })
  })

  it('carries a peer typing flag and never marks self', () => {
    const party = buildParty({
      peers: [
        { userId: 'user-vesper', state: state({ isTypingAction: true }) },
        { userId: 'user-new', state: { isTypingAction: true } },
      ],
      characters: PREVIEW_CHARACTERS,
      myCharacter: KAELEN,
      myUserId: KAELEN.data.userId,
    })

    expect(party.map((member) => [member.userId, member.isTyping])).toEqual([
      [KAELEN.data.userId, false],
      ['user-vesper', true],
      // No sheet, but still composing: presence is not gated on a character row.
      ['user-new', true],
      // The row nobody is sitting at: listed, offline, never typing.
      [VESPER.data.userId, false],
    ])
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
        isOnline: true,
        isTyping: false,
      },
      {
        userId: 'user-new',
        name: 'No adventurer',
        archetype: '',
        hp: 0,
        maxHp: 0,
        isSelf: false,
        hasCharacter: false,
        isOnline: true,
        isTyping: false,
      },
      // Nobody sits at either party row, so both are listed offline.
      {
        userId: KAELEN.data.userId,
        name: KAELEN.data.name,
        archetype: KAELEN.data.archetype,
        hp: KAELEN.data.hp,
        maxHp: KAELEN.data.maxHp,
        isSelf: false,
        hasCharacter: true,
        isOnline: false,
        isTyping: false,
      },
      {
        userId: VESPER.data.userId,
        name: VESPER.data.name,
        archetype: VESPER.data.archetype,
        hp: VESPER.data.hp,
        maxHp: VESPER.data.maxHp,
        isSelf: false,
        hasCharacter: true,
        isOnline: false,
        isTyping: false,
      },
    ])
  })

  it('still takes no HP or roll from a payload that claims both', () => {
    // ADR 0021 stands after `P5.9`: the typing flag is the only addition, and a
    // peer cannot smuggle hit points or dice alongside it.
    const party = buildParty({
      peers: [
        {
          userId: 'user-vesper',
          state: state({ isTypingAction: true, hp: 1, maxHp: 1, rawRoll: 20, total: 99 }),
        },
      ],
      characters: PREVIEW_CHARACTERS,
      myCharacter: null,
      myUserId: 'user-me',
    })

    expect(party[0]?.hp).toBe(VESPER.data.hp)
    expect(party[0]?.maxHp).toBe(VESPER.data.maxHp)
    expect(party[0]?.isTyping).toBe(true)
    expect(party[0]).not.toHaveProperty('rawRoll')
    expect(party[0]).not.toHaveProperty('total')
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
      VESPER.data.userId,
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

    // Self appears once as self; the other party member is the only other row.
    expect(party.map((member) => [member.userId, member.isSelf])).toEqual([
      [KAELEN.data.userId, true],
      [VESPER.data.userId, false],
    ])
  })

  it('resolves a peer by their character row when the payload has no id', () => {
    // P5.33: presence can hydrate empty after a DO restart, and a window whose
    // identity never changed never re-sends. The readable `characters` row is
    // the authority, so a peer without a `characterId` is not "No adventurer".
    const party = buildParty({
      peers: [{ userId: VESPER.data.userId, state: {} }],
      characters: PREVIEW_CHARACTERS,
      myCharacter: KAELEN,
      myUserId: KAELEN.data.userId,
    })

    const peer = party.find((member) => member.userId === VESPER.data.userId)
    expect(peer?.name).toBe(VESPER.data.name)
    expect(peer?.hasCharacter).toBe(true)
    expect(peer?.hp).toBe(VESPER.data.hp)
  })

  it('resolves a peer whose payload points at a stale character id', () => {
    const party = buildParty({
      peers: [{ userId: VESPER.data.userId, state: { characterId: 'char-deleted' } }],
      characters: PREVIEW_CHARACTERS,
      myCharacter: null,
      myUserId: 'user-me',
    })

    const peer = party.find((member) => member.userId === VESPER.data.userId)
    expect(peer?.name).toBe(VESPER.data.name)
  })

  it('reports the online names for the GM turn', () => {
    // `P5.28`: the GM plays with who is here, so the bar hands the panel exactly
    // the present characters — an offline party member is not among them.
    const party = buildParty({
      peers: [{ userId: 'user-vesper', state: state({ characterId: VESPER.recordId }) }],
      characters: PREVIEW_CHARACTERS,
      myCharacter: KAELEN,
      myUserId: KAELEN.data.userId,
    })
    const online = party.filter((member) => member.isOnline && member.hasCharacter)
    expect(online.map((member) => member.name)).toEqual(['Kaelen', 'Vesper'])

    const alone = buildParty({
      peers: [],
      characters: PREVIEW_CHARACTERS,
      myCharacter: KAELEN,
      myUserId: KAELEN.data.userId,
    })
    expect(
      alone.filter((member) => member.isOnline && member.hasCharacter).map((m) => m.name),
    ).toEqual(['Kaelen'])
  })
})
