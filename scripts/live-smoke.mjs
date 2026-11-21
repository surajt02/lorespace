#!/usr/bin/env node
/**
 * Live smoke + demo rehearsal for the deployed app (`P6.6`, `P6.8`).
 *
 * This is deliberately not part of `test:e2e`: it signs real users into
 * https://lorespace.app.space, spends owner-billed GM tokens, and can write to
 * the live campaign. Run it after a deploy, by hand, with the CLI logged in.
 *
 *   node scripts/live-smoke.mjs                 # one pass
 *   node scripts/live-smoke.mjs --capture       # one pass + README screenshots
 *   node scripts/live-smoke.mjs --rehearse 3    # three timed demo passes
 *
 * Passes: two signed-in windows, a roster that sees both adventurers, an
 * engine-requested check rolled in both windows, and one GM turn that writes a
 * combat/loot row. It never reports success on narration alone: the feed total
 * must grow and the new row must be `Combat` or `Game Master`.
 *
 * The owner token is minted from the local CLI session (`~/.deepspace/session`)
 * at call time. `.dev.vars`' `APP_OWNER_JWT` is an app credential and the action
 * route refuses it.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import {
  chromiumLaunchOptions,
  loadAllTestAccounts,
  newSignedInContext,
} from 'deepspace/testing'

const BASE = process.env.LORESPACE_LIVE_URL ?? 'https://lorespace.app.space'
const AUTH_URL = process.env.DEEPSPACE_AUTH_URL ?? 'https://auth.deep.space'
const ROLL_LINE = /d20\(\d+\) [+-] ?\d+ = \d+ vs DC \d+/
const REHEARSAL_BUDGET_S = 300

const argv = process.argv.slice(2)
const capture = argv.includes('--capture')
const captureOnly = argv.includes('--capture-only')
const rehearsalIndex = argv.indexOf('--rehearse')
const rehearsals = rehearsalIndex >= 0 ? Number(argv[rehearsalIndex + 1] ?? 1) : 1

function mintOwnerJwt() {
  const session = readFileSync(join(homedir(), '.deepspace', 'session'), 'utf8').trim()
  return fetch(`${AUTH_URL}/api/auth/token`, {
    method: 'POST',
    headers: {
      Cookie: `__Secure-better-auth.session_token=${encodeURIComponent(session)}`,
      Origin: AUTH_URL,
    },
  }).then(async (res) => {
    if (!res.ok) throw new Error(`owner token refused (HTTP ${res.status})`)
    const { token } = await res.json()
    if (!token) throw new Error('owner token response carried no token')
    return token
  })
}

async function ensureCharacter(page, name, preset) {
  const forge = page.getByTestId('character-forge')
  const sheet = page.getByTestId('character-sheet')
  await forge.or(sheet).waitFor({ state: 'visible', timeout: 30_000 })
  if (await forge.isVisible()) {
    await page.locator('#forge-name').fill(name)
    await page.getByTestId(`forge-preset-${preset}`).click()
  }
  await sheet.waitFor({ state: 'visible', timeout: 30_000 })
  const characterId = await sheet.getAttribute('data-character-id')
  const sheetName = (await sheet.locator('h2').innerText()).trim()
  if (!characterId) throw new Error(`${name} has no character id`)
  return { characterId, name: sheetName }
}

async function requestCheck(context, characterId, stat, dc) {
  const token = await mintOwnerJwt()
  const res = await context.request.post(`${BASE}/api/actions/applyGmMutation`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { mutation: { kind: 'request_check', characterId, stat, dc } },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok() || body.success !== true) {
    throw new Error(`requestCheck failed (${res.status()}): ${body.code ?? body.error}`)
  }
}

async function feedTotal(page) {
  const count = page.getByTestId('feed-count')
  if ((await count.count()) === 0) return 0
  const text = await count.innerText()
  return Number(text.split('/')[1] ?? 0)
}

async function gmTurnCount(page) {
  return page.locator('[data-testid="gm-turn"][data-role="gm"]').count()
}

async function busy(page) {
  const parts = await Promise.all([
    page.getByTestId('gm-stop').count(),
    page.getByTestId('gm-thinking').count(),
    page.locator('[data-streaming="true"]').count(),
  ])
  return parts.reduce((total, count) => total + count, 0) > 0
}

/** Wait for a turn already running to finish, or (with waitForStart) for one to
 *  begin and finish. Returns whether any activity was seen. */
async function waitForIdle(page, waitForStartMs = 0) {
  const started = Date.now()
  let sawBusy = await busy(page)
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    const nowBusy = await busy(page)
    if (nowBusy) sawBusy = true
    if (sawBusy && !nowBusy) return true
    if (!sawBusy && waitForStartMs > 0 && Date.now() - started > waitForStartMs) return false
    if (!sawBusy && waitForStartMs === 0 && Date.now() - started > 2_000) return false
    await page.waitForTimeout(300)
  }
  throw new Error('the GM stayed busy for 150s')
}

