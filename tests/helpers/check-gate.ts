import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { APIRequestContext, Page } from '@playwright/test'

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'

interface ActionBody {
  success?: boolean
  data?: unknown
  code?: string
  error?: string
  issues?: unknown[]
}

/** The CLI's login session mints a fresh app-scoped owner token on demand.
 *  `.dev.vars`' `APP_OWNER_JWT` cannot be used here: it is an app credential,
 *  and the action route refuses app tokens as "server credentials, not a
 *  sign-in". The session token is the developer's local login, read at runtime
 *  and never printed or written anywhere. */
const AUTH_URL = process.env.DEEPSPACE_AUTH_URL ?? 'https://auth.deep.space'

let cachedOwner: { token: string; expiresAt: number } | null = null

function jwtExpiry(token: string): number {
  try {
    const segment = token.split('.')[1]
    const payload = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as {
      exp?: number
    }
    return (payload.exp ?? 0) * 1000
  } catch {
    return 0
  }
}

async function ownerJwt(): Promise<string> {
  if (cachedOwner && cachedOwner.expiresAt > Date.now() + 30_000) return cachedOwner.token

  let session: string
  try {
    session = readFileSync(resolve(homedir(), '.deepspace/session'), 'utf8').trim()
  } catch {
    throw new Error(
      'requestCheck needs a DeepSpace CLI login. Run `npx deepspace auth login` or ' +
        '`npx deepspace test run e2e` on a machine that is already authenticated.',
    )
  }

  const res = await fetch(`${AUTH_URL}/api/auth/token`, {
    method: 'POST',
    headers: {
      Cookie: `__Secure-better-auth.session_token=${encodeURIComponent(session)}`,
      Origin: AUTH_URL,
    },
  })
  if (!res.ok) {
    throw new Error(
      `Could not mint the owner token (HTTP ${res.status}). Re-run \`npx deepspace auth login\`.`,
    )
  }
  const { token } = (await res.json()) as { token?: string }
  if (!token) throw new Error('The auth service returned no owner token.')

  cachedOwner = { token, expiresAt: jwtExpiry(token) }
  return token
}

/**
 * Ask the engine to make `characterId` owe a check on `stat` at `dc`.
 * Writes `characters.pendingStat`/`pendingDc` and no roll-log row (a request is
 * not an outcome). Safe to call when a check is already pending: it overwrites.
 */
export async function requestCheck(
  request: APIRequestContext,
  input: { characterId: string; stat: AbilityKey; dc: number },
): Promise<void> {
  const token = await ownerJwt()

  const res = await request.post('/api/actions/applyGmMutation', {
    headers: { Authorization: `Bearer ${token}` },
    data: { mutation: { kind: 'request_check', ...input } },
  })
  const body = (await res.json().catch(() => ({}))) as ActionBody
  if (!res.ok() || body.success !== true) {
    throw new Error(
      `requestCheck failed (${res.status()}): ${body.code ?? body.error ?? 'no body'}`,
    )
  }
}

/**
 * Run an app action as the player signed into `page`. The browser session
 * cookie is exchanged for the bearer that `/api/actions/:name` requires — the
 * same exchange `callAction` makes — so tests can clean up their own rows
 * without a second credential.
 */
export async function callAsPlayer<T = unknown>(
  page: Page,
  name: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return page.evaluate(
    async ({ action, input }) => {
      const tokenRes = await fetch('/api/auth/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!tokenRes.ok) throw new Error(`auth token refused (${tokenRes.status})`)
      const { token } = (await tokenRes.json()) as { token?: string }
      if (!token) throw new Error('auth token response carried no token')

      const res = await fetch(`/api/actions/${encodeURIComponent(action)}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
      })
      const body = (await res.json()) as {
        success?: boolean
        data?: unknown
        code?: string
        error?: string
      }
      if (!res.ok || body.success !== true) {
        throw new Error(
          `${action} failed (${res.status}): ${body.code ?? body.error ?? 'no body'}`,
        )
      }
      return body.data as T
    },
    { action: name, input: params },
  )
}
