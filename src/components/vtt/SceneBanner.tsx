/**
 * Scene banner — the table's top strip: campaign title (the page `<h1>`),
 * location, atmosphere, active DC, where the table is in the arc, scene prose,
 * the enemy HP tracker, and the campaign control (`P5.16`).
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
 */

import { Badge, Button } from '@/components/ui'
import type { CampaignRow } from '@/lib/preview-data'

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
}

export function SceneBanner({
  campaign,
  progress,
  onStartCampaign,
  startLabel = 'Start campaign',
  starting = false,
}: SceneBannerProps) {
  const maxHp = campaign.enemyMaxHp
  const hp = Math.min(Math.max(campaign.enemyHp, 0), maxHp)
  const filled = maxHp > 0 ? Math.round((hp / maxHp) * SEGMENTS) : 0

  return (
    <section
      data-testid="scene-banner"
      className="pixel-frame pixel-dither relative overflow-hidden p-4"
    >
      <div aria-hidden="true" className="pixel-strip absolute inset-0" />

      <div className="relative flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-foreground">{campaign.title}</h1>
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
          <Badge variant="outline" className="pixel-numeral text-[10px]">
            Active DC {campaign.activeThreatDc}
          </Badge>
          {onStartCampaign && (
            <Button
              data-testid="start-campaign"
              variant="outline"
              size="sm"
              loading={starting}
              onClick={onStartCampaign}
              className="rounded-none border-border bg-background font-pixel text-[10px] uppercase"
            >
              {startLabel}
            </Button>
          )}
        </div>
      </div>

      <div className="pixel-rule relative my-3" />

      <p className="relative max-w-3xl text-sm text-muted-foreground">{campaign.sceneSummary}</p>

      {maxHp > 0 && (
        <div className="relative mt-3 flex flex-wrap items-center gap-3">
          <span className="font-pixel text-[10px] uppercase text-muted-foreground">
            {campaign.enemyName || 'Enemy'}
          </span>
          <div className="flex flex-1 items-center gap-px" aria-hidden="true">
            {Array.from({ length: SEGMENTS }, (_, index) => (
              <span
                key={index}
                className={
                  index < filled ? 'hp-segment h-2 flex-1 bg-destructive' : 'hp-segment h-2 flex-1 bg-muted'
                }
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
