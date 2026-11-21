/**
 * Party presence — the two-window proof (`P4.7`) and the presence gate
 * (`P4.2`, ADR 0006).
 *
 * The roll is server-computed (`P4.4`, ADR 0005): clicking a stat card calls
 * `rollSkillCheck`, which draws the d20, writes the `roll-logs` row and returns
 * the authoritative numbers. Two clients then show that same result through two
 * different paths — the roller from the action's response, the peer from the
 * presence room — so equality of the two banner strings is the proof that the
 * durable and the ephemeral paths agree, not that each window rolled its own
 * die.
 *
 * `users(2)` takes any two accounts from the pool, so this spec passes on a
 * fresh app with no setup beyond two test accounts:
 *   npx deepspace test accounts list
 *
 * Presence connects asynchronously (and again on every reconnect), so the
 * assertions here wait on the UI with generous timeouts instead of sleeping.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { captureConsoleErrors } from './helpers/errors'
import { callAsPlayer, requestCheck } from './helpers/check-gate'

// Same skip as `collab.spec.ts`: a machine with no account pool is a normal
// fresh checkout, and `users()` throws there — turning "you have no pool yet"
// into a red test about the app, which it is not.
const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" ' +
    '--password-stdin`, or fetch existing pool accounts with `npx deepspace test accounts recover --all`.',
)

/** `d20(14) + 3 = 17 vs DC 12` — the roll line, as both the banner and a feed
 *  row spell it (`RollBanner`, `ActionFeed`, both via `formatModifierSpaced`). */
const ROLL_LINE = /d20\(\d+\) [+-] ?\d+ = \d+ vs DC \d+/

/** Collapse the JSX whitespace around the banner's interpolations so two
 *  windows' strings can be compared (and regexed) as one line. */
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Give this browser a character if it has none. The forge form is the only way
 * to get one (`P3.4`, ADR 0008), and a context whose account already has a
 * character skips straight to the sheet, so wait for either surface and only
 * fill the form when it is the one that rendered.
 */
async function ensureCharacter(
  page: Page,
  name: string,
  preset: 'vanguard' | 'shadowblade',
): Promise<{ characterId: string | null; created: boolean }> {
  const forge = page.getByTestId('character-forge')
  const sheet = page.getByTestId('character-sheet')
  await expect(forge.or(sheet)).toBeVisible({ timeout: 20_000 })

  const created = await forge.isVisible()
  if (created) {
    await page.locator('#forge-name').fill(name)
    // Names are unique (the action refuses duplicates, `P5.15`) and the preset
    // button submits React state, so wait for the controlled input to hold it.
    await expect(page.locator('#forge-name')).toHaveValue(name)
    await page.getByTestId(`forge-preset-${preset}`).click()
  }

  // Forged through the server action and rendered from the record it returns,
  // so this is also the wait for the row to be readable by the other window.
  await expect(sheet).toBeVisible({ timeout: 20_000 })
  return { characterId: await sheet.getAttribute('data-character-id'), created }
}

/** Delete only the sheet this run forged; roll-log evidence stays. */
async function deleteIfCreated(
  page: Page,
  sheet: { characterId: string | null; created: boolean },
): Promise<void> {
  if (!sheet.created || !sheet.characterId) return
  await callAsPlayer(page, 'deleteCharacter', { characterId: sheet.characterId })
}

/** The account this browser is signed in as: the nav chip shows `name ||
 *  email`, so the only exact identity both sides agree on is the email in the
 *  account menu (the same check `collab.spec.ts` makes). */
async function signedInEmail(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Account menu' }).click()
  const email = (await page.getByTestId('nav-user-email').innerText()).trim()
  await page.keyboard.press('Escape')
  return email
}

/** This window's own character name, read off its sheet heading — the name the
 *  same row carries in the other window's roster. */
async function sheetName(page: Page): Promise<string> {
  const heading = page.getByTestId('character-sheet').locator('h2')
  await expect(heading).toBeVisible({ timeout: 20_000 })
  return (await heading.innerText()).trim()
}

/** The roster row naming a specific peer. Offline party members also render
 *  (ADR 0029), so the proof is the name in a row, not a row count. */
function peerRow(page: Page, name: string) {
  // `.first()`: duplicate/stale rows can coexist for a frame during cleanup.
  return page.getByTestId('roster-member').filter({ hasText: name }).first()
}

/** The banner's visible text, whitespace-normalised: who rolled, the numbers,
 *  and the outcome badge. */
async function bannerText(page: Page): Promise<string> {
  const banner = page.getByTestId('roll-banner')
  await expect(banner).toBeVisible({ timeout: 15_000 })
  return normalise(await banner.innerText())
}