/** Wait for a new persisted GM row and no streaming (fast turns can start and
 *  finish between polls, so the row count is the fallback signal). */
async function waitForTurn(page, before, waitForStartMs = 15_000) {
  const started = Date.now()
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    const count = await gmTurnCount(page)
    const nowBusy = await busy(page)
    if (count > before && !nowBusy) return true
    if (!nowBusy && Date.now() - started > waitForStartMs) return false
    await page.waitForTimeout(300)
  }
  throw new Error('the GM turn did not finish within 150s')
}

async function sendGmTurn(page, message) {
  // Never click while the auto roll turn is still streaming.
  await waitForIdle(page, 15_000)
  const input = page.getByTestId('gm-input')
  await input.waitFor({ state: 'visible', timeout: 30_000 })
  const send = page.getByTestId('gm-send')
  const before = await gmTurnCount(page)
  await input.fill(message)
  await send.waitFor({ state: 'visible', timeout: 30_000 })
  if (await send.isDisabled()) await waitForIdle(page)
  await send.click()
  await waitForTurn(page, before)
}

/** Wait for a feed row written by a turn; narration alone changes nothing. */
async function waitForMutation(page, before) {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const after = await feedTotal(page)
    if (after > before) {
      const newest = page.getByTestId('feed-entry').first()
      const text = (await newest.innerText()).replace(/\s+/g, ' ').trim()
      if (/Combat|Game Master/i.test(text)) return { total: after, row: text.slice(0, 300) }
    }
    await page.waitForTimeout(500)
  }
  return null
}

async function runOnce(browser, accounts, options = {}) {
  const started = Date.now()
  const errors = []
  const contexts = []
  const watch = (page, tag) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        errors.push(`${tag}: console: ${msg.text()}`)
      }
    })
    page.on('pageerror', (error) => errors.push(`${tag}: pageerror: ${error.message}`))
    page.on('websocket', (ws) => {
      ws.on('socketerror', (error) => errors.push(`${tag}: ws: ${String(error)}`))
    })
    page.on('response', (response) => {
      if (response.url().includes('/api/gm/chat') && response.status() >= 400) {
        errors.push(`${tag}: gm-chat HTTP ${response.status()}`)
      }
    })
  }

  try {
    // Beats 1-2: the landing and the signed-out table, before any sign-in.
    const anonContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    })
    contexts.push(anonContext)
    const landing = await anonContext.newPage()
    watch(landing, 'signed out')
    await landing.goto(`${BASE}/`)
    await landing.getByTestId('static-landing').waitFor({ state: 'visible', timeout: 30_000 })
    await landing.getByRole('link', { name: 'Enter the table' }).click()
    await landing.getByTestId('signed-out-banner').waitFor({ state: 'visible', timeout: 30_000 })
    await landing.getByTestId('preview-table').waitFor({ state: 'visible', timeout: 30_000 })
    await landing.close()

    const [aContext, bContext] = await Promise.all(
      accounts.slice(0, 2).map((account) => newSignedInContext(browser, account, BASE)),
    )
    contexts.push(aContext, bContext)
    const [a, b] = [await aContext.newPage(), await bContext.newPage()]
    await Promise.all([
      a.setViewportSize({ width: 1440, height: 900 }),
      b.setViewportSize({ width: 1440, height: 900 }),
    ])
    watch(a, 'window A')
    watch(b, 'window B')

    await Promise.all([a.goto(`${BASE}/home`), b.goto(`${BASE}/home`)])
    await Promise.all([
      a.getByTestId('app-navigation').waitFor({ state: 'visible', timeout: 30_000 }),
      b.getByTestId('app-navigation').waitFor({ state: 'visible', timeout: 30_000 }),
    ])

    const sheetA = await ensureCharacter(a, 'Kaelen', 'vanguard')
    const sheetB = await ensureCharacter(b, 'Vesper', 'shadowblade')

    // Both windows see both adventurers (the party also carries offline rows).
    for (const [page, peer] of [
      [a, sheetB.name],
      [b, sheetA.name],
    ]) {
      await page
        .getByTestId('roster-member')
        .filter({ hasText: peer })
        .waitFor({ state: 'visible', timeout: 30_000 })
    }

    // The demo's order: the player acts, the engine asks for the check, the
    // player rolls, and the console's own auto turn resolves that roll (ADR 0031).
    // Racing it with a typed prompt is what makes a live pass flaky.
    await sendGmTurn(a, 'Kaelen sets his shoulder to the obsidian door and heaves.')

    await requestCheck(aContext, sheetA.characterId, 'dex', 12)
    await a
      .getByTestId('stat-card-dex')
      .waitFor({ state: 'visible', timeout: 30_000 })
    const before = await feedTotal(a)
    const gmBefore = await gmTurnCount(a)
    await a.getByTestId('stat-card-dex').click()

    const bannerA = a.getByTestId('roll-banner')
    const bannerB = b.getByTestId('roll-banner')
    await Promise.all([
      bannerA.waitFor({ state: 'visible', timeout: 30_000 }),
      bannerB.waitFor({ state: 'visible', timeout: 30_000 }),
    ])
    const lineA = (await bannerA.innerText()).replace(/\s+/g, ' ').trim()
    const lineB = (await bannerB.innerText()).replace(/\s+/g, ' ').trim()
    if (!ROLL_LINE.test(lineA)) throw new Error(`roll banner did not look like a roll: ${lineA}`)
    if (lineB !== lineA) throw new Error(`windows disagree: "${lineA}" vs "${lineB}"`)
    if (!lineA.includes(sheetA.name)) throw new Error('roll banner does not name the roller')

    // The roll turn: queued by the roller's console, not by this script.
    await waitForTurn(a, gmBefore, 20_000).catch(() => {})
    let mutation = await waitForMutation(a, before)
    if (!mutation) {
      await sendGmTurn(
        a,
        'Kaelen takes 4 damage from the Sentinel’s blade. Record the wound.',
      )
      mutation = await waitForMutation(a, before)
    }
    if (!mutation) {
      throw new Error('the GM narrated but wrote no combat/loot row after two turns')
    }

    if (options.capture) {
      await waitForIdle(a)
      await a.getByTestId('gm-stream').waitFor({ state: 'visible', timeout: 30_000 })
      await a.screenshot({ path: 'docs/assets/table-signed-in.png' })
    }

    const seconds = (Date.now() - started) / 1000
    return { seconds, errors, mutation, roll: lineA, names: [sheetA.name, sheetB.name] }
  } finally {
    for (const context of contexts) await context.close().catch(() => {})
  }
}

