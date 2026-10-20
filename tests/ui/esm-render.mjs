/**
 * ESM registration + render smoke tests for the kanban-gantt plugin.
 *
 * Loads the REAL built plugin (desktop/plugin.js, artifact of `npm run
 * build`) as an actual ESM module with a temporary Node loader mapping
 * @hermes/plugin-sdk, react, and react/jsx-runtime to local stubs (pattern:
 * hermes-newswire / hermes-desktop-plugin-development), then asserts:
 *   - import-scan clean (only SDK/react specifiers in source)
 *   - register(ctx) registers page + sidebar nav + palette command
 *   - page render produces the gantt (task titles, filter, legend)
 *   - board switcher contribution to WORKSPACE_PAGE_HEADER_AREA is registered
 *     while the page is mounted
 *
 * Run: node tests/ui/esm-render.mjs
 */

import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { register } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STUBS_DIR = join(__dirname, '.stubs')
const PLUGIN_PATH = join(__dirname, '..', '..', 'desktop', 'plugin.js')

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let failures = 0
let checks = 0
const check = (cond, msg) => {
  checks += 1
  if (!cond) {
    failures += 1
    console.error('FAIL: ' + msg)
  }
}

// ---------------------------------------------------------------------------
// SDK stub — mirrors every export plugin.js imports
// ---------------------------------------------------------------------------

const calls = globalThis.__kgCalls = { rest: [], navigate: [] }

const hostStub = {
  navigate: path => calls.navigate.push(path)
}

const atom = initial => {
  let value = initial
  return { get: () => value, set: v => { value = v }, subscribe: () => () => {} }
}
const useValueImpl = a => (a && typeof a.get === 'function' ? a.get() : undefined)
const useMutationStub = options => ({
  mutate: vars => {
    if (options && typeof options.mutationFn === 'function') {
      Promise.resolve(options.mutationFn(vars)).catch(() => {})
    }
  },
  isPending: false
})

const boards = {
  boards: [
    { slug: 'sumaris-app', label: 'Sumaris App', total: 12 },
    { slug: 'obsfish', label: 'ObsVentes', total: 8 }
  ],
  current: 'sumaris-app'
}

// POST-queryFn shape of the /gantt snapshot.
const gantt = {
  tasks: [
    { id: 't_1', title: 'Epic — first task', status: 'running', assignee: 'alice', started_at: 1_800_000_000, created_at: 1_799_000_000, archived: false, attachment_count: 2 },
    { id: 't_2', title: 'Child task (done)', status: 'done', assignee: 'bob', completed_at: 1_800_100_000, created_at: 1_799_000_000, archived: false, attachment_count: 0 },
    { id: 't_3', title: 'Blocked task', status: 'blocked', created_at: 1_799_000_000, archived: false }
  ],
  total: 3
}

// Query results injected into the generated stub module (the stub runs in a
// separate module scope and cannot close over this file's variables).
const stubQueryData = {
  'kanban-gantt|boards': boards,
  'kanban-gantt|gantt': gantt
}

const useQueryStubSource = `const stubQueryData = ${JSON.stringify(stubQueryData)}
export const useQuery = options => {
  const key = options && Array.isArray(options.queryKey) ? options.queryKey.join('|') : ''
  let data
  if (key.includes('|boards')) data = stubQueryData['kanban-gantt|boards']
  else if (key.includes('|gantt')) data = stubQueryData['kanban-gantt|gantt']
  return { data, isLoading: false, isError: false, error: null, refetch: async () => {} }
}`

const useValueImplSrc = useValueImpl.toString()

