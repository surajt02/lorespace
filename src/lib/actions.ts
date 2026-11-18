/**
 * Client-side server-action caller — the app tier's only way into
 * `POST /api/actions/:name` (`P2.5`).
 *
 * Why the bearer token is fetched by hand: `src/server/action-routes.ts` refuses
 * a call that carries only the session cookie — an action needs the raw JWT
 * (integrations forward it and the platform bills its subject), and
 * `resolveAuth` exposes the claims, not the token. So the browser sends it, and
 * a missing token fails here with `not_authenticated` *before* the request
 * instead of arriving at the worker as a bare 401 "Unauthorized".
 *
 * No retries: a GM mutation is not idempotent in general, so the caller decides
 * whether trying again is safe.
 */

import { getAuthToken } from 'deepspace'

export interface ActionCallErrorDetails {
  /** Machine slug from the action's `ActionResult` (`seed_failed`, …). */
  code?: string
  /** HTTP status of the call, or 401 for a missing local token. */
  status?: number
  /** Validation issues, when the action refused its params. */
  issues?: unknown[]
}

/** One error type for every way a call can fail, so callers branch once. */
export class ActionCallError extends Error {
  readonly code?: string
  readonly status?: number
  readonly issues?: unknown[]

  constructor(message: string, details: ActionCallErrorDetails = {}) {
    super(message)
    this.name = 'ActionCallError'
    this.code = details.code
    this.status = details.status
    this.issues = details.issues
  }
}

/** The wire shape `src/server/action-routes.ts` returns — 200 with `ActionResult`,
 *  or `{ error }` for its 401/404 refusals. */
interface ActionResultBody<TData> {
  success?: boolean
  data?: TData
  error?: string
  code?: string
  issues?: unknown[]
}

/**
 * Calls an app action and returns its `data`.
 *
 * Throws `ActionCallError` for every failure — signed out, a non-200 (401/404),
 * or an `ActionResult` with `success: false` — so a caller never has to inspect
 * a body itself.
 */
export async function callAction<T>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const token = await getAuthToken()
  if (!token) {
    throw new ActionCallError('You are signed out, so this action cannot run.', {
      code: 'not_authenticated',
      status: 401,
    })
  }

  const res = await fetch(`/api/actions/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params ?? {}),
  })

  // A handled call answers HTTP 200 whatever happened and puts the outcome in
  // `success`; the 401/404 refusals answer `{ error }` with no `success` flag.
  // Read the body first so both shapes leave through the same error.
  const body = (await res.json().catch(() => ({}))) as ActionResultBody<T>

  if (!res.ok || body.success === false) {
    const message =
      body.error ?? `Action ${JSON.stringify(name)} failed (HTTP ${String(res.status)})`
    // A 401 with no slug is the cookie-only/expired-token refusal, which is the
    // same condition as the missing local token above.
    const code = body.code ?? (res.status === 401 ? 'not_authenticated' : undefined)
    throw new ActionCallError(message, { code, status: res.status, issues: body.issues })
  }

  return body.data as T
}
