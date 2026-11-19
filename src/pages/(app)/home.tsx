/* home pattern: product-preview-first — live multiplayer VTT campaign table, dice log, and character sheet */

/**
 * The table — `/home`, the live campaign workspace (`P1.7`, `P1.8`, `P1.9`,
 * `P1.11`, `P2.5`).
 *
 * It is a shell, not a scrolling page: `<main>` in `(app)/_layout.tsx` owns the
 * page scroll and is already `h-full`, so on desktop the shell fills it and each
 * column scrolls its own content. Below `lg` the columns stack in reading order
 * (party → feed → sheet) and the page scrolls normally.
 *
 * Signed in, the sheet and the pack are live: `/home` reads `characters` and
 * `inventory` for this campaign and hands each panel the viewer's rows. Those
 * panels write through server actions and owner-scoped deletes (ADR 0015), and
 * the results come back over the room subscription. Signed out, every panel
 * falls back to the deterministic `PREVIEW_*` table (ADR 0014).
 * The roster is live when signed in (`P4.3`): `PartyPresenceBar` opens the
 * campaign's presence room and joins each present peer to a `characters` row.
 * Signed out there is no socket and no liveness claim (ADR 0006).
 *
 * Every surface here resolves live rows first and falls back per ADR 0014: the
 * campaign, the sheet, the pack, the feed (`P4.11`) and the roster. Signed out,
 * one derivation picks the preview character so the sheet, the pack and the
 * roster cannot show two different parties — the anonymous viewer reads the same
 * collections, so an empty one just means nobody has seeded yet. The GM console
 * is the only remaining fixture (`P5`).
 *
 * The one write this page makes itself is the seed (ADR 0007, `P2.5`): signed in
 * on an empty `campaigns` collection, `/home` POSTs
 * `/api/actions/ensureDefaultCampaign` once per mount, renders a skeleton until
 * it resolves, and shows a notice if it fails — never a silent fixture fallback.
 * No record write, no mutation hook here: the seeded row reaches the UI over the
 * room subscription.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth, useQuery } from 'deepspace'
import { CharacterSheetPanel, type QueryStatus, type SheetMode } from '@/components/CharacterSheetPanel'
import { GmConsolePanel } from '@/components/GmConsolePanel'
import { InventoryPanel } from '@/components/InventoryPanel'
import { ActionFeed } from '@/components/vtt/ActionFeed'
import { PartyPresenceBar } from '@/components/PartyPresenceBar'
import { PartyRoster, type RosterMember } from '@/components/vtt/PartyRoster'
import { RollBannerLayer } from '@/components/vtt/RollBannerLayer'
import { newestFirst } from '@/lib/roll-announcements'
import { SceneBanner } from '@/components/vtt/SceneBanner'
import { SignInBanner } from '@/components/vtt/SignInBanner'
import { useToast } from '@/components/ui'
import { DEFAULT_CAMPAIGN_ID } from '@/constants'
import { callAction, ActionCallError } from '@/lib/actions'
import { DEFAULT_CAMPAIGN_SEED, type CampaignRow } from '@/lib/campaign-seed'
import type { AbilityScoreKey } from '@/lib/party-presence'
import {
  PREVIEW_CAMPAIGN,
  PREVIEW_CHARACTERS,
  PREVIEW_GM_MESSAGES,
  PREVIEW_INVENTORY,
  PREVIEW_ROLLS,
  type CharacterRow,
  type InventoryRow,
  type RollLogRow,
} from '@/lib/preview-data'

/**
 * The seed round-trip. `idle` → `seeding` → `seeded` | `failed`; `idle` is "not
 * signed in, or the collection already has a row, so there is nothing to do".
 */
type SeedState = 'idle' | 'seeding' | 'seeded' | 'failed'

/** `ensureDefaultCampaign`'s success data, spelled out locally: importing the
 *  action module for its type would put worker-only modules (zod,
 *  `deepspace/worker`) in this page's import graph. */
interface SeedResult {
  campaignId: string
  created: boolean
}