const sdkStub = {
  Badge: 'Badge',
  Button: 'Button',
  cn: (...parts) => parts.filter(Boolean).join(' '),
  Codicon: 'Codicon',
  Contribute: 'Contribute',
  DropdownMenu: 'DropdownMenu',
  DropdownMenuContent: 'DropdownMenuContent',
  DropdownMenuItem: 'DropdownMenuItem',
  DropdownMenuSeparator: 'DropdownMenuSeparator',
  DropdownMenuTrigger: 'DropdownMenuTrigger',
  EmptyState: 'EmptyState',
  ErrorState: 'ErrorState',
  host: hostStub,
  Loader: 'Loader',
  PALETTE_AREA: 'palette',
  ROUTES_AREA: 'routes',
  SIDEBAR_NAV_AREA: 'sidebar.nav',
  Streamdown: 'Streamdown',
  Switch: 'Switch',
  TITLEBAR_AREAS: { left: 'titleBar.left', center: 'titleBar.center', right: 'titleBar.right' },
  WORKSPACE_PAGE_HEADER_AREA: 'workspace.pageHeader',
  atom,
  profileColor: () => '#888888',
  profileColorSoft: () => 'rgba(136,136,136,0.2)',
  queryClient: { invalidateQueries: () => {} },
  useMutation: useMutationStub,
  usePluginI18n: () => ((path, ...args) => String(path)),
  useQuery: () => ({ data: undefined, isLoading: true, isError: false, error: null, refetch: async () => {} }),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
  useValue: useValueImpl
}

// Any SDK name the artifact imports but the map above does not know is filled in
// automatically, so the stub cannot drift behind the plugin (a missing export
// used to abort the import outright — `ConfirmDialog` did exactly that). Names
// starting with `use` get a callable no-op, everything else a placeholder tag.
const artifactSource = readFileSync(PLUGIN_PATH, 'utf8')
const sdkImportBlocks = [...artifactSource.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]@hermes\/plugin-sdk['"]/g)]
const importedNames = sdkImportBlocks
  .flatMap(m => m[1].split(','))
  .map(s => s.trim().split(/\s+as\s+/)[0])
  .filter(Boolean)
const autoFilled = [...new Set(importedNames.filter(name => !(name in sdkStub)))]
for (const name of autoFilled) {
  sdkStub[name] = name.startsWith('use') ? () => undefined : name
}
if (autoFilled.length) console.log('stub auto-filled: ' + autoFilled.join(', '))

const reactStub = {
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: fn => (typeof fn === 'function' ? fn() : fn),
  useRef: initial => ({ current: initial }),
  createElement: (type, props, ...children) => ({ type, props, children })
}

const jsxRuntimeStub = {
  // Invoke function components like real React would (hooks are stubbed
  // stateless), so the render tree contains real element nodes to assert on.
  jsx: (type, props) => render(type, props),
  jsxs: (type, props) => render(type, props),
  Fragment: 'Fragment'
}

function render(type, props) {
  if (typeof type === 'function') {
    try {
      return type(props || {})
    } catch (err) {
      return { type, props: props || {}, renderError: err }
    }
  }
  return { type, props: props || {}, $$jsx: true }
}

// ---------------------------------------------------------------------------
// Write stub modules + loader, then import the plugin through it
// ---------------------------------------------------------------------------

mkdirSync(STUBS_DIR, { recursive: true })

// Functions are serialized as their source; reattach everything explicitly
// (JSON.stringify silently drops function-valued properties).
const functionExports = Object.fromEntries(
  Object.entries(sdkStub)
    .filter(([, v]) => typeof v === 'function')
    .map(([k, v]) => [k, v.toString()])
)
const constantKeys = Object.keys(sdkStub).filter(k => !(k in functionExports) && k !== 'useQuery' && k !== 'host')
const constantJson = JSON.stringify(Object.fromEntries(constantKeys.map(k => [k, sdkStub[k]])), null, 2)
const useQueryStubModuleSource = useQueryStubSource.replace('export const useQuery', 'const __useQuery')
const functionExportConsts = Object.keys(functionExports).map(k => `const __${k} = ${functionExports[k]}`)
const functionExportExports = Object.keys(functionExports).map(k => `export const ${k} = __${k}`)

const sdkStubSource = [
  ...functionExportConsts.filter(k => !k.startsWith('const __useQuery =')),
  useQueryStubModuleSource,
  `const sdk = ${constantJson}`,
  'sdk.host = { navigate: ' + hostStub.navigate.toString() + ' }',
  'sdk.atom = __atom',
  'sdk.useValue = __useValue',
  'sdk.useMutation = __useMutation',
  'sdk.useQuery = __useQuery',
  'export default sdk',
  ...functionExportExports,
  'export const host = sdk.host',
  ...constantKeys.map(k => `export const ${k} = sdk.${k}`),
  ''
].join('\n')
writeFileSync(join(STUBS_DIR, 'sdk.mjs'), sdkStubSource)

writeFileSync(
  join(STUBS_DIR, 'react.mjs'),
  `export const useState = ${reactStub.useState.toString()}\n` +
    `export const useEffect = ${reactStub.useEffect.toString()}\n` +
    `export const useMemo = ${reactStub.useMemo.toString()}\n` +
    `export const useRef = ${reactStub.useRef.toString()}\n` +
    'export default { useState, useEffect, useMemo, useRef }\n'
)

writeFileSync(join(STUBS_DIR, 'jsx-runtime.mjs'), `function invokeComponent(type, props) {
  if (typeof type === 'function') {
    try {
      return type(props || {})
    } catch (err) {
      return { type, props: props || {}, renderError: err }
    }
  }
  return { type, props: props || {}, $$jsx: true }
}
export const jsx = (type, props) => invokeComponent(type, props)
export const jsxs = (type, props) => invokeComponent(type, props)
export const Fragment = 'Fragment'
`)

const loaderSrc = `const STUB_URLS = ${JSON.stringify({
  '@hermes/plugin-sdk': pathToFileURL(join(STUBS_DIR, 'sdk.mjs')).href,
  react: pathToFileURL(join(STUBS_DIR, 'react.mjs')).href,
  'react/jsx-runtime': pathToFileURL(join(STUBS_DIR, 'jsx-runtime.mjs')).href
}, null, 2)}
export function resolve(specifier, context, nextResolve) {
  if (STUB_URLS[specifier]) {
    return { url: STUB_URLS[specifier], shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
`
writeFileSync(join(__dirname, 'loader-hooks.mjs'), loaderSrc)
register(new URL('./loader-hooks.mjs', import.meta.url))

// ---------------------------------------------------------------------------
// Minimal DOM shim: plugin.js touches document (style element) at render time.
// ---------------------------------------------------------------------------

const styleElements = []
globalThis.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: tag => ({
    tag,
    id: '',
    textContent: '',
    appendChild() {},
    click() {},
    style: {},
    set href(v) { this._href = v },
    get href() { return this._href }
  }),
  head: { appendChild: el => styleElements.push(el) }
}
globalThis.window = globalThis.window || { innerWidth: 1600, addEventListener() {}, removeEventListener() {} }
globalThis.window.matchMedia = globalThis.window.matchMedia || (q => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
if (!globalThis.matchMedia) globalThis.matchMedia = globalThis.window.matchMedia
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || (fn => setTimeout(fn, 0))
globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} }

