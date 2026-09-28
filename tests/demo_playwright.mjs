import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadEnv } from './env.mjs'
// .env (machine-local, gitignored — see .env.example) before any env use.
await loadEnv()

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..', 'desktop')
const DASHBOARD = join(HERE, '..', 'dashboard')
const PY = process.env.KG_PYTHON || '/opt/hermes/.venv/bin/python'

const args = process.argv.slice(2)
const show = args.includes('--show')
const outIdx = args.indexOf('--out')
const OUT = outIdx >= 0 ? args[outIdx + 1] : join(HERE, 'demo-shots')

// playwright resolution is machine-dependent — see .env.example:
// KG_PLAYWRIGHT_MODULE wins, then the container global path, then bare import.
const { chromium } = await import(process.env.KG_PLAYWRIGHT_MODULE || '/usr/local/lib/node_modules/playwright/index.mjs')
    .catch(() => import(process.env.KG_PLAYWRIGHT_MODULE || '/usr/local/lib/node_modules/playwright/index.js'))
    .catch(() => import('playwright'))

function freePort() {
  return new Promise(resolve => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

// ── temp board with realistic data (via the hermes domain layer) ────────────
const tmp = await mkdtemp(join(tmpdir(), 'kg-demo-'))
process.env.KANBAN_GANTT_BOARDS = join(tmp, 'kanban', 'boards')
process.env.HERMES_KANBAN_HOME = tmp
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(process.env.HOME || '~', '.cache', 'ms-playwright')
}

const env = { ...process.env }
// Optional checkout containing hermes_cli/ (see .env.example KG_AGENT_HOME) —
// prepended to PYTHONPATH for the seed script and the standalone backend.
if (process.env.KG_AGENT_HOME) {
  env.PYTHONPATH = process.env.KG_AGENT_HOME + (env.PYTHONPATH ? ':' + env.PYTHONPATH : '')
}
delete env.HERMES_DELEGATED_CHILD_CONTEXT
delete env.HERMES_KANBAN_TASK
delete env.HERMES_KANBAN_DB
delete env.HERMES_KANBAN_BOARD

const setupPy = `
import sys, time
sys.path.insert(0, '/opt/data/git/hermes-agent')
from hermes_cli import kanban_db
now = int(time.time())
day = 86400
hour = 3600
conn = kanban_db.connect(board='demo')

def mk(title, **kw):
    return kanban_db.create_task(conn, title=title, created_by='demo-seed', **kw)

t_epic = mk('[DEMO] Epic — implémentation X', priority=3)
# children WITHOUT parent gating for the done demos (parent stays todo)
t_done_run = mk('[DEMO] Sous-tâche A (done, durée réelle 3h)', priority=2)
t_done_run2 = mk('[DEMO] Sous-tâche A2 (done, durée réelle 8h)', priority=2)
t_done_inst = mk('[DEMO] Sous-tâche B (done instantané)', priority=2)
t_running = mk('[DEMO] Sous-tâche C (running, jauge animée)', priority=2)
t_review = mk('[DEMO] Sous-tâche D (review)', priority=2)
t_blocked = mk('[DEMO] Sous-tâche E (blocked)', priority=1)
t_ready_child = mk('[DEMO] Tâche ready (gated par Epic)', parents=[t_epic], priority=1)
t_ready = mk('[DEMO] Tâche ready isolée')
t_todo = mk('[DEMO] Tâche todo isolée')
t_scheduled = mk('[DEMO] Tâche scheduled')
t_triage = mk('Tâche en triage (sans label)')
t_archived = mk('[DEMO] Vieille tâche archivée')
conn.execute("UPDATE tasks SET status = 'review' WHERE id = ?", (t_review,))
kanban_db.block_task(conn, t_blocked, reason='attente données')
kanban_db.add_comment(conn, t_running, author='manager', body='penser au cas limite')
kanban_db.add_comment(conn, t_epic, author='demo', body='Tâche de démonstration - tous les états.')
# done tasks: promote to ready then complete through the domain (invariants)
for tid in (t_done_run, t_done_run2, t_done_inst):
    conn.execute("UPDATE tasks SET status = 'ready' WHERE id = ?", (tid,))
kanban_db.complete_task(conn, t_done_run, result='run réel 3h')
kanban_db.complete_task(conn, t_done_run2, result='run réel 8h')
kanban_db.complete_task(conn, t_done_inst, result='durée inconnue')
# real execution windows (task_runs) — the truth for done durations
conn.execute("INSERT INTO task_runs (task_id, profile, step_key, status, outcome, started_at, ended_at) VALUES (?, 'senior-coder', NULL, 'completed', 'completed', ?, ?)",
             (t_done_run, now - 3*day, now - 3*day + 3*hour))
conn.execute("UPDATE tasks SET started_at = ? WHERE id = ?", (now - 3*day, t_done_run))
conn.execute("INSERT INTO task_runs (task_id, profile, step_key, status, outcome, started_at, ended_at) VALUES (?, 'senior-coder', NULL, 'completed', 'completed', ?, ?)",
             (t_done_run2, now - 2*day, now - 2*day + 8*hour))
conn.execute("UPDATE tasks SET started_at = ? WHERE id = ?", (now - 2*day, t_done_run2))
# running: claimed 2h ago, run still open
conn.execute("INSERT INTO task_runs (task_id, profile, step_key, status, outcome, started_at, ended_at, summary) VALUES (?, 'senior-coder', NULL, 'running', 'running', ?, NULL, 'en cours')",
             (t_running, now - 2*hour))
conn.execute("UPDATE tasks SET started_at = ?, assignee = 'senior-coder', status = 'running' WHERE id = ?", (now - 2*hour, t_running))
kanban_db.archive_task(conn, t_archived)
conn.close()
print('board demo seeded')
`
const { execFileSync } = await import('node:child_process')
const seedFile = join(tmp, 'seed.py')
await writeFile(seedFile, setupPy)
execFileSync(PY, [seedFile], { env: { ...env, HERMES_KANBAN_HOME: tmp, KANBAN_GANTT_BOARDS: join(tmp, 'kanban', 'boards') }, stdio: 'inherit' })

// ── standalone backend ───────────────────────────────────────────────────────
const apiPort = await freePort()
const backend = spawn(PY, [
  DASHBOARD + '/plugin_api.py',
  '--host', '127.0.0.1', '--port', String(apiPort)
], { env: { ...env, HERMES_KANBAN_HOME: tmp, KANBAN_GANTT_BOARDS: join(tmp, 'kanban', 'boards') }, stdio: 'ignore' })

// wait for the backend to answer
const deadline = Date.now() + 15_000
while (Date.now() < deadline) {
  try {
    const r = await fetch(`http://127.0.0.1:${apiPort}/meta`)
    if (r.ok) break
  } catch { /* not up yet */ }
  await new Promise(r => setTimeout(r, 300))
}

// ── static server for demo.html + plugin.js ─────────────────────────────────
const webPort = await freePort()
const httpd = createServer(async (req, res) => {
  const raw = new URL(req.url, 'http://x').pathname.slice(1) || 'demo.html'
  const name = raw === 'plugin.js' ? join(PLUGIN, 'plugin.js') : raw === 'gantt-core.js' ? join(PLUGIN, 'gantt-core.js') : join(HERE, raw)
  try {
    const body = await readFile(name)
    res.writeHead(200, {
      'Content-Type': name.endsWith('.html') ? 'text/html' : 'text/javascript',
      'Access-Control-Allow-Origin': '*'
    })
    res.end(body)
  } catch {
    res.writeHead(404); res.end()
  }
})
await new Promise(resolve => httpd.listen(webPort, '127.0.0.1', resolve))

const url = `http://127.0.0.1:${webPort}/demo.html?api=http://127.0.0.1:${apiPort}`
console.log('backend :', `http://127.0.0.1:${apiPort}`)
console.log('demo    :', url)

await mkdir(OUT, { recursive: true })
const errors = []
try {
  const browser = await chromium.launch({
    headless: !show,
    executablePath: process.env.KG_CHROMIUM_PATH || undefined
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  try {
    await page.waitForFunction('window.__KG_READY === true', null, { timeout: 20_000 })
  } catch (e) {
    const status = await page.locator('#status').textContent().catch(() => '?')
    console.error('READY timeout — #status:', status)
    console.error('script errors collected:', errors)
    throw e
  }
  await page.screenshot({ path: join(OUT, 'demo-overview.png'), fullPage: true })

  // open the drawer on the running task
  await page.click('text=Sous-tâche B')
  await page.waitForSelector('#drawer:not([style*="display: none"])', { timeout: 10_000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, 'demo-drawer.png') })
  await page.click('#close')

  // zoom — real interaction (keyboard), not a synthetic event
  await page.locator('#zoom2').focus()
  for (let i = 0; i < 2; i++) { await page.keyboard.press('ArrowRight') }
  await page.waitForTimeout(200)
  const zoomVal = await page.locator('#zoomval2').textContent()
  console.log('zoom after keys:', zoomVal)
  await page.screenshot({ path: join(OUT, 'demo-zoom4.png') })

  // search filter
  await page.fill('#search', 'DEMO')
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, 'demo-search.png') })

  // WRITE path: archive the "Sous-tâche B (done instantané)" row through the
  // drawer (legal transition done -> archive; proves writes end-to-end)
  await page.fill('#search', '')
  await page.waitForTimeout(300)
  await page.click('text=Sous-tâche B')
  await page.waitForSelector('#drawer:not([style*="display: none"])')
  // done tasks expose 'Archiver' as a PRIMARY action (action matrix)
  await page.click('#d-primary-actions button:has-text("Archiver")')
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(OUT, 'demo-write.png') })
  const badge1 = await page.locator('#d-badges').textContent()
  console.log('badge after Archiver:', badge1.trim().replace(/\s+/g, ' '))
  if (!badge1.toLowerCase().includes('archived')) {
    console.error('WRITE PATH FAILED — badge did not become archived')
    errors.push('write path failed')
  }

  // 4. Test multi-selection and bulk actions
  console.log('Testing bulk selection & actions...')
  await page.click('#close')
  // select first task checkbox
  const checkboxes = page.locator('.row-chk')
  await checkboxes.nth(0).click()
  // Shift+click on 3rd task checkbox to select range
  await checkboxes.nth(2).click({ modifiers: ['Shift'] })
  await page.waitForTimeout(200)
  const checkedCount = await page.locator('.row-chk:checked').count()
  console.log('Checked rows count after Shift+Click:', checkedCount)
  if (checkedCount < 3) {
    console.error('Shift+Click range selection failed, expected >= 3, got', checkedCount)
    errors.push('range selection failed')
  }

  // Test Ctrl+A when at least one is selected
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(200)
  const allChecked = await page.locator('.row-chk:checked').count()
  const totalRows = await checkboxes.count()
  console.log(`Checked all via Ctrl+A: ${allChecked}/${totalRows}`)
  if (allChecked !== totalRows) {
    console.error('Ctrl+A selection failed')
    errors.push('ctrl+a selection failed')
  }

  // Test toggle all checkbox
  const toggleAll = page.locator('#select-all-chk')
  await toggleAll.click() // uncheck all
  await page.waitForTimeout(100)
  const afterUncheck = await page.locator('.row-chk:checked').count()
  console.log('Checked after uncheck all:', afterUncheck)
  if (afterUncheck !== 0) {
    console.error('Uncheck all failed')
    errors.push('uncheck all failed')
  }

  // Test Contextual Filter (Assignees)
  console.log('Testing filter dropdown...')
  await page.click('#filter-btn')
  await page.waitForSelector('#filter-dropdown.open')
  await page.click('#filter-all-profiles')
  await page.click('#filter-btn') // close
  await page.waitForTimeout(200)

  // 5. Test collapsible Comments section & show previous comments
  console.log('Testing comments collapsible section...')
  await page.click('text=Epic — implémentation X')
  await page.waitForSelector('#drawer:not([style*="display: none"])')
  await page.waitForTimeout(300)
  const commentsContent = page.locator('#d-comments-content')
  if (!(await commentsContent.isVisible())) {
    console.error('Comments content should be visible by default')
    errors.push('comments open by default failed')
  }
  await page.click('#d-comments-toggle')
  await page.waitForTimeout(200)
  if (await commentsContent.isVisible()) {
    console.error('Comments content should be hidden after toggle click')
    errors.push('comments collapse failed')
  }
  await page.click('#d-comments-toggle')
  await page.waitForTimeout(200)
  await page.click('#close')

  await browser.close()
} finally {
  backend.kill()
  httpd.close()
}

if (errors.length) {
  console.error('CONSOLE/PAGE ERRORS:')
  for (const e of errors) console.error('  -', e)
  process.exit(1)
}
console.log(`OK — screenshots in ${OUT}/`)
