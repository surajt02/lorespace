/* home pattern: product-preview-first — live multiplayer VTT campaign table, dice log, and character sheet */

/**
 * The table — `/home`, the live campaign workspace (`P1.7`, `P1.8`, `P1.9`,
 * `P1.11`).
 *
 * It is a shell, not a scrolling page: `<main>` in `(app)/_layout.tsx` owns the
 * page scroll and is already `h-full`, so on desktop the shell fills it and each
 * column scrolls its own content. Below `lg` the columns stack in reading order
 * (party → feed → sheet) and the page scrolls normally.
 *
 * Everything below the campaign row is fixture data this phase (ADR 0014): the
 * panels take rows as props, so Phase 3 and 4 swap `PREVIEW_*` for live queries
 * without touching their markup. This file writes nothing — no mutations, no
 * presence, no auth-gated hooks beyond `useAuth`.
 */

import { useAuth, useQuery } from 'deepspace'
import { CharacterSheetPanel } from '@/components/CharacterSheetPanel'
import { GmConsolePanel } from '@/components/GmConsolePanel'
import { InventoryPanel } from '@/components/InventoryPanel'
import { ActionFeed } from '@/components/vtt/ActionFeed'
import { PartyRoster, type RosterMember } from '@/components/vtt/PartyRoster'
import { SceneBanner } from '@/components/vtt/SceneBanner'
import { SignInBanner } from '@/components/vtt/SignInBanner'
import { DEFAULT_CAMPAIGN_ID } from '@/constants'
import {
  PREVIEW_CAMPAIGN,
  PREVIEW_CHARACTERS,
  PREVIEW_GM_MESSAGES,
  PREVIEW_INVENTORY,
  PREVIEW_ROLLS,
  type CampaignRow,
} from '@/lib/preview-data'

export default function HomePage() {
  const { isSignedIn, userId } = useAuth()
  const { records } = useQuery<CampaignRow>('campaigns')

  // Live row when the seed exists (`P2.3`), fixture until then. No skeleton in
  // this phase — `P2.5` owns the seeding state.
  const campaign =
    records.find((record) => record.recordId === DEFAULT_CAMPAIGN_ID)?.data ?? PREVIEW_CAMPAIGN.data

  // `online` is a fixed flag this phase: `P4.3` replaces it with presence.
  const roster: RosterMember[] = PREVIEW_CHARACTERS.map((record) => ({
    id: record.recordId,
    name: record.data.name,
    archetype: record.data.archetype,
    hp: record.data.hp,
    maxHp: record.data.maxHp,
    online: true,
  }))

  // Signed out you are watching Kaelen's table; signed in your sheet is the row
  // bound to your user id. P3.3 — no row yet means no character, so the sheet
  // shows its empty state until Forge (`P3.4`) exists.
  const characterRecord = isSignedIn
    ? (PREVIEW_CHARACTERS.find((record) => record.data.userId === userId) ?? null)
    : (PREVIEW_CHARACTERS[0] ?? null)

  const inventory = PREVIEW_INVENTORY.filter(
    (record) => record.data.characterId === characterRecord?.recordId,
  ).map((record) => record.data)

  return (
    <div
      data-testid="workspace-shell"
      className="flex min-h-full flex-col gap-3 bg-shell p-3 lg:h-full lg:min-h-0"
    >
      <div className="shrink-0">
        <SceneBanner campaign={campaign} />
      </div>

      {!isSignedIn && (
        <div className="shrink-0">
          <SignInBanner />
        </div>
      )}

      <div
        data-testid={isSignedIn ? undefined : 'preview-table'}
        className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)_minmax(0,340px)] lg:grid-rows-[minmax(0,1fr)]"
      >
        <aside className="flex min-h-0 flex-col gap-3 bg-shell-panel lg:overflow-y-auto">
          <div className="pixel-frame bg-card">
            <PartyRoster members={roster} />
          </div>
        </aside>

        <section className="flex min-h-0 flex-col gap-3 bg-shell-panel lg:overflow-y-auto">
          <div className="pixel-frame bg-card">
            <ActionFeed entries={PREVIEW_ROLLS.map((record) => record.data)} />
          </div>
          <GmConsolePanel messages={PREVIEW_GM_MESSAGES} />
        </section>

        <aside className="flex min-h-0 flex-col gap-3 bg-shell-panel lg:overflow-y-auto">
          <CharacterSheetPanel character={characterRecord?.data ?? null} inventory={inventory} />
          <InventoryPanel items={inventory} />
        </aside>
      </div>
    </div>
  )
}