export default function HomePage() {
  const { isSignedIn, userId } = useAuth()
  const { records, status } = useQuery<CampaignRow>('campaigns')
  // Both are campaign-scoped reads; the viewer's own rows are picked out below.
  const { records: characterRecords, status: charactersStatus } = useQuery<CharacterRow>(
    'characters',
    { where: { campaignId: DEFAULT_CAMPAIGN_ID } },
  )
  const { records: inventoryRecords, status: inventoryStatus } = useQuery<InventoryRow>(
    'inventory',
    { where: { campaignId: DEFAULT_CAMPAIGN_ID } },
  )
  // The feed (`P4.11`, `P4.18`). No `limit`: the read returns every row for the
  // campaign, so "show all" in the feed means all of them rather than a page.
  // No `orderBy` either — the record layer already sorts by `_created_at DESC`,
  // and a `rolledAt` sort would order against that system column for no gain
  // (ADR 0003). A long campaign would need paging, and the client `Query` has no
  // `offset`, so that is a later decision, not a missing parameter.
  const { records: rollRecords, status: rollStatus } = useQuery<RollLogRow>('roll-logs', {
    where: { campaignId: DEFAULT_CAMPAIGN_ID },
  })

  // A live insert arrives appended to the client's array (the unbounded read has
  // no re-query to restore the order), so newest-first is applied here once and
  // shared by the feed and the banner layer (`P4.18`).
  const liveRolls = useMemo(() => newestFirst(rollRecords), [rollRecords])

  // The feed's own height depends on this, so `/home` owns it: minimised, the
  // feed is five rows and the GM console takes the rest of the column; expanded,
  // the feed takes the column and scrolls (`P4.19`).
  const [feedExpanded, setFeedExpanded] = useState(false)
  const { error: toastError } = useToast()

  const [seedState, setSeedState] = useState<SeedState>('idle')
  // Set on dispatch, not on success: one attempt per mount (ADR 0007 — a failed
  // seed retries on the next mount, not in a loop). A success flag here would
  // let a failure re-fire on the next render.
  const seedFired = useRef(false)


  const liveCampaign =
    records.find((record) => record.recordId === DEFAULT_CAMPAIGN_ID)?.data ?? null
  const hasLiveCampaign = liveCampaign !== null

  useEffect(() => {
    if (!isSignedIn) return
    if (status !== 'ready') return
    // Gate on the *seeded row*, not on "the collection has rows": a foreign
    // campaign row must not leave the table unseeded and silently on the
    // fixture. A stray row is harmless — the seed upserts its own id.
    if (hasLiveCampaign) return
    if (seedFired.current) return

    seedFired.current = true
    setSeedState('seeding')
    // No cleanup cancellation flag: clearing `seedState` on unmount is
    // irrelevant, and one on a dep change would strand the page at `seeding`.
    void callAction<SeedResult>('ensureDefaultCampaign')
      .then(() => setSeedState('seeded'))
      .catch((error: unknown) => {
        setSeedState('failed')
        const message =
          error instanceof ActionCallError ? error.message : 'The seed request failed.'
        toastError('Campaign unavailable', message)
      })
  }, [isSignedIn, status, hasLiveCampaign, toastError])

  // Skeleton while the first signed-in paint has no live row and is either still
  // reading the collection or mid-seed. Deliberately not `records.length === 0`
  // alone: that never ends if the subscription lags, and it would cover the
  // signed-out preview. Once `seeded`, the seed renders even if the read
  // status flips back to `loading`.
  const showSkeleton =
    isSignedIn &&
    !hasLiveCampaign &&
    seedState !== 'seeded' &&
    (status === 'loading' || seedState === 'seeding')

  // Signed in, the fixture may only be shown when the page says so: the seed
  // failed, or the campaigns read itself errored (a silently fixture-backed
  // table is the fallback ADR 0007 rejects). Never when the live row is up —
  // the notice would then contradict the banner above it.
  const campaignUnavailable =
    !hasLiveCampaign && (seedState === 'failed' || (isSignedIn && status === 'error'))

  // Live row when it exists; after a successful seed, the seed itself until the
  // subscription delivers the row (same eight values by construction, so this
  // is the real state and not a stand-in); the fixture otherwise — signed out,
  // or signed in after a failed seed, where a notice sits above the table.
  const campaign =
    liveCampaign ?? (seedState === 'seeded' ? DEFAULT_CAMPAIGN_SEED : PREVIEW_CAMPAIGN.data)

  // Signed in, your sheet is the row bound to your user id — no row yet means no
  // character, so the panel renders the Forge. Signed out you are watching the
  // table: the first live character when the collection has one, the fixture
  // character when nobody has seeded yet (ADR 0014).
  const myCharacter = isSignedIn
    ? (characterRecords.find((record) => record.data.userId === userId) ?? null)
    : (characterRecords[0] ?? PREVIEW_CHARACTERS[0] ?? null)

  // True while the sheet is showing a live row to a signed-out viewer; that is
  // also what decides the pack and the roster below, so one character cannot
  // come with another character's items.
  const previewFromLiveRows = !isSignedIn && characterRecords.length > 0

  // `inventory.characterId` holds a character record id, so the pack is the rows
  // pointing at the character resolved above — the same rows the sheet counts.
  // Signed out, the fixture items only ever pair with the fixture character.
  const myItems = isSignedIn
    ? inventoryRecords.filter((record) => record.data.characterId === myCharacter?.recordId)
    : previewFromLiveRows
      ? inventoryRecords.filter((record) => record.data.characterId === myCharacter?.recordId)
      : PREVIEW_INVENTORY.filter(
          (record) => record.data.characterId === (PREVIEW_CHARACTERS[0]?.recordId ?? ''),
        )

  // Signed out, the roster is whatever the sheet is showing: the live party when
  // there is one, else the fixture party. No presence socket is open on this
  // branch, so `online` stays undefined and the rows draw no dot (ADR 0006).
  // Signed in, `PartyPresenceBar` replaces this entirely.
  const previewRoster: RosterMember[] = (
    previewFromLiveRows ? characterRecords : PREVIEW_CHARACTERS
  ).map((record) => ({
    id: record.recordId,
    name: record.data.name,
    archetype: record.data.archetype,
    hp: record.data.hp,
    maxHp: record.data.maxHp,
  }))

  // Signed out the feed shows the same table it is previewing: when nobody has
  // seeded a character there is nothing live to be coherent with, so the whole
  // preview is the fixture. Once the party is live, the feed is the live
  // `roll-logs` read — empty, loading or failed as it may be — because a fixture
  // roll attributed to a fixture name beside a live sheet is the incoherence
  // ADR 0014 and `P4.9` forbid.
  const feedEntries = isSignedIn
    ? liveRolls
    : previewFromLiveRows
      ? liveRolls
      : PREVIEW_ROLLS
  const feedStatus: QueryStatus = isSignedIn
    ? rollStatus
    : previewFromLiveRows
      ? rollStatus
      : 'ready'

  const sheetMode: SheetMode = isSignedIn ? 'live' : 'preview'
  // The pack waits on both reads: it cannot filter by a character it has not
  // resolved, so a loading character read leaves it loading too, and a failed
  // one leaves it in the same read-error state instead of claiming "nothing
  // carried".
  const inventoryPanelStatus: QueryStatus = !isSignedIn
    ? 'ready'
    : charactersStatus === 'loading' || inventoryStatus === 'loading'
      ? 'loading'
      : charactersStatus === 'error'
        ? 'error'
        : inventoryStatus

  return (
    <div
      data-testid="workspace-shell"
      className="flex min-h-full flex-col gap-3 bg-shell p-3 lg:h-full lg:min-h-0"
    >
      {showSkeleton ? (
        <WorkspaceSkeleton />
      ) : (
        <>
          {/* The banner reads the `roll-logs` rows, never a presence payload
              (ADR 0021), and it is rendered on both branches: a signed-out
              window reads the same public rows (ADR 0014), so the demo table
              announces to every open tab without joining the campaign room. */}
          <RollBannerLayer entries={liveRolls} status={rollStatus} />

          <div className="shrink-0">
            <SceneBanner campaign={campaign} />
          </div>

          {!isSignedIn && (
            <div className="shrink-0">
              <SignInBanner />
            </div>
          )}

          {campaignUnavailable && (
            <div className="shrink-0">
              <SeedFailedNotice />
            </div>
          )}

          <div
            data-testid={isSignedIn ? undefined : 'preview-table'}
            className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)_minmax(0,340px)] lg:grid-rows-[minmax(0,1fr)]"
          >
            <aside className="flex min-h-0 flex-col gap-3 bg-shell-panel lg:overflow-y-auto">
              <div className="pixel-frame bg-card">
                {/* Conditional *component*, not a conditional hook: the presence
                    socket must not be opened on the signed-out branch. */}
                {isSignedIn ? (
                  <PartyPresenceBar
                    characters={characterRecords}
                    myCharacter={myCharacter}
                    userId={userId ?? ''}
                  />
                ) : (
                  <PartyRoster members={previewRoster} />
                )}
              </div>
            </aside>

            {/* Whichever panel is not reading its oldest rows gets the leftover
                height (`P4.19`): minimised, the feed is five rows and the GM
                console fills the column and scrolls its own messages; expanded,
                the feed fills and scrolls and the GM keeps its natural height at
                the bottom, so it is never pushed off screen (`P4.14`). */}
            <section className="flex min-h-0 flex-col gap-3 bg-shell-panel lg:overflow-hidden">
              <div
                className={
                  feedExpanded
                    ? // Content height, capped by the column and shrunk only when
                      // the rows do not fit, so a short feed has no scrollbar and a
                      // long one scrolls inside its frame (`P4.21`).
                      'pixel-frame flex min-h-0 flex-col bg-card lg:max-h-full lg:overflow-y-auto'
                    : // A fixed window while minimised (`P4.20`): four compact rows
                      // plus the header, the same height whether the table has one
                      // roll or four, so the GM console below does not jump as rows
                      // arrive. Scrolls only if a short viewport cannot give it
                      // that height. Written as a literal class: Tailwind scans
                      // source text, so an interpolated class name is never
                      // generated.
                      'pixel-frame flex flex-col bg-card lg:h-[21.5rem] lg:max-h-full lg:overflow-y-auto'
                }
              >
                <ActionFeed
                  entries={feedEntries}
                  status={feedStatus}
                  expanded={feedExpanded}
                  onToggleExpanded={() => {
                    setFeedExpanded((open) => !open)
                  }}
                />
              </div>
              {/* Fills whatever the feed leaves, and gives a few pixels back
                  before the feed is forced to scroll: `flex-1` grows into empty
                  space, and `min-h-48` (header + input + a scrollable message
                  list) is the floor, so the expanded feed only scrolls when the
                  rows genuinely cannot share the column (`P4.19`, `P4.21`). */}
              <div className="flex min-h-0 flex-col lg:min-h-48 lg:flex-1 lg:overflow-hidden">
                <GmConsolePanel messages={PREVIEW_GM_MESSAGES} />
              </div>
            </section>

            <aside className="flex min-h-0 flex-col gap-3 bg-shell-panel lg:overflow-y-auto">
              <CharacterSheetPanel
                mode={sheetMode}
                status={isSignedIn ? charactersStatus : 'ready'}
                character={myCharacter}
                items={myItems}
              />
              <InventoryPanel mode={sheetMode} status={inventoryPanelStatus} items={myItems} />
            </aside>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Bar widths per column, in the real layout's order: party, feed, sheet. The
 * widths double as keys: no bar repeats a width inside its column.
 */
const SKELETON_BARS: readonly (readonly number[])[] = [
  [78, 62, 90, 70],
  [64, 100, 88, 72, 94],
  [70, 54, 88, 62],
]

/**
 * The workspace with nothing in it yet — the same banner bar and the same three
 * columns as the loaded shell, so the seed round-trip reads as the page
 * arriving rather than as an empty state (ADR 0007). It replaces the banner
 * slot instead of feeding `SceneBanner` a null campaign.
 */
function WorkspaceSkeleton() {
  return (
    <div
      data-testid="workspace-skeleton"
      aria-busy="true"
      aria-label="Loading the campaign"
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <div className="pixel-frame shrink-0 bg-card px-4 py-3">
        <SkeletonBar className="h-3" width={42} />
        <SkeletonBar className="mt-2 h-2.5" width={68} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)_minmax(0,340px)] lg:grid-rows-[minmax(0,1fr)]">
        {SKELETON_BARS.map((widths) => (
          <div
            key={widths.join('-')}
            className="flex min-h-0 flex-col gap-3 bg-shell-panel"
          >
            <div className="pixel-frame flex min-h-0 flex-1 flex-col gap-2 bg-card p-3">
              {widths.map((width) => (
                <SkeletonBar key={width} className="h-2.5" width={width} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One pulsing placeholder line; width is a percentage of its column. */
function SkeletonBar({ className, width }: { className?: string; width: number }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-sm bg-muted ${className ?? ''}`}
      style={{ width: `${String(width)}%` }}
    />
  )
}

/**
 * The unavailable-campaign notice. A seed that never landed — or a read that
 * errored — leaves the page on the fixture, and showing that without saying so
 * is the silent fallback ADR 0007 rejects. The reason itself arrives as a toast
 * (seed failure) or as the query's own error; this stays one sentence.
 */
function SeedFailedNotice() {
  return (
    <div
      data-testid="seed-failed"
      className="pixel-frame flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-secondary px-4 py-2"
    >
      <span className="font-pixel text-[10px] uppercase text-primary">PREVIEW</span>
      <p className="text-xs text-muted-foreground">
        The live campaign could not be loaded, so this is the preview table. Reload to try
        again.
      </p>
    </div>
  )
}
