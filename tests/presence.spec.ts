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

/** `d20(14) +2 = 16 vs DC 13` — the roll line, as both the banner and a feed
 *  row spell it (`RollBanner`, `ActionFeed`). */
const ROLL_LINE = /d20\(\d+\) [+-]?\d+ = \d+ vs DC \d+/

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
async function ensureCharacter(page: Page, name: string, preset: 'vanguard' | 'shadowblade') {
  const forge = page.getByTestId('character-forge')
  const sheet = page.getByTestId('character-sheet')
  await expect(forge.or(sheet)).toBeVisible({ timeout: 20_000 })

  if (await forge.isVisible()) {
    await page.locator('#forge-name').fill(name)
    await page.getByTestId(`forge-preset-${preset}`).click()
  }

  // Forged through the server action and rendered from the record it returns,
  // so this is also the wait for the row to be readable by the other window.
  await expect(sheet).toBeVisible({ timeout: 20_000 })
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

/** The roster row that is not this window's own (`roster-self` marks self).
 *  Split out because the count alone proves nothing: a peer with no readable
 *  character row still renders, as `No adventurer`, and would satisfy a count
 *  of two. */
function peerRow(page: Page) {
  return page.getByTestId('roster-member').filter({ hasNot: page.getByTestId('roster-self') })
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

test('one roll lands in both windows without a reload', async ({ users }) => {
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
  await Promise.all([
    ensureCharacter(a.page, 'Kaelen', 'vanguard'),
    ensureCharacter(b.page, 'Vesper', 'shadowblade'),
  ])

  const [nameA, nameB] = await Promise.all([sheetName(a.page), sheetName(b.page)])

  // Both rosters fill from presence with no reload: two characters at the
  // table, each window marking its own row — and, crucially, each window
  // naming the *other's* character. That last part is the precondition for the
  // banner comparison below: the peer's name comes from its `characters` read,
  // so before this holds the peer banner can only say `No adventurer`.
  await expect(a.page.getByTestId('roster-member')).toHaveCount(2, { timeout: 15_000 })
  await expect(b.page.getByTestId('roster-member')).toHaveCount(2, { timeout: 15_000 })
  for (const page of [a.page, b.page]) {
    await expect(page.getByTestId('roster-self')).toHaveCount(1, { timeout: 15_000 })
  }
  for (const [page, peerName] of [
    [a.page, nameB],
    [b.page, nameA],
  ] as const) {
    await expect(peerRow(page)).toHaveCount(1, { timeout: 15_000 })
    await expect(peerRow(page)).toContainText(peerName, { timeout: 15_000 })
    await expect(peerRow(page)).not.toContainText('No adventurer')
  }

  // A rolls. Nothing is drawn in the browser: the card calls the action and
  // renders the server's payload (ADR 0005).
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
