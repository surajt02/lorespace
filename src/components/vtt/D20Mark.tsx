/**
 * The d20 signature sprite (ADR 0013), shared by the landing hero and the roll
 * banner (`P4.10`). Pure SVG, no hooks and no browser API, so the prerendered
 * landing page can import it.
 *
 * One hand-authored icosahedron. The silhouette carries `pathLength="1"` and a
 * single-unit dash so the shared `d20-trace` keyframe draws it once; interior
 * face lines render solid, so reduced motion simply shows the finished die.
 */

export function D20Mark({ className }: { className?: string }) {
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
