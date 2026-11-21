/**
 * Is this a small viewport? (`P5.45`)
 *
 * One query for every responsive decision that cannot be expressed in CSS: the
 * scene header's compact variant and the minimised feed's row count must agree,
 * or a tablet shows a small banner above a feed sized for a desktop.
 *
 * The breakpoint matches `SceneBanner`'s media query exactly: narrower than
 * 1024px **or** shorter than 900px — an iPad mini in either orientation.
 *
 * Client-only by nature; the first render assumes desktop, which is the safe
 * direction (more rows, larger banner) rather than a flash of empty space.
 */

import { useEffect, useState } from 'react'

const QUERY = '(max-width: 1023px), (max-height: 899px)'

export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(false)

  useEffect(() => {
    const query = window.matchMedia(QUERY)
    const update = () => setCompact(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return compact
}
