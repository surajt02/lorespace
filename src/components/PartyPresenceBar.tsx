/**
 * Party presence — the roster's live half (`P4.1`, `P4.3`, `P4.5`).
 *
 * The only component that opens a presence socket, and it is rendered signed-in
 * only: the signed-out table joins no room (ADR 0006). One socket per client, on
 * the campaign's scope.
 *
 * What it broadcasts is identity plus one boolean — `characterId`,
 * `characterName`, `archetype`, `isTypingAction` (`P5.9`). HP is deliberately
 * absent: `characters` is already live through the record room, so `buildParty`
 * joins each present peer to its query row and the numbers stay server-authored
 * (ADR 0015, `P4.5`).
 * Rolls are absent too: the banner reads the `roll-logs` row itself
 * (`RollBannerLayer`), so presence never carries a number anyone could forge
 * (ADR 0021). `isTypingAction` is a keystroke flag, not a game claim, and it is
 * sent in the same payload as the identity keys so a merge can never leave a
 * stale flag behind without a stale identity.
 *
 * `updateState` merges and is dropped while the socket is still connecting, so
 * the seed effect waits for `connected` and omits the keys it does not own. A
 * viewer whose character row disappears re-broadcasts nulls rather than leaving
 * a stale id behind.
 */

import { useEffect, useMemo } from 'react'
import { usePresenceRoom, type RecordData } from 'deepspace'
import { PartyRoster } from '@/components/vtt/PartyRoster'
import { DEFAULT_CAMPAIGN_PRESENCE_SCOPE } from '@/constants'
import { buildParty } from '@/lib/party-presence'
import type { CharacterRow } from '@/lib/preview-data'

export function PartyPresenceBar({
  characters,
  myCharacter,
  userId,
  isTyping = false,
  onOnlineNames,
}: {
  characters: RecordData<CharacterRow>[]
  myCharacter: RecordData<CharacterRow> | null
  userId: string
  /** The viewer is composing a GM message (`P5.9`). */
  isTyping?: boolean
  /**
   * The character names who are actually playing right now — you plus every
   * present peer with a sheet. The GM is told this set, so an offline character
   * is in the roster but not in the story (`P5.28`).
   */
  onOnlineNames?: (names: string[]) => void
}) {
  const { peers, connected, updateState } = usePresenceRoom(DEFAULT_CAMPAIGN_PRESENCE_SCOPE)

  const characterId = myCharacter?.recordId ?? null
  const characterName = myCharacter?.data.name ?? null
  const archetype = myCharacter?.data.archetype ?? null

  useEffect(() => {
    // Nothing to announce before the socket is open: `updateState` no-ops while
    // connecting, which would lose the seed for every first mount.
    if (!connected) return
    // Always the whole payload: `updateState` merges, so sending only the flag
    // would be fine but sending only the identity would leave the flag stuck.
    updateState({
      characterId,
      characterName,
      archetype,
      isTypingAction: isTyping === true,
    })
  }, [connected, characterId, characterName, archetype, isTyping, updateState])

  const party = useMemo(
    () => buildParty({ peers, characters, myCharacter, myUserId: userId }),
    // `myCharacter` is a query row: its identity changes only when the row does.
    [peers, characters, myCharacter, userId],
  )

  const onlineNames = useMemo(() => {
    const names = party.filter((member) => member.isOnline && member.hasCharacter).map((m) => m.name)
    return [...new Set(names)]
  }, [party])

  // Reported rather than read by the parent: the presence socket lives here, and
  // `home` only needs the names to hand to the GM turn.
  useEffect(() => {
    onOnlineNames?.(onlineNames)
  }, [onlineNames, onOnlineNames])

  return (
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
        online: member.isOnline,
        isSelf: member.isSelf,
        isTyping: member.isTyping,
      }))}
    />
  )
}
