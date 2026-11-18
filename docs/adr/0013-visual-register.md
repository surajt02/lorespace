# 0013 — Visual register: Diablo-ward pixel chrome

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** UI
- **Constraints:** `P1.1`, `P1.5`, `P1.6`, `P1.13`; every component inherits it

## Context

Phase 1 must give the app a look. Fixed already: obsidian `#09090b`, amber
`#d97706`, crimson damage, zinc hairlines. Open: the register. The direction
given is **closer to Diablo than Mörk Borg, preferably pixel art** — read as
gothic weight and hard-edged stone, not 8-bit cuteness, and not zine austerity.

Constraints from the app itself: three-column density at 14px, a prerendered
landing page (no browser APIs during render), no AI-generated imagery allowed in
the hero, and a 96-hour budget with no asset pipeline.

## Decision

**Pixel as chrome and signal, not as a filter over everything.**

- `--radius: 0`; stepped 2px borders via layered `box-shadow`; dithered
  gradients via `repeating-linear-gradient`; ornamental SVG dividers.
- **Silkscreen** (pixel webfont) for labels, badges and **all numerals**; prose
  in the existing system sans at 14px for legibility at density.
- HP as **segmented** blocks (crimson / amber / green), never a smooth bar.
- **Zero raster files.** One hand-authored inline SVG signature sprite: a d20
  that draws itself on the roll banner.
- Amber is the only accent; crimson is reserved for damage and destruction.

## Consequences

- **Positive:** strong identity that survives three columns; no asset pipeline,
  no bundle weight, prerender-safe; every new component inherits the register
  through tokens and shared utilities instead of per-component art.
- **Negative:** pixel type at small sizes is genuinely harder to read, so the
  rule "prose stays sans" has to be enforced in review. Silkscreen needs a
  fallback stack or the prerendered HTML shifts before the font loads.
- **Follow-up:** `P1.13` builds the chrome utilities once; components consume
  them. A future theme switcher is cut ([ADR 0008](./0008-playable-interview-build.md)).

## Alternatives considered

- **Everything pixel**, body copy included. Rejected: unreadable at density and
  every component pays a per-component art cost.
- **Raster sprite sheet or AI-generated art.** Rejected: the hero must not be an
  AI image, and the pipeline is a 3-day trap.
- **NES.css or similar.** Rejected: fights the Tailwind tokens and the local kit.
- **Mörk Borg zine austerity** (hairlines, no ornament). Rejected by direction:
  too austere, insufficient gothic weight.