/** Resolve how a raw WebSocket to a `/ws/presence/:scopeId` path ends. A 401 or
 *  403 surfaces as `'error'` (Chromium reports a refused handshake that way) or
 *  as `'close'`; only a `'open'` proves the room accepted the socket. */
type SocketProbe = 'open' | 'error' | 'close' | 'timeout'

function probePresenceSocket(page: Page, path: string): Promise<SocketProbe> {
  return page.evaluate((socketPath: string) => {
    return new Promise<SocketProbe>((resolve) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${protocol}//${window.location.host}${socketPath}`)
      let timer: ReturnType<typeof setTimeout> | undefined
      const settle = (result: SocketProbe): void => {
        if (timer !== undefined) clearTimeout(timer)
        resolve(result)
      }
      timer = setTimeout(() => {
        socket.close()
        settle('timeout')
      }, 3000)
      socket.addEventListener('open', () => {
        socket.close()
        settle('open')
      })
      socket.addEventListener('error', () => {
        settle('error')
      })
      socket.addEventListener('close', () => {
        settle('close')
      })
    })
  }, path)
}

test('one roll lands in both windows without a reload', async ({ users, request }) => {
  // The waits below are generous on purpose (presence connects asynchronously).
  // Their worst case is larger than the file's default budget, and a slow
  // machine should not read as a broken table.
  test.setTimeout(60_000)

  const [a, b] = await users(2)
  const errorsA = captureConsoleErrors(a.page)
  const errorsB = captureConsoleErrors(b.page)

  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])
  await Promise.all([
    expect(a.page.getByTestId('workspace-shell')).toBeVisible({ timeout: 20_000 }),
    expect(b.page.getByTestId('workspace-shell')).toBeVisible({ timeout: 20_000 }),
  ])

  // Two different people at one table. Presence excludes self, so two windows
  // signed in as the same account can never see each other — a roster that
  // stays at one member would be this, not a presence bug.
  const [emailA, emailB] = await Promise.all([signedInEmail(a.page), signedInEmail(b.page)])
  expect(emailA).not.toBe(emailB)

  // Only used when the forge form is up: an account that already has a
  // character keeps its own name, which the sheet heading is read from below.
  // Unique names avoid `P5.15`'s duplicate-name refusal from earlier runs.
  const stamp = Date.now()
  const [sheetA, sheetB] = await Promise.all([
    ensureCharacter(a.page, `__test-${stamp}__Kaelen`, 'vanguard'),
    ensureCharacter(b.page, `__test-${stamp}__Vesper`, 'shadowblade'),
  ])

  const [nameA, nameB] = await Promise.all([sheetName(a.page), sheetName(b.page)])

  // Both rosters fill from presence with no reload: two characters at the
  // table, each window marking its own row — and, crucially, each window
  // naming the *other's* character. That last part is the precondition for the
  // banner comparison below: the peer's name comes from its `characters` read,
  // so before this holds the peer banner can only say `No adventurer`.
  for (const page of [a.page, b.page]) {
    await expect(page.getByTestId('roster-self')).toHaveCount(1, { timeout: 15_000 })
  }
  for (const [page, peerName] of [
    [a.page, nameB],
    [b.page, nameA],
  ] as const) {
    await expect(peerRow(page, peerName)).toBeVisible({ timeout: 15_000 })
    await expect(peerRow(page, peerName)).not.toContainText('No adventurer')
    // Offline party members are roster rows by design (ADR 0029).
    expect(await page.getByTestId('roster-member').count()).toBeGreaterThanOrEqual(2)
  }

  // A rolls. Nothing is drawn in the browser: the card calls the action and
  // renders the server's payload (ADR 0005). The engine first has to ask for a
  // check (ADR 0028/0030) — the owner-only writer is the only door members do
  // not have, so the test uses it instead of waiting on the live model.
  if (!sheetA.characterId) throw new Error('the forged sheet carried no character id')
  await requestCheck(request, { characterId: sheetA.characterId, stat: 'dex', dc: 12 })
  await expect(a.page.getByTestId('stat-card-dex')).toHaveAttribute('data-pending', 'true', {
    timeout: 20_000,
  })
  await a.page.getByTestId('stat-card-dex').click()
  const fromRoller = await bannerText(a.page)
  expect(fromRoller).toMatch(ROLL_LINE)
  expect(fromRoller).toContain(nameA)

  // The peer's banner arrives over the presence room, without touching B, and
  // names the roller: same character, same numbers, same outcome.
  const fromPeer = await bannerText(b.page)
  expect(fromPeer).toMatch(ROLL_LINE)
  expect(fromPeer).toContain(nameA)
  expect(fromPeer).toBe(fromRoller)

  // The same numbers landed as the newest row of the durable feed.
  const rollLine = ROLL_LINE.exec(fromRoller)?.[0] ?? ''
  expect(rollLine).not.toBe('')
  await expect(a.page.getByTestId('feed-entry').first()).toContainText(rollLine, {
    timeout: 15_000,
  })

  // The banner is ephemeral (six seconds); the feed row is not. Wait the banner
  // out, then reload B: the row is still there and no banner is replayed.
  await expect(b.page.getByTestId('roll-banner')).toBeHidden({ timeout: 15_000 })
  await b.page.reload()
  await expect(b.page.getByTestId('action-feed')).toContainText(rollLine, { timeout: 20_000 })

  expect(errorsA).toEqual([])
  expect(errorsB).toEqual([])
  await deleteIfCreated(a.page, sheetA)
  await deleteIfCreated(b.page, sheetB)
})

