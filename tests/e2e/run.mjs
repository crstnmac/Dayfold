/* eslint-disable @typescript-eslint/explicit-function-return-type */
// End-to-end test: launches the built Electron app with an isolated data folder and drives the UI.
// Usage: npm run build:app && node tests/e2e/run.mjs [screenshotDir]
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const shots = process.argv[2] ?? join(tmpdir(), 'dash-shots')
mkdirSync(shots, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'dash-e2e-'))

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.'],
  env: { ...process.env, DASH_USER_DATA: dataDir, ELECTRON_RENDERER_URL: '' }
})
// The app also owns hidden overlay windows (#capture, #notify); drive the main one.
await app.firstWindow()
const isMain = (w) => !/#(capture|notify)/.test(w.url())
const page = await (async () => {
  for (let i = 0; i < 100; i++) {
    const w = app.windows().find((x) => isMain(x) && x.url().startsWith('file:'))
    if (w) return w
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('main window did not appear')
})()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))

let passed = 0
const step = async (name, fn) => {
  try {
    await fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${e.message.split('\n')[0]}`)
    await page.screenshot({ path: join(shots, `FAIL-${passed}.png`) }).catch(() => {})
    process.exitCode = 1
  }
}
const main = () => page.locator('main')
const say = async (text) => {
  const bar = page.getByLabel('Command bar')
  await bar.fill(text)
  await bar.press('Enter')
  await page.waitForTimeout(250)
}
const tab = async (re) => {
  await page.getByRole('tab', { name: re }).click()
  await page.waitForTimeout(150)
}

// The end-of-day section on Today is collapsed before 17:00; open it if needed.
const openWrapUp = async () => {
  await tab(/Today/)
  if ((await page.getByText('Done today').count()) === 0)
    await page.getByRole('button', { name: /Review the day/ }).click()
  await page.waitForTimeout(150)
}

await page.waitForSelector('[aria-label="Command bar"]')

await step('renders three tabs and the command bar', async () => {
  const names = await page.getByRole('tab').allInnerTexts()
  assert.equal(names.length, 3, names.join('|'))
  for (const n of ['Today', 'My Projects', 'Activity'])
    assert.ok(
      names.some((x) => x.includes(n)),
      `missing tab ${n}`
    )
})

await step('sandboxed renderer exposes only the narrow dash API', async () => {
  const info = await page.evaluate(() => ({
    keys: Object.keys(window.dash).sort(),
    hasRequire: typeof window.require,
    hasProcess: typeof window.process
  }))
  assert.equal(info.hasRequire, 'undefined')
  assert.equal(info.hasProcess, 'undefined')
  assert.ok(info.keys.includes('dispatch') && !info.keys.includes('endDay'))
})

await step('IPC rejects malformed commands', async () => {
  const r = await page.evaluate(() =>
    window.dash.dispatch({ type: 'task.setStatus', taskId: 1, status: 'zzz' })
  )
  assert.equal(r.ok, false)
  const r2 = await page.evaluate(() => window.dash.dispatch(null))
  assert.equal(r2.ok, false)
})

await step('creating a project with a deadline shows on My Projects', async () => {
  await say('new project Atlas, due tomorrow, goal ship the beta')
  await tab(/My Projects/)
  await main().getByText('Atlas', { exact: true }).waitFor()
  await main().getByText('ship the beta').waitFor()
  await main().getByText('1d left').waitFor()
})

await step('unparsed text lands in the Today inbox', async () => {
  await say('remember to buy milk')
  await tab(/Today/)
  await main().getByText('remember to buy milk').waitFor()
  await main().getByRole('heading', { name: /Inbox/ }).waitFor()
})

await step('triage a dump item to a to-do for today', async () => {
  await page.getByRole('button', { name: /To-do today/ }).click()
  await tab(/Today/)
  await main()
    .getByRole('checkbox', { name: /Complete remember to buy milk/ })
    .waitFor()
})

await step(
  'add a task to a project by voice phrase, plan it, see it grouped on Today',
  async () => {
    await say('add task write the PRD to Atlas')
    await tab(/Today/)
    await page.getByRole('button', { name: /^Backlog/ }).click()
    await main().getByText('write the PRD').waitFor()
    await page.getByRole('button', { name: 'Add to today' }).first().click()
    await main().getByText('write the PRD').waitFor()
    await main().getByText('Atlas', { exact: true }).first().waitFor()
  }
)

await step('completing a task moves it to the wrap-up Done list', async () => {
  await page.getByRole('checkbox', { name: /Complete write the PRD/ }).click()
  await openWrapUp()
  await main().getByText('write the PRD').waitFor()
  const done = page.locator('text=Done today').first()
  await done.waitFor()
})

await step('"undo" reverts the completion', async () => {
  await say('undo')
  await tab(/Today/)
  await main().getByText('write the PRD').first().waitFor()
  await page.getByRole('checkbox', { name: /Complete write the PRD/ }).waitFor()
})

await step(
  'Wrap-up section: carry all moves open tasks to tomorrow with a carried badge',
  async () => {
    await openWrapUp()
    await page.getByRole('button', { name: /Carry all to tomorrow/ }).click()
    await page
      .getByText(/carried 1×/)
      .first()
      .waitFor()
    await page.getByRole('button', { name: /Carry all to tomorrow/ }).waitFor({ state: 'detached' })
  }
)

await step('ambiguous input opens a chooser dialog', async () => {
  await say('add task email invoice')
  await say('add task email invoices to Sam')
  await say('done with email')
  await page.getByRole('dialog').waitFor()
  await page
    .getByRole('button', { name: /email invoice/ })
    .first()
    .click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
})

await step('project deadline can be changed by voice and by date field', async () => {
  await say('Atlas due next friday')
  await tab(/My Projects/)
  await page.getByRole('button', { name: 'Open Atlas' }).click()
  const field = page.getByLabel('Deadline for Atlas')
  const before = await field.inputValue()
  await field.fill('2031-02-03')
  await field.press('Enter')
  await page.waitForTimeout(300)
  assert.equal(await page.getByLabel('Deadline for Atlas').inputValue(), '2031-02-03')
  assert.notEqual(before, '2031-02-03')
})

await step('partial year typing does not create commands', async () => {
  const field = page.getByLabel('Deadline for Atlas')
  await field.fill('0002-01-01')
  await field.evaluate((el) => el.blur())
  await page.waitForTimeout(300)
  const v = await page.getByLabel('Deadline for Atlas').inputValue()
  assert.equal(v, '2031-02-03', `got ${JSON.stringify(v)}`)
  await page.keyboard.press('Escape')
})

await step('Activity tab: tracking is opt-in (off by default) with consent copy', async () => {
  await tab(/Activity/)
  await page.getByText('Tracking is off').waitFor()
  await page.getByText(/never field contents/).waitFor()
  assert.equal(
    await page.getByRole('switch', { name: /Tracking/ }).getAttribute('aria-checked'),
    'false'
  )
})

await step(
  'live tracking: helper runs, records rows, stores no raw titles or URL paths',
  async () => {
    await page.evaluate(() => window.dash.setActivityEnabled(true))
    await page.waitForTimeout(3500)
    const a = await page.evaluate(() => window.dash.getActivity())
    assert.equal(a.running, true)
    assert.equal(a.trusted, true, 'Accessibility permission not granted to the test process')
    assert.ok(a.recent.length >= 1, 'no activity rows recorded')
    assert.ok(
      a.recent.every((r) => r.detail === ''),
      'detail stored while detail capture is off'
    )
    await page.evaluate(() => window.dash.setActivityEnabled(false))
  }
)

await step('purge removes all rows', async () => {
  await page.evaluate(() => window.dash.purgeActivity())
  const a = await page.evaluate(() => window.dash.getActivity())
  assert.equal(a.recent.length, 0)
})

await step('no renderer errors or warnings during the run', async () => {
  assert.deepEqual(errors, [])
})

for (const scheme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme: scheme })
  for (const [name, re] of [
    ['today', /Today/],
    ['projects', /My Projects/],
    ['activity', /Activity/]
  ]) {
    await tab(re)
    await page.screenshot({ path: join(shots, `${scheme}-${name}.png`) })
  }
}

await app.close()

// Inspect the database file directly: titles must never be persisted.
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(join(dataDir, 'dash.sqlite'))
const titles = db.prepare("SELECT COUNT(*) c FROM activity WHERE title <> ''").get()
assert.equal(titles.c, 0, 'raw titles were persisted')
console.log('  ok  database holds no raw window titles')
db.close()
console.log(
  `\n${passed} steps passed${process.exitCode ? ' (with failures)' : ''}; screenshots in ${shots}`
)
