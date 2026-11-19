/**
 * Party presence — the roster's live half (`P4.1`, `P4.3`, `P4.5`) and the roll
 * broadcast (`P4.6`, `P4.10`).
 *
 * The only component that opens a presence socket, and it is rendered signed-in
 * only: the signed-out table keeps the fixture roster and opens nothing
 * (ADR 0006). One socket per client, on the campaign's scope.
 *
 * What it broadcasts is identity and, after a roll, that roll's authoritative
 * numbers — `characterId`, `characterName`, `archetype`, and `lastRoll` (the
 * action result plus the stat and the epoch ms it was announced at). HP is
 * deliberately absent: `characters` is already live through the record room, so
 * `buildParty` joins each present peer to its query row and the numbers stay
 * server-authored (ADR 0015, `P4.5`).
 *
 * Two directions, one payload shape:
 *
 * - **Out:** the viewer's own roll arrives as `announce` (from
 *   `CharacterSheetPanel`'s action result via `/home`), is broadcast, and is
 *   shown to the roller without a round trip through presence.
 * - **In:** a peer's roll is picked out of `peers` by `freshRolls`, which drops
 *   anything older than this mount and anything already seen — `updateState`
 *   merges, so `lastRoll` outlives the roll and would otherwise replay for every
 *   late joiner.
 *
 * `updateState` merges and is dropped while the socket is still connecting, so
 * the seed effect waits for `connected` and omits the keys it does not own. A
 * viewer whose character row disappears re-broadcasts nulls rather than leaving
 * a stale id behind.
 *
 * The broadcast is fire-and-forget and must never retry: if it drops, the
 * `roll-logs` row is still written and the feed still shows the roll, so the
 * only thing lost is the banner in the other windows. Retrying would roll twice
 * (`P4.6`, ADR 0005).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePresenceRoom, type RecordData } from 'deepspace'
import type { ResolvedRoll } from '@/components/CharacterSheetPanel'
import { RollBanner, type AnnouncedRoll } from '@/components/vtt/RollBanner'
import { PartyRoster } from '@/components/vtt/PartyRoster'
import { DEFAULT_CAMPAIGN_PRESENCE_SCOPE } from '@/constants'
import { buildParty, freshRolls, type AbilityScoreKey } from '@/lib/party-presence'
import type { CharacterRow } from '@/lib/preview-data'

/** The action's result plus the stat the player clicked: one value, so the
 *  banner, the broadcast and the toast can never disagree about which card
 *  rolled. `ResolvedRoll` is declared in the sheet rather than imported from the
 *  action module (which is worker-only). */
export type Announcement = ResolvedRoll & { statName: AbilityScoreKey }

export function PartyPresenceBar({
  characters,
  myCharacter,
  userId,
  announce,
}: {
  characters: RecordData<CharacterRow>[]
  myCharacter: RecordData<CharacterRow> | null
  userId: string
  announce: Announcement | null
}) {
  const { peers, connected, updateState } = usePresenceRoom(DEFAULT_CAMPAIGN_PRESENCE_SCOPE)

  const characterId = myCharacter?.recordId ?? null
  const characterName = myCharacter?.data.name ?? null
  const archetype = myCharacter?.data.archetype ?? null

  // This mount's epoch ms, and every `rollLogId` already shown. Both are refs:
  // neither has any business triggering a render, and both must survive one.
  const mountedAt = useRef(Date.now())
  const seen = useRef(new Set<string>())

  const [activeRoll, setActiveRoll] = useState<AnnouncedRoll | null>(null)

  useEffect(() => {
    // Nothing to announce before the socket is open: `updateState` no-ops while
    // connecting, which would lose the seed for every first mount.
    if (!connected) return
    updateState({ characterId, characterName, archetype })
  }, [connected, characterId, characterName, archetype, updateState])

  useEffect(() => {
    // The local banner is not gated on the socket: the roll already happened and
    // the roller must see it. The broadcast is fire-and-forget and never retried
    // (P4.6) — a dropped `updateState` costs peers the banner, not the roll.
    if (announce === null || characterId === null) return
    if (seen.current.has(announce.rollLogId)) return
    seen.current.add(announce.rollLogId)

    updateState({ lastRoll: { ...announce, at: Date.now() } })
    setActiveRoll({
      characterName: characterName ?? 'You',
      ...announce,
    })
  }, [announce, characterId, characterName, updateState])

  const party = useMemo(
    () => buildParty({ peers, characters, myCharacter, myUserId: userId }),
    // `myCharacter` is a query row: its identity changes only when the row does.
    [peers, characters, myCharacter, userId],
  )

  useEffect(() => {
    const fresh = freshRolls({ peers, mountedAt: mountedAt.current, seen: seen.current })
    const newest = fresh[0]
    if (!newest) return
    setActiveRoll({
      characterName: party.find((member) => member.userId === newest.userId)?.name ?? 'A party member',
      ...newest.roll,
    })
    // `party` is memoised on `peers`, so a new peer batch re-runs this once.
  }, [peers, party])

  return (
    <>
      <RollBanner
        roll={activeRoll}
        onDismiss={() => {
          setActiveRoll(null)
        }}
      />
      <PartyRoster
        members={party.map((member) => ({
          id: member.userId,
          name: member.name,
          archetype: member.archetype,
          hp: member.hp,
          maxHp: member.maxHp,
          // A dot only while the socket is actually open: a member whose
          // connection was refused (or is still handshaking) is not "online",
          // and the row still renders because presence is not who they are.
          online: member.isSelf || connected,
          isSelf: member.isSelf,
        }))}
      />
    </>
  )
}
