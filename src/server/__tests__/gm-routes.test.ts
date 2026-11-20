import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { VerifyResult } from 'deepspace/worker'
import { registerGmRoutes } from '../gm-routes'
import type { AppContext, Env } from '../../../worker.js'

/**
 * The shared table thread's route boundary (`POST /api/gm/chat`).
 *
 * Only the bare refusals are pinned here: they are decided before any Durable
 * Object is fetched or any model is called, so they need no room stub. A turn
 * that reaches `streamDeepSpaceAgent` is verified live instead — a fake
 * `Env`'s `RECORD_ROOMS` would prove nothing about the stream.
 */

const signedIn: VerifyResult = {
  userId: 'alice',
  // The route reads only `userId`; claims are carried for shape.
  claims: { sub: 'alice' } as VerifyResult['claims'],
}

function app(resolve: () => Promise<VerifyResult | null>) {
  const instance = new Hono<AppContext>()
  registerGmRoutes(instance, resolve)
  return instance
}

function post(body: unknown, token = 'test-token') {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token === '' ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }
}

// Bindings are never read on these paths; an empty object keeps the app typed.
const env = {} as Env

describe('POST /api/gm/chat', () => {
  it('answers 401 for a request with no verified caller', async () => {
    const res = await app(async () => null).request('/api/gm/chat', post({ content: 'I look around.' }), env)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('answers 401 for a cookie session that carries no bearer token', async () => {
    const res = await app(async () => signedIn).request(
      '/api/gm/chat',
      post({ content: 'I look around.' }, ''),
      env,
    )
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it.each([
    ['empty', { content: '' }],
    ['whitespace only', { content: '   \n ' }],
    ['missing', {}],
    ['not a string', { content: 42 }],
  ])('answers 400 when content is %s', async (_label, body) => {
    const res = await app(async () => signedIn).request('/api/gm/chat', post(body), env)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'content is required' })
  })

  it('answers 400 above 2000 characters', async () => {
    const res = await app(async () => signedIn).request(
      '/api/gm/chat',
      post({ content: 'a'.repeat(2001) }),
      env,
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'content exceeds 2000 chars' })
  })

  it('answers 400 for an unknown modelId, naming the valid ones', async () => {
    const res = await app(async () => signedIn).request(
      '/api/gm/chat',
      post({ content: 'I look around.', modelId: 'not-a-model' }),
      env,
    )
    expect(res.status).toBe(400)
    const payload = (await res.json()) as { code?: string; modelIds?: string[]; error: string }
    expect(payload.code).toBe('unknown_model')
    expect(payload.error).toContain('Unknown modelId: not-a-model')
    expect(payload.modelIds?.length).toBeGreaterThan(0)
  })

  it('answers 400 for a malformed JSON body', async () => {
    const res = await app(async () => signedIn).request('/api/gm/chat', post('{not json'), env)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'content is required' })
  })
})
