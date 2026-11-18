/**
 * Theme catalog.
 *
 * Obsidian is the app's only theme (ADR 0008 cut the theme switcher): near-black
 * stone, amber signal, zero radius, in the pixel-chrome register of ADR 0013.
 * The values themselves live in styles.css (`@theme` default) and
 * themes.css (`[data-theme="obsidian"]`) — this file is metadata only.
 *
 * To add a theme:
 *   1. Add a `[data-theme="my-id"] { ... }` block in src/themes.css with
 *      the shadcn token overrides (include `color-scheme: light;` for
 *      light themes).
 *   2. Add an entry here for type safety, autocomplete, and UI display.
 *   3. Add the theme's background to the first-paint <style> block in
 *      index.html so the pre-CSS frame matches (no white flash).
 *   4. Switch via `data-theme` on <html> in index.html.
 */

export const THEMES = [
  {
    id: 'obsidian',
    label: 'Obsidian',
    description: 'Near-black stone, amber signal, zero radius.',
  },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

/** Read the currently active theme id from <html data-theme>. */
export function getActiveTheme(): ThemeId {
  if (typeof document === 'undefined') return 'obsidian'
  const id = document.documentElement.getAttribute('data-theme') as ThemeId | null
  return id ?? 'obsidian'
}

/** Look up a theme entry by id, or fall back to the first theme. */
export function getTheme(id: string) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