test('the campaign presence scope refuses an anonymous socket', async ({ page, request }) => {
  await page.goto('/home')
  await expect(page.getByTestId('app-root')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('signed-out-banner')).toBeVisible({ timeout: 15_000 })

  // The campaign room carries character names and roll activity, so an
  // anonymous upgrade is refused before it reaches the Durable Object.
  const gated = await probePresenceSocket(page, '/ws/presence/campaign%3Adefault-campaign')
  expect(['error', 'close']).toContain(gated)

  // The one anonymous scope: the signed-out table's sample room (ADR 0006,
  // ADR 0014) still accepts a socket.
  const preview = await probePresenceSocket(page, '/ws/presence/campaign%3Apreview')
  expect(preview).toBe('open')

  // The status is the contract, not only the failed handshake: the refusals
  // answer before any upgrade, so a plain GET reads them directly. A refused
  // request must also read `Unauthorized` rather than reaching the room.
  const anonymous = await request.get('/ws/presence/campaign%3Adefault-campaign')
  expect(anonymous.status()).toBe(401)

  // A token that was offered and did not verify is a failed sign-in, not an
  // anonymous visitor — and must never fall through to the preview exemption
  // (the 401 here is the whole reason the route checks `token && !auth` first).
  const forged = await request.get('/ws/presence/campaign%3Adefault-campaign?token=not-a-jwt')
  expect(forged.status()).toBe(401)
  const forgedPreview = await request.get('/ws/presence/campaign%3Apreview?token=not-a-jwt')
  expect(forgedPreview.status()).toBe(401)
})

test('the roll banner reaches a signed-out window', async ({ users, browser, request }) => {
  // The reader's complaint that made this test: a signed-out incognito window
  // saw the feed update but never the banner. Presence stays membership-gated
  // (ADR 0006) and no socket is opened here; the banner is the `roll-logs` row
  // itself, which `viewer` may read (ADR 0014, ADR 0021).
  const [a] = await users(1)
  await a.page.goto('/home')
  await expect(a.page.getByTestId('workspace-shell')).toBeVisible({ timeout: 20_000 })
  const sheetA = await ensureCharacter(a.page, `__test-${Date.now()}__Kaelen`, 'vanguard')
  if (!sheetA.characterId) throw new Error('the forged sheet carried no character id')
  await requestCheck(request, { characterId: sheetA.characterId, stat: 'dex', dc: 12 })
  await expect(a.page.getByTestId('stat-card-dex')).toHaveAttribute('data-pending', 'true', {
    timeout: 20_000,
  })

  const anonymous = await browser.newContext()
  const watcher = await anonymous.newPage()
  const errors = captureConsoleErrors(watcher)

  try {
    await watcher.goto('/home')
    await expect(watcher.getByTestId('preview-table')).toBeVisible({ timeout: 20_000 })
    // Wait for the live read to be ready *before* rolling: the first ready
    // snapshot is the baseline, and a row that arrives in it is history.
    await expect(watcher.getByTestId('signed-out-banner')).toBeVisible({ timeout: 20_000 })
    await expect(
      watcher.getByTestId('feed-list').or(watcher.getByTestId('feed-empty')),
    ).toBeVisible({ timeout: 20_000 })

    await a.page.getByTestId('stat-card-dex').click()

    const forRoller = await bannerText(a.page)
    expect(forRoller).toMatch(ROLL_LINE)
    const forWatcher = await bannerText(watcher)
    expect(forWatcher).toBe(forRoller)

    // The same row is in the signed-out feed, and no presence socket was opened
    // on this branch: the banner came from the record room alone.
    await expect(watcher.getByTestId('feed-entry').first()).toContainText(
      ROLL_LINE.exec(forWatcher)?.[0] ?? '',
      { timeout: 15_000 },
    )
    expect(errors).toEqual([])
  } finally {
    await deleteIfCreated(a.page, sheetA).catch(() => {})
    await anonymous.close()
  }
})
