/**
 * Scene banner — the table's top strip: campaign title (the page `<h1>`),
 * location, atmosphere, where the table is in the arc, scene prose, the active
 * DC block, the enemy HP tracker, and the campaign control (`P5.16`, `P5.20`).
 *
 * The active DC lives beside the prose, not in the meta row: it is the number the
 * table is being asked to beat, so it is read at a glance (`P5.20`). It shows the
 * **viewer's pending check's** DC while that character owes a roll — with a
 * pulse, because they are being waited on — and the scene's baseline DC
 * otherwise. That is what makes a risky jump (17) and a heavy lever (12)
 * different numbers in one scene. Another player's ask lives on their own row and
 * does not move this number (ADR 0030).
 *
 * Prop-driven (`P1.10`): `P2.x`/`P3.x` pass a live campaign row instead of the
 * fixture. The enemy block is a branch, not a fixture decision — ADR 0011's
 * seed is the threshold state (no enemy), so it renders only once the GM puts
 * one on the table (`enemyMaxHp > 0`, ADR 0024).
 *
 * Presentational, and the progress/button props are optional: the page owns the
 * reset call, the confirm modal and the loading flag, so a banner rendered
 * without them (`P1.11`'s preview, any test) is unchanged. `progress` is passed
 * through verbatim — `progressLabel()` in `campaign-arc.ts` is the only thing
 * that knows the arc's wording, and the uppercase is CSS.
 *
 * It scales down rather than being fixed (`P5.14`, iPad mini): on a narrow or
 * short window the strip would otherwise take a third of the table's height for
 * information read once. The compact density is one arbitrary media variant —
 * width under 1024px (portrait tablet) *or* height under 900px (landscape
 * tablet), spelled `[@media(max-width:1023px),(max-height:899px)]:` — applied
 * per utility with Tailwind only, so the markup stays one composition with two
 * densities. It is written literally on every class, never concatenated:
 * Tailwind scans source text, so only a literal class name is generated. What
 * must not shrink below legibility is the `ACTIVE DC` number; the prose is
 * clamped to two lines but never removed, and the progress, the start button and
 * the enemy tracker stay at every size.
 */

import { Badge, Button } from '@/components/ui'
import type { CampaignRow } from '@/lib/preview-data'
import { cn } from '@/lib/utils'

/** Bar length; HP is scaled into it so a 40-HP boss still fits the strip. */
const SEGMENTS = 24

export interface SceneBannerProps {
  campaign: CampaignRow
  /** `'Act I · Scene 2 of 5'` (`progressLabel`), rendered as a micro-label. */
  progress?: string
  /** Present when the viewer may start a new game; absent means no button. */
  onStartCampaign?: () => void
  /** `'Start campaign'` on a fresh table, `'Start New Campaign'` otherwise. */
  startLabel?: string
  /** The reset is in flight: the button announces it and cannot be clicked. */
  starting?: boolean
  /**
   * The DC this viewer is up against: their pending check's own number while one
   * is owed, else the scene's (`dcDisplay`). Falls back to the row's
   * `activeThreatDc` when a caller renders the banner on its own.
   */
  activeDc?: number
  /** The viewer's check is pending: the block pulses, because they must roll. */
  dcPending?: boolean
}