async function captureSignedOut(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  try {
    const page = await context.newPage()
    await page.goto(`${BASE}/`)
    await page.getByTestId('static-landing').waitFor({ state: 'visible', timeout: 30_000 })
    await page.screenshot({ path: 'docs/assets/landing.png' })

    await page.goto(`${BASE}/home`)
    await page.getByTestId('preview-table').waitFor({ state: 'visible', timeout: 30_000 })
    await page.screenshot({ path: 'docs/assets/table-signed-out.png' })
  } finally {
    await context.close()
  }
}

async function captureSignedIn(browser, account) {
  const context = await newSignedInContext(browser, account, BASE)
  try {
    const page = await context.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${BASE}/home`)
    await page.getByTestId('app-navigation').waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByTestId('gm-stream').waitFor({ state: 'visible', timeout: 30_000 })
    await page.screenshot({ path: 'docs/assets/table-signed-in.png' })
  } finally {
    await context.close()
  }
}

async function main() {
  const accounts = loadAllTestAccounts()
  if (accounts.length < 2) {
    throw new Error(`Needs 2 cached test accounts, found ${accounts.length}.`)
  }

  const browser = await chromium.launch({ ...chromiumLaunchOptions(), headless: true })
  try {
    if (captureOnly) {
      await captureSignedOut(browser)
      await captureSignedIn(browser, accounts[0])
      console.log(`[live] screenshots refreshed from ${BASE}`)
      return
    }

    const runs = []
    for (let index = 0; index < rehearsals; index += 1) {
      const result = await runOnce(browser, accounts, { capture: capture && index === 0 })
      runs.push(result)
      console.log(
        `[live] pass ${index + 1}/${rehearsals}: ${result.seconds.toFixed(1)}s, ` +
          `roll "${result.roll.split('—')[0].trim()}", mutation "${result.mutation.row.slice(0, 80)}…"`,
      )
    }
    if (capture) await captureSignedOut(browser)

    const failed = runs.filter(
      (run) => run.errors.length > 0 || !run.mutation || run.seconds > REHEARSAL_BUDGET_S,
    )
    console.log(
      JSON.stringify(
        {
          url: BASE,
          passes: runs.map((run) => ({
            seconds: Number(run.seconds.toFixed(1)),
            names: run.names,
            roll: run.roll,
            mutation: run.mutation.row,
            consoleErrors: run.errors,
          })),
          budgetSeconds: REHEARSAL_BUDGET_S,
        },
        null,
        2,
      ),
    )
    if (failed.length > 0) process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(`[live] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
