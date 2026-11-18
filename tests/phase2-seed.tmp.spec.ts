// THROWAWAY phase-2 proof. Deleted after the run; P6.2 owns committed specs.
import { test, expect } from 'deepspace/testing'

test('signed-in /home seeds the campaign exactly once', async ({ users }) => {
  const [alice] = await users(['Alice'])
  const page = alice.page

  // Capture the bearer the app itself sends, so the replay below is the same
  // caller the browser is.
  let authHeader: string | undefined
  page.on('request', (request) => {
    if (request.url().includes('/api/actions/ensureDefaultCampaign')) {
      authHeader = request.headers()['authorization']
    }
  })

  await page.goto('/home')
  await expect(page.getByTestId('workspace-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('scene-banner')).toContainText('The Ashen Threshold', {
    timeout: 20_000,
  })
  await expect(page.getByTestId('seed-failed')).toHaveCount(0)
  await expect(page.getByTestId('workspace-skeleton')).toHaveCount(0, { timeout: 20_000 })

  expect(authHeader, 'the app must call ensureDefaultCampaign with a bearer token').toMatch(
    /^Bearer /,
  )

  const replay = await page.request.post('/api/actions/ensureDefaultCampaign', {
    headers: { Authorization: authHeader!, 'Content-Type': 'application/json' },
    data: {},
  })
  expect(replay.status()).toBe(200)
  const body = (await replay.json()) as { success: boolean; data?: { created: boolean } }
  expect(body.success).toBe(true)
  expect(body.data?.created).toBe(false)

  // Row already exists: a reload renders the live banner without a skeleton.
  await page.reload()
  await expect(page.getByTestId('scene-banner')).toContainText('The Ashen Threshold', {
    timeout: 20_000,
  })
  await expect(page.getByTestId('workspace-skeleton')).toHaveCount(0)
  await expect(page.getByTestId('seed-failed')).toHaveCount(0)
})
