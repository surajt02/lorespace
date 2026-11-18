# 0008 — Playable interview build, 96 hours

- **Status:** Accepted
- **Date:** 2026-11-18
- **Area:** product
- **Constraints:** every phase; budget table in `../tasks.md`; cut list below is binding

## Context

LoreSpace is built in **3-4 days (96 wall-clock hours) as an interview
artifact**, delivered as a GitHub link (`git@github.com:surajt02/lorespace.git`).
The deepspace CLI reports **source unclaimed**: the first `deploy` permanently
latches GitHub as the app source, after which deploys ship the checkout —
including dirty bytes — and record no commit lineage. So the repo is the
artifact and its README is the front door.

Phase 0 and 2a are done: two test accounts, four domain collections, one lint
gate, and **nothing user-visible**. The high-level plan's six phases were
written without a deadline.

The category evidence (2026-11 research, see task board) is that AI-GM products
retain players on **engine-enforced rules, editable memory, and fast turns** —
not model quality — and that every multiplayer AI-GM in market is async because
its state is a chat log. Our state is a SQLite record room with presence, so a
**simultaneous live table** is the one wedge a chat wrapper cannot copy.

## Decision

Build the playable demo, with multiplayer treated as real (3-4 humans at one
table; solo is the degenerate case). The spec is an **eight-beat demo script**,
and everything else is judged by whether it serves a beat:

1. Landing, one screen, pixel hero, **Enter the table**.
2. `/home` signed out → populated three-column table + sign-in banner.
3. Sign in → same table, live.
4. **Forge adventurer** → character appears in the roster, second window updates
   without a reload.
5. Player types an action → GM streams, sets **DC 14** via tool, asks for DEX.
6. Click **DEX** → server resolves → both windows show the roll banner and feed row.
7. GM verifies, narrates failure, drops HP by tool; bar animates in both windows.
8. Four minutes in: live sync + deterministic math + AI narration + state mutation.

**Budget:** ~10 focused hours per day for three days (30 planned hours), with day
four held as contingency. The day-by-day allocation lives in `../tasks.md`
§ Build budget.

**Cut, bindingly:** multiple campaigns or a campaign browser · custom creation,
stat allocation, archetype editing · inventory add/edit CRUD · messaging schemas
· `assistant` page and chat-history UI · theme switcher and `data-ui-theme` ·
maps/canvas, conditions, initiative, XP, spells · SEO/sitemap depth ·
`applyGmMutation` beyond HP/loot/scene · test breadth beyond unit + smoke + one
sync spec · any pre-recorded demo video.

## Consequences

- **Positive:** one number to plan against; the demo script doubles as the
  acceptance test for every phase; the architecture (sync) is what gets shown
  first, and it is the thing competitors cannot copy.
- **Negative:** the app is a demo of a game, not a game — no progression, no
  content library, no campaign management. A reviewer who asks "what happens on
  day two of a campaign" gets an honest "not built". The margins are thin: the
  workspace shell (day 1) and the GM turn (day 3-4) are the two places an overrun
  costs a beat.
- **Follow-up:** if the window becomes 96 **working** hours, restore inventory
  CRUD and the creation modal first, then conditions/skills — nothing else on the
  cut list is load-bearing.

## Alternatives considered

- **Showcase-only** (fake depth, real sync). Rejected: the four collections and
  RBAC are already product-shaped, and a demo that cannot survive its own refresh
  reads worse than a smaller real app.
- **Full product** (campaign list, authoring, progression). Rejected: months of
  work, and the interview window is days.
- **Portfolio piece judged on code quality alone.** Rejected: an interviewer will
  click the link and use it; the product experience is the evidence.
