/**
 * Multi-user collaboration spec — the app contract, not the auth template.
 *
 * `presence.spec.ts` proves the presence gate and the banner path. This file
 * proves the *table*: two distinct accounts, two forged adventurers, the roster
 * showing the other player without a reload, one engine-requested check rolled
 * in both windows, and the shared feed carrying the result.
 *
 * The check is requested through the owner-only `applyGmMutation` action (the
 * same writer the GM tool uses) because stat cards are inert until the engine
 * records a check (ADR 0028/0030) and no member can write that column. That is
 * test control, not a second product path; see `tests/helpers/check-gate.ts`.
 *
 * `users(2)` takes any two accounts from the pool, so the spec passes on a
 * fresh app with two test accounts. Characters are created through the real
 * Forge form and deleted through the real `deleteCharacter` action; roll-log
 * rows are append-only evidence and remain after the run.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { captureConsoleErrors } from './helpers/errors'
import { callAsPlayer, requestCheck } from './helpers/check-gate'

const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" ' +
    '--password-stdin`, or fetch existing pool accounts with `npx deepspace test accounts recover --all`.',
)

/** `d20(14) + 3 = 17 vs DC 12` — banner and feed both spell it this way. */
const ROLL_LINE = /d20\(\d+\) [+-] ?\d+ = \d+ vs DC \d+/

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

interface ForgedSheet {
  created: boolean
  characterId: string | null
  name: string
}

/**
 * Ensure this browser has a sheet and report whether this run made it, so the
 * `finally` block deletes only test-created characters. Old accounts keep
 * whichever adventurer they already have.
 */
async function ensureCharacter(
  page: Page,
  name: string,
  preset: 'vanguard' | 'shadowblade',
): Promise<ForgedSheet> {
  const forge = page.getByTestId('character-forge')
  const sheet = page.getByTestId('character-sheet')
  await expect(forge.or(sheet)).toBeVisible({ timeout: 20_000 })

  const created = await forge.isVisible()
  if (created) {
    await page.locator('#forge-name').fill(name)
    await page.getByTestId(`forge-preset-${preset}`).click()
  }
  await expect(sheet).toBeVisible({ timeout: 20_000 })
  await expect(sheet.locator('h2')).toHaveText(/\S/, { timeout: 20_000 })

  return {
    created,
    characterId: await sheet.getAttribute('data-character-id'),
    name: normalise(await sheet.locator('h2').innerText()),
  }
}

async function deleteIfCreated(page: Page, sheet: ForgedSheet): Promise<void> {
  if (!sheet.created || !sheet.characterId) return
  await callAsPlayer(page, 'deleteCharacter', { characterId: sheet.characterId })
}

test('two players have separate adventurers and see each other in the roster', async ({
  users,
}) => {
  const [a, b] = await users(2)
  const errorsA = captureConsoleErrors(a.page)
  const errorsB = captureConsoleErrors(b.page)
  const stamp = Date.now()
  let sheetA: ForgedSheet | null = null
  let sheetB: ForgedSheet | null = null

  try {
    await Promise.all([a.page.goto('/home'), b.page.goto('/home')])
    await Promise.all([
      expect(a.page.getByTestId('app-navigation')).toBeVisible({ timeout: 20_000 }),
      expect(b.page.getByTestId('app-navigation')).toBeVisible({ timeout: 20_000 }),
    ])

    sheetA = await ensureCharacter(a.page, `__test-${stamp}__Kaelen`, 'vanguard')
    sheetB = await ensureCharacter(b.page, `__test-${stamp}__Vesper`, 'shadowblade')

    // One character per account (ADR 0019); the party also carries offline
    // members from earlier sessions (ADR 0029), so the proof is both names, not
    // an exact roster size.
    for (const [self, peer] of [
      [a.page, sheetB.name],
      [b.page, sheetA.name],
    ] as const) {
      await expect(self.getByTestId('roster-self')).toHaveCount(1)
      await expect(self.getByTestId('roster-member').filter({ hasText: peer })).toBeVisible({
        timeout: 20_000,
      })
      expect(await self.getByTestId('roster-member').count()).toBeGreaterThanOrEqual(2)
    }

    expect(errorsA, 'window A console').toEqual([])
    expect(errorsB, 'window B console').toEqual([])
  } finally {
    if (sheetA) await deleteIfCreated(a.page, sheetA).catch(() => {})
    if (sheetB) await deleteIfCreated(b.page, sheetB).catch(() => {})
  }
})

test('a requested check rolls in both windows and lands in the shared feed', async ({
  users,
  request,
}) => {
  const [a, b] = await users(2)
  const errorsA = captureConsoleErrors(a.page)
  const errorsB = captureConsoleErrors(b.page)
  const stamp = Date.now()
  let sheetA: ForgedSheet | null = null
  let sheetB: ForgedSheet | null = null

  try {
    await Promise.all([a.page.goto('/home'), b.page.goto('/home')])
    await Promise.all([
      expect(a.page.getByTestId('app-navigation')).toBeVisible({ timeout: 20_000 }),
      expect(b.page.getByTestId('app-navigation')).toBeVisible({ timeout: 20_000 }),
    ])

    sheetA = await ensureCharacter(a.page, `__test-${stamp}__Kaelen`, 'vanguard')
    sheetB = await ensureCharacter(b.page, `__test-${stamp}__Vesper`, 'shadowblade')
    if (!sheetA.characterId) throw new Error('the forged sheet carried no character id')

    // The engine asks for DEX; only that card is live (ADR 0030).
    await requestCheck(request, { characterId: sheetA.characterId, stat: 'dex', dc: 12 })
    await expect(a.page.getByTestId('stat-card-dex')).toHaveAttribute('data-pending', 'true', {
      timeout: 20_000,
    })
    await expect(a.page.getByTestId('stat-card-dex')).toBeEnabled()
    await expect(a.page.getByTestId('stat-card-str')).toBeDisabled()

    await a.page.getByTestId('stat-card-dex').click()

    const bannerA = a.page.getByTestId('roll-banner')
    const bannerB = b.page.getByTestId('roll-banner')
    await Promise.all([
      expect(bannerA).toBeVisible({ timeout: 20_000 }),
      expect(bannerB).toBeVisible({ timeout: 20_000 }),
    ])
    const lineA = normalise(await bannerA.innerText())
    const lineB = normalise(await bannerB.innerText())
    expect(lineA).toMatch(ROLL_LINE)
    expect(lineA).toContain(sheetA.name)
    expect(lineB).toBe(lineA)

    // Bob's feed is the durable path (ADR 0021): the newest row names the
    // roller and carries the same engine-computed line.
    const firstEntry = b.page.getByTestId('feed-entry').first()
    await expect(firstEntry).toBeVisible({ timeout: 20_000 })
    await expect(firstEntry).toContainText(sheetA.name, { timeout: 20_000 })
    await expect(firstEntry).toContainText(ROLL_LINE, { timeout: 20_000 })

    expect(errorsA, 'window A console').toEqual([])
    expect(errorsB, 'window B console').toEqual([])
  } finally {
    if (sheetA) await deleteIfCreated(a.page, sheetA).catch(() => {})
    if (sheetB) await deleteIfCreated(b.page, sheetB).catch(() => {})
  }
})
