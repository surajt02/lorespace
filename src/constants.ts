/** App name — replaced by the CLI during scaffolding */
export const APP_NAME = 'lorespace'

/** Product name for page titles and chrome; APP_NAME stays the app slug. */
export const APP_DISPLAY_NAME = 'LoreSpace'

/** Immutable app identity — data scope keys to this, so renames never
 *  strand your records.
 *
 *  Injected by the build from `DEEPSPACE_APP_ID` in the wrangler config this
 *  build is running against — `deepspaceBuild()` in vite.config.ts supplies the
 *  define (see `deepspace/build`). wrangler.toml is the only source of truth,
 *  so `deepspace dev start`, `vite build`, and `deepspace deploy --env <name>`
 *  each get their own environment's id — not a copy frozen at scaffold time.
 *  Do not replace this with a literal: that is how a staging browser ends up
 *  reading production's rooms. */
declare const __DEEPSPACE_APP_ID__: string
export const APP_ID: string = __DEEPSPACE_APP_ID__

/** Primary scope ID for the app's RecordRoom DO */
export const SCOPE_ID = `app:${APP_ID}`

/** Roles and display config — imported from SDK (single source of truth) */
export { ROLES, ROLE_CONFIG, type Role } from 'deepspace'

/** Shared record id for the app's single seeded campaign (ADR 0007).
 *
 *  Phase 2 upserts this row (`ensureDefaultCampaign`) and every query filters
 *  on it (`where: { campaignId: DEFAULT_CAMPAIGN_ID }`). One constant, so the
 *  seed and its readers can never disagree. */
export const DEFAULT_CAMPAIGN_ID = 'default-campaign'

/** Presence scope for that campaign — Phase 4 broadcasts here.
 *
 *  Derived, never spelled out by hand: the room and the record id are the same
 *  campaign, so a changed id carries. */
export const DEFAULT_CAMPAIGN_PRESENCE_SCOPE = `campaign:${DEFAULT_CAMPAIGN_ID}`

/** Reserved scope for sample presence data — the one presence room an
 *  unauthenticated socket may join (ADR 0006).
 *
 *  Every real campaign scope is membership-gated at
 *  `src/server/realtime-routes.ts`, so the signed-out preview cannot reach the
 *  party's room. Nothing joins this scope yet: the preview renders fixture data
 *  rather than opening a socket, and this constant exists so the route's
 *  exception is a named string instead of a literal. */
export const PREVIEW_PRESENCE_SCOPE = 'campaign:preview'