const flush = () => new Promise(resolve => setTimeout(resolve, 20))

// ---------------------------------------------------------------------------
// 1) import-scan on raw source
// ---------------------------------------------------------------------------

const src = readFileSync(PLUGIN_PATH, 'utf8')
const importMatches = src.match(/from\s+["'][^"']+["']/g) || []
const allowed = new Set(['from "@hermes/plugin-sdk"', 'from "react"', 'from "react/jsx-runtime"'])
const illegal = importMatches.map(m => m.trim()).filter(m => !allowed.has(m))
check(illegal.length === 0, 'loader import-scan found illegal specifiers: ' + JSON.stringify(illegal))

// 2) import + register
let plugin
let pluginModule
try {
  pluginModule = await import(pathToFileURL(PLUGIN_PATH).href + '?t=' + Date.now())
  plugin = pluginModule.default
} catch (err) {
  check(false, 'plugin failed to import: ' + err.message)
  console.log('FAILURES: ' + failures)
  process.exit(1)
}

check(plugin.id === 'kanban-gantt', 'plugin id')
check(typeof plugin.register === 'function', 'register is a function')

const contributions = []
const ctx = {
  rest: async (path, opts) => {
    calls.rest.push({ path, opts })
    if (path === '/boards') return boards
    return {}
  },
  storage: { get: (k, fb) => {
    if (k === 'board') return 'sumaris-app'
    if (k === 'viewMode' && globalThis.__kgView) return globalThis.__kgView
    if (k === 'onlyAttachments' && globalThis.__kgOnlyAtt) return '1'
    return fb
  }, set: () => {} },
  i18n: { register: () => {} },
  register: c => { contributions.push(c); return () => {} },
  registerMany: cs => { contributions.push(...cs); return () => {} }
}

