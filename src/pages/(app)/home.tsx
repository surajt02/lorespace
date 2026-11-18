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
 * Everything below the campaign row is fixture data this phase (ADR 0014): the
 * panels take rows as props, so Phase 3 and 4 swap `PREVIEW_*` for live queries
 * without touching their markup.
 *
 * The one write from this page is the seed (ADR 0007, `P2.5`): signed in on an
 * empty `campaigns` collection, `/home` POSTs `/api/actions/ensureDefaultCampaign`
 * once per mount, renders a skeleton until it resolves, and shows a notice if it
 * fails — never a silent fixture fallback. No record write, no mutation hook:
 * the seeded row reaches the UI over the room subscription.
 */

import { useEffect, useRef, useState } from 'react'
import { useAuth, useQuery } from 'deepspace'
import { CharacterSheetPanel } from '@/components/CharacterSheetPanel'
import { GmConsolePanel } from '@/components/GmConsolePanel'
import { InventoryPanel } from '@/components/InventoryPanel'
import { ActionFeed } from '@/components/vtt/ActionFeed'
import { PartyRoster, type RosterMember } from '@/components/vtt/PartyRoster'
import { SceneBanner } from '@/components/vtt/SceneBanner'
import { SignInBanner } from '@/components/vtt/SignInBanner'
import { useToast } from '@/components/ui'
import { DEFAULT_CAMPAIGN_ID } from '@/constants'
import { callAction, ActionCallError } from '@/lib/actions'
import { DEFAULT_CAMPAIGN_SEED, type CampaignRow } from '@/lib/campaign-seed'
import {
  PREVIEW_CAMPAIGN,
  PREVIEW_CHARACTERS,
  PREVIEW_GM_MESSAGES,
  PREVIEW_INVENTORY,
  PREVIEW_ROLLS,
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
      {showSkeleton ? (
        <WorkspaceSkeleton />
      ) : (
        <>
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