export function SceneBanner({
  campaign,
  progress,
  onStartCampaign,
  startLabel = 'Start campaign',
  starting = false,
  activeDc,
  dcPending = false,
}: SceneBannerProps) {
  const maxHp = campaign.enemyMaxHp
  const hp = Math.min(Math.max(campaign.enemyHp, 0), maxHp)
  const filled = maxHp > 0 ? Math.round((hp / maxHp) * SEGMENTS) : 0
  const dc = activeDc ?? campaign.activeThreatDc

  return (
    <section
      data-testid="scene-banner"
      className={cn(
        'pixel-frame pixel-dither relative overflow-hidden p-4',
        '[@media(max-width:1023px),(max-height:899px)]:p-2.5',
      )}
    >
      <div aria-hidden="true" className="pixel-strip absolute inset-0" />

      <div
        className={cn(
          'relative flex flex-wrap items-end justify-between gap-3',
          '[@media(max-width:1023px),(max-height:899px)]:gap-2',
        )}
      >
        <div className="min-w-0">
          <h1
            className={cn(
              'truncate text-xl font-semibold text-foreground',
              '[@media(max-width:1023px),(max-height:899px)]:text-lg',
            )}
          >
            {campaign.title}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{campaign.locationName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {progress && (
            <span
              data-testid="scene-progress"
              className="font-pixel text-[10px] uppercase text-muted-foreground"
            >
              {progress}
            </span>
          )}
          <Badge variant="secondary" className="font-pixel text-[10px] uppercase">
            {campaign.atmosphereTag}
          </Badge>
          {onStartCampaign && (
            <Button
              data-testid="start-campaign"
              variant="outline"
              size="sm"
              loading={starting}
              onClick={onStartCampaign}
              className={cn(
                'rounded-none border-border bg-background font-pixel text-[10px] uppercase',
                '[@media(max-width:1023px),(max-height:899px)]:h-6',
                '[@media(max-width:1023px),(max-height:899px)]:px-2',
              )}
            >
              {startLabel}
            </Button>
          )}
        </div>
      </div>

      <div
        className={cn('pixel-rule relative my-3', '[@media(max-width:1023px),(max-height:899px)]:my-2')}
      />

      {/* Prose left, the DC right (`P5.20`): the number the table must beat is
          the one thing on this strip that has to be readable from across the
          room, so it is a large block rather than a badge in the meta row. */}
      <div
        className={cn(
          'relative grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center',
          '[@media(max-width:1023px),(max-height:899px)]:gap-2',
        )}
      >
        <p
          data-testid="scene-description"
          className={cn(
            'max-w-3xl text-sm text-muted-foreground',
            '[@media(max-width:1023px),(max-height:899px)]:text-xs',
            // Two lines is the compact density's whole point: the prose stays,
            // the strip does not grow with it. Never removed (`P5.14`).
            '[@media(max-width:1023px),(max-height:899px)]:line-clamp-2',
          )}
        >
          {campaign.sceneSummary}
        </p>
        <div
          data-testid="active-dc"
          data-pending={dcPending ? 'true' : 'false'}
          className={cn(
            'flex min-h-[6rem] min-w-[9rem] flex-col justify-center border px-4 py-3 md:items-end',
            '[@media(max-width:1023px),(max-height:899px)]:min-h-[3.5rem]',
            '[@media(max-width:1023px),(max-height:899px)]:min-w-[5.5rem]',
            '[@media(max-width:1023px),(max-height:899px)]:px-2.5',
            '[@media(max-width:1023px),(max-height:899px)]:py-1.5',
            dcPending
              ? 'animate-pulse border-primary bg-primary/5'
              : 'border-border bg-background',
          )}
        >
          <span className="font-pixel text-[10px] uppercase text-muted-foreground">
            Active DC
          </span>
          <span
            className={cn(
              'pixel-numeral text-5xl leading-none',
              '[@media(max-width:1023px),(max-height:899px)]:text-3xl',
              dcPending ? 'text-primary' : 'text-foreground',
            )}
          >
            {dc}
          </span>
        </div>
      </div>

      {maxHp > 0 && (
        <div
          className={cn(
            'relative mt-3 flex flex-wrap items-center gap-3',
            '[@media(max-width:1023px),(max-height:899px)]:mt-2',
            '[@media(max-width:1023px),(max-height:899px)]:gap-2',
          )}
        >
          <span
            className={cn(
              'font-pixel text-[10px] uppercase text-muted-foreground',
              '[@media(max-width:1023px),(max-height:899px)]:text-[9px]',
            )}
          >
            {campaign.enemyName || 'Enemy'}
          </span>
          <div className="flex flex-1 items-center gap-px" aria-hidden="true">
            {Array.from({ length: SEGMENTS }, (_, index) => (
              <span
                key={index}
                className={cn(
                  'hp-segment h-2 flex-1',
                  // A thinner bar on a tablet: the tracker still reads, the
                  // strip stays short.
                  '[@media(max-width:1023px),(max-height:899px)]:h-1.5',
                  index < filled ? 'bg-destructive' : 'bg-muted',
                )}
              />
            ))}
          </div>
          <span className="pixel-numeral text-[10px]">
            <span className="text-destructive">{hp}</span>
            <span className="text-muted-foreground">/{maxHp}</span>
          </span>
        </div>
      )}
    </section>
  )
}