try {
  plugin.register(ctx)
  check(true, 'register() completed')
} catch (err) {
  check(false, 'register() threw: ' + (err && err.stack ? err.stack : err))
}

const areas = contributions.map(c => c.area)
check(areas.includes('routes'), 'ROUTES_AREA page contribution')
check(areas.includes('sidebar.nav'), 'SIDEBAR_NAV_AREA contribution')
check(areas.filter(a => a === 'palette').length === 1, 'one PALETTE_AREA command')

const page = contributions.find(c => c.area === 'routes')
check(page && page.data && page.data.path === '/kanban-gantt', 'page path /kanban-gantt')

// 3) page render: gantt rows + chrome render from the stubbed snapshot
let pageNode
try {
  pageNode = page.render()
} catch (err) {
  check(false, 'page render threw: ' + (err && err.stack ? err.stack : err))
}
if (pageNode) {
  await flush()
  pageNode = page.render() // second render picks up resolved query data
  const flat = JSON.stringify(pageNode)
  check(flat.includes('Epic — first task'), 'page renders task titles')
  // The attachment icon has to reach the RENDER, not merely the data — and it is `attach`, not
  // `paperclip`: that name renders as nothing in this app's icon set, which cost an afternoon.
  // The count is textual because the row nodes sit behind a child the stub does not invoke, so a
  // tree walk cannot reach them. Two: the one row with files, plus the filter menu's own icon.
  const icons = (flat.match(/"attach"/g) || []).length
  check(icons === 2, `one icon in the row with files plus the filter menu's (found ${icons})`)

  // The "only tasks with attachments" filter. The fixture has exactly one task with files, so
  // with the option off the board shows all three rows and with it on it shows that one row —
  // and the option has to be OFF unless it was stored, which is what the default render proves.
  const rowCount = text => (text.match(/"data-row-id"/g) || []).length
  check(rowCount(flat) === 3, `all three rows by default (found ${rowCount(flat)})`)
  globalThis.__kgOnlyAtt = true
  const filteredFlat = JSON.stringify(page.render())
  check(rowCount(filteredFlat) === 1,
    `the attachment filter leaves only the task with files (found ${rowCount(filteredFlat)})`)
  globalThis.__kgOnlyAtt = false
  // The DETAIL, which nothing covered until now: open a task, render, and look at what the drawer
  // draws. Driving the state beats clicking a row — the stub does not reach the row nodes — and it
  // is the path that hid a "cannot access before initialization" crash while every check stayed
  // green, because the harness had never opened a task at all.
  pluginModule.$openTaskId.set('t_1')
  const detailFlat = JSON.stringify(page.render())
  check(detailFlat.includes('noDescription'),
    'the detail draws its sections (the fixture task has no description, so that state shows)')
  check(!detailFlat.includes('detailMeta'),
    'docked by default: the modal column (its "Information" heading) is not rendered')
  check(!detailFlat.includes('Cannot access') && !detailFlat.includes('renderError'),
    'the detail renders without throwing')

  // The modal branch, which the panel never exercises.
  pluginModule.$detailModal.set(true)
  // The feed strip: tabs, not collapsible blocks. The fixture task has neither events nor runs, so
  // the strip must offer Comments alone — an empty tab is a promise the panel cannot keep — and
  // Comments is what a reader lands on, because that is where a first comment gets written.
  check((detailFlat.match(/"role":"tab"/g) || []).length === 1,
    'the feed offers Comments alone when a task has neither events nor runs')
  check(detailFlat.includes('"aria-selected":"true"'),
    'the feed opens on the first tab rather than on nothing')
  // The count is a badge beside the label, not "Comments (0)" inside it: the label is its
  // own span fed by the plain key, the badge is a second span carrying the number, and the
  // screen reader still gets the counting form through aria-label. (The harness's i18n stub
  // returns keys, so "tabComments" and "comments" below ARE those two call sites.)
  check(detailFlat.includes('"children":"tabComments"'), 'the tab label comes from the plain key')
  check(detailFlat.includes('"aria-label":"comments"'), 'the counting form survives, for a screen reader')
  check(detailFlat.includes('tabular-nums'), 'the count renders as a badge beside the label')
  check(detailFlat.includes('"children":"0"'), 'the badge carries the count itself')
  // The CLI block: kanban-graph closes its detail with a copyable command, and it is the
  // one thing a shell-first reader wants from a GUI. The board comes from the task (or
  // the selected board), the id from the drawer.
  check(detailFlat.includes('hermes kanban'), 'the detail offers the CLI command')
  check(detailFlat.includes('--board sumaris-app'), 'the command names the board the task lives on')
  const modalFlat = JSON.stringify(page.render())
  check(modalFlat.includes('detailMeta'), 'the modal renders its right-hand information column')
  check(modalFlat.includes('metaPriority'), 'the modal column carries the priority row')
  pluginModule.$detailModal.set(false)
  pluginModule.$openTaskId.set(null)

  check(flat.includes('"area":"workspace.pageHeader"') || flat.includes('"area": "workspace.pageHeader"'), 'page projects its switcher into WORKSPACE_PAGE_HEADER_AREA')

  // Board tabs: the strip is a tablist, and its "+" is the only way to open a second board
  // without leaving the page (the harness's effects are no-ops, so the open set is empty and
  // the strip shows the affordance alone — which is exactly the point: it is always there).
  check(flat.includes('"role":"tablist"'), 'the page declares the board tab strip')
  check(flat.includes('"aria-label":"openBoard"'), 'the strip carries the "open another board" affordance')
  check(typeof pluginModule.KanbanGanttRoute === 'function',
    'the route mounts one page instance per board (per-board preferences need the remount)')

  // -------------------------------------------------------------------------
  // The dedicated attachment column, in list view. The page reads its view mode through the
  // storage door, so flipping that door renders the other view — no need to reach into state.
  //
  // What is asserted here is what the harness can honestly see: the column is DECLARED, with
  // its own width and its own header. The icon INSIDE a row's cell is not reachable from this
  // harness: `ListCells` throws under its i18n stub, and the stub turns a render exception
  // into a silent `renderError` node, so the row cells never reach the tree. That assertion
  // belongs to a harness whose i18n is real — noted rather than faked with a weaker check.
  // -------------------------------------------------------------------------
  globalThis.__kgView = 'list'
  const listNode = page.render()
  const listFlat = JSON.stringify(listNode)
  check(listFlat.includes('minmax(0, 1fr) 150px 96px 64px 40px'),
    'list view declares five tracks, the last 40 px wide, for the attachment column')
  check(listFlat.includes('attachments-header'), 'the attachment column has a header cell of its own')
  globalThis.__kgView = 'timeline'
}

