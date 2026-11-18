/**
 * Design Direction
 *
 * Product: A shared d20 table where friends and an AI Game Master play one continuous campaign in real time.
 * Emotion: The held breath while the die is still rolling, and the certainty the table is real.
 * Metaphor: A rune-lit vault door with the party's lanterns reflected in the flooded floor.
 * References: Diablo II inventory chrome; a 1993 Amiga title screen; municipal wayfinding signage.
 * Signature: One d20 that draws its own edges in stone linework and settles on 17.
 * Hero: The d20's edges trace once, its faces dither in, and the check panel stamps into place — one sequence, no idle loop.
 *
 * Style Tile
 * - Color: Near-black ground, zinc hairlines, a single amber signal; crimson only for damage.
 * - Type: Silkscreen for labels and numerals, system sans at 14px for prose: pixel for identity, sans for reading.
 * - Theme: Dark only — the table is a dim stone room, and light would turn stone into paper.
 * - Art direction: Pixel as chrome and signal: stepped 2px frames, dithered fills, segmented HP, zero raster.
 * - Motion: Mechanical and restrained — one draw, one stamp, no loops; respects prefers-reduced-motion.
 * - Voice: Second person; starts with a verb; names the mechanism instead of praising it.
 */

/**
 * Landing page — a STATIC page.
 *
 * It lives at the top level of src/pages/ (not under (app)/), so it renders
 * with no DeepSpace providers: no auth session fetch, no records WebSocket.
 * That makes it cheap to serve and safe for logged-out / crawler traffic.
 *
 * It is also prerendered to static HTML at build (prerender.ts, via
 * vite.config.ts) so crawlers read real content. Keep it renderable without a
 * browser: no window/document during render, prose in HTML text, and motion in
 * CSS keyframes rather than JS-driven initial states. `<Seo>` comes first and
 * reads src/seo.ts.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { Badge, buttonVariants } from '../components/ui'
import { cn } from '../lib/utils'
import { seo } from '../seo'

/** Hero mockup data — fixed values, never generated: the same roll every load. */
const HERO_HP_CURRENT = 22
const HERO_HP_MAX = 24
const HERO_HP_SEGMENTS = Array.from({ length: HERO_HP_MAX }, (_, index) => index < HERO_HP_CURRENT)

/**
 * One hand-authored icosahedron. The silhouette carries `pathLength="1"` and a
 * single-unit dash so the shared `d20-trace` keyframe draws it once; interior
 * face lines render solid, so reduced motion simply shows the finished die.
 */
function D20Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M100 8 L182 52 L182 148 L100 192 L18 148 L18 52 Z"
        pathLength={1}
        strokeDasharray={1}
        className="d20-trace"
      />
      <g className="text-foreground" strokeWidth={2}>
        <path d="M100 32 L158 138 L42 138 Z" />
        <path d="M100 8 L100 32" />
        <path d="M182 148 L158 138" />
        <path d="M18 148 L42 138" />
      </g>
    </svg>
  )
}

/**
 * The check panel: one resolved d20 roll and the sheet row it lands on. Purely
 * presentational — every number is authored above, so the prerender and the
 * hydrated page agree.
 */
function HeroMockup() {
  return (
    <div className="pixel-frame roll-tick w-full max-w-sm justify-self-center bg-card">
      <div className="flex items-center justify-between gap-3 border-b-2 border-border px-4 py-2.5">
        <span className="pixel-numeral text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          DEX CHECK · DC 12
        </span>
        <Badge
          variant="default"
          size="sm"
          className="pixel-numeral shrink-0 rounded-none uppercase tracking-wider"
        >
          SUCCESS
        </Badge>
      </div>

      <div className="px-4 pt-5">
        <div className="flex justify-center">
          <div className="pixel-dither border-2 border-border p-3">
            <D20Mark className="h-40 w-40 text-primary" />
          </div>
        </div>
        <p className="pixel-numeral mt-4 text-center text-xl text-foreground">14 + 3 = 17</p>
      </div>

      <div className="pixel-rule mx-4 mt-5" />

      <div className="px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="pixel-numeral truncate text-[11px] uppercase tracking-wider text-foreground">
              KAELEN
            </span>
            <span className="pixel-numeral text-[10px] uppercase tracking-wider text-muted-foreground">
              VANGUARD
            </span>
          </div>
          <span className="pixel-numeral shrink-0 text-[10px] uppercase text-muted-foreground">
            AC <span className="text-foreground">16</span>
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="pixel-numeral shrink-0 text-[10px] uppercase text-muted-foreground">
            HP <span className="text-foreground">22/24</span>
          </span>
          <div aria-hidden="true" className="flex flex-1 gap-px">
            {HERO_HP_SEGMENTS.map((isFilled, index) => (
              <span
                key={index}
                className={cn('hp-segment h-2.5 flex-1', isFilled ? 'bg-primary' : 'bg-muted')}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div
        data-testid="static-landing"
        className="relative min-h-screen overflow-hidden bg-background text-foreground"
      >
        <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center gap-14 px-6 py-16 lg:grid lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-20">
          <div>
            <p className="pixel-numeral text-[11px] uppercase tracking-[0.32em] text-muted-foreground">
              LORESPACE
            </p>
            <h1 className="mt-5 text-5xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
              Roll together. The vault remembers.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
              A live d20 table for you, your friends, and a Game Master that reads the dice
              instead of inventing them. Every roll is computed server-side and every consequence
              lands in the same row for everyone.
            </p>
            <div className="mt-9 flex flex-col items-start gap-3">
              <Link
                to="/home"
                className={cn(buttonVariants({ variant: 'default', size: 'lg' }), 'px-7 font-semibold')}
              >
                Enter the table
              </Link>
              <p className="text-sm text-muted-foreground">
                Signed out, you watch the real table. Sign in to take a seat.
              </p>
            </div>
          </div>

          <HeroMockup />
        </div>
      </div>
    </>
  )
}