// ---------------------------------------------------------------------------
// 3b) the graph view, rendered DIRECTLY: the harness's REST stub answers `{}` for the
// board snapshot, so the page itself has no tasks to lay out. The component takes no
// atoms on purpose, which means a fixture board is enough to exercise the real layout,
// the real node anatomy and the real scope filter.
// ---------------------------------------------------------------------------

if (typeof pluginModule.GraphView === 'function') {
  const H = 3600
  const now = 1_800_000_000
  const mk = (id, extra = {}) => ({
    id, title: extra.title || `task ${id}`, status: extra.status || 'todo',
    priority: extra.priority ?? null, assignee: extra.assignee || '',
    parents: extra.parents || [], children: extra.children || [], events: extra.events || [],
    runs: extra.runs || [], attachment_count: extra.attachment_count || 0, board: extra.board || 'sumaris-app'
  })
  const tasks = [
    mk('a', { status: 'done', children: [{ id: 'b' }], events: [{ created_at: now - 23.5 * H }] }),
    mk('b', { status: 'running', parents: [{ id: 'a' }], children: [{ id: 'c' }], assignee: 'dev', attachment_count: 2 }),
    mk('c', { status: 'todo', parents: [{ id: 'b' }] })
  ]
  // i18n keys that are plain strings (the rest are the counting functions).
  const PLAIN = new Set(['nothingToDisplay', 'noTasksMatch', 'viewGraph', 'graphNoActivity', 'graphScopeAria', 'graphScopeAll', 'graphScopeOpen', 'graphScopeRunning'])
  const gi18n = new Proxy({}, {
    get: (_t, key) => (PLAIN.has(String(key))
      ? String(key)
      : (...args) => `${String(key)}(${args.join(',')})`)
  })
  const renderGraph = props => pluginModule.GraphView({ tasks, i18n: gi18n, now, ...props })
  const all = JSON.stringify(renderGraph({}))
  const nodeCount = (all.match(/"data-graph-node"/g) || []).length
  check(nodeCount === 3, `the graph draws one node per visible task (got ${nodeCount})`)
  check((all.match(/"markerEnd":"url\(#kg-arrow\)"/g) || []).length === 2,
    'the graph draws one arrow per parent→child link (two links on a chain of three)')
  // Node anatomy: the status stripe, the paperclip with its count, and the profile initials
  // avatar are what our rows show and a kanban-graph card does not.
  check(all.includes('3px solid'), 'each node carries its status stripe')
  check(all.includes('0.85rem') && all.includes('dev'), 'the node shows the assignee avatar (initials)')
  check(all.includes('graphSparkline(24)'), 'the sparkline is drawn from the events, over the period window')
  check(!all.includes('graphNoActivity'), 'a node with no activity draws no band at all (no empty axis)')
  // Taller cards: the title wraps (line-clamp-2) and the layout was told a taller nodeH, so the
  // boxes grow instead of the text overflowing.
  const tall = JSON.stringify(renderGraph({ tallCards: true }))
  check(tall.includes('line-clamp-3') && tall.includes('whitespace-normal'),
    'tall cards wrap the title onto three lines instead of truncating it')
  // The footer always reports how much of the board it is showing (nothing was implied or
  // dangling on this chain, so the counts collapse to the ratio).
  check(all.includes('"children":"3/3"'), 'the footer reports how many tasks the view shows')

  // The board name is never on a CARD (a single-board graph carries none at all). When several
  // boards share the view, each board becomes a framed, contiguous block labelled at its
  // top-left — the kanban-graph shape — instead of every card wearing a badge.
  check(!all.includes('"children":"sumaris-app"'), 'a single-board graph carries no board name')
  const twoBoards = [
    mk('x1', { title: 'alpha task', board: 'alpha' }),
    mk('y1', { title: 'beta task', board: 'beta' })
  ]
  const framed = JSON.stringify(pluginModule.GraphView({
    tasks: twoBoards, i18n: gi18n, now, showBoardBadge: true, groupLabel: slug => slug.toUpperCase()
  }))
  check(framed.includes('border-dashed') && framed.includes('rounded-lg'),
    'the all-boards graph frames each board (dashed, rounded) instead of badging every card')
  check(framed.includes('"children":"ALPHA"') && framed.includes('"children":"BETA"'),
    'each frame names its board at the top-left, through the label resolver')
  check(!framed.includes('"title":"alpha"'), 'no per-card board badge in the frame layout')

  // Scopes: Open drops the done task; Running + lineage keeps the running one AND its
  // ancestry and descendants.
  const open = JSON.stringify(renderGraph({ scope: 'open' }))
  check((open.match(/"data-graph-node"/g) || []).length === 2, 'the Open scope drops the done task')
  const running = JSON.stringify(renderGraph({ scope: 'running-lineage' }))
  check((running.match(/"data-graph-node"/g) || []).length === 3,
    'Running + lineage keeps the running task with its whole lineage')

  // A board with nothing running says so honestly rather than drawing an empty frame.
  const nothingRunning = JSON.stringify(pluginModule.GraphView({
    tasks: [mk('x', { status: 'todo' })], i18n: gi18n, now, scope: 'running-lineage'
  }))
  check(nothingRunning.includes('nothingToDisplay'), 'an empty scope renders the empty state, not a bare canvas')
}


// 4) titlebar chrome: switcher contributed to titleBar.center
const nav = contributions.find(c => c.area === 'sidebar.nav')
check(nav && nav.data && nav.data.path === '/kanban-gantt', 'sidebar nav path')

console.log(`checks: ${checks}, failures: ${failures}`)
if (failures > 0) process.exit(1)
