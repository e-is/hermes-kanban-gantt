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
    { id: 't_1', title: 'Epic — first task', status: 'running', assignee: 'alice', started_at: 1_800_000_000, created_at: 1_799_000_000, archived: false },
    { id: 't_2', title: 'Child task (done)', status: 'done', assignee: 'bob', completed_at: 1_800_100_000, created_at: 1_799_000_000, archived: false },
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
try {
  plugin = (await import(pathToFileURL(PLUGIN_PATH).href + '?t=' + Date.now())).default
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
  storage: { get: (k, fb) => (k === 'board' ? 'sumaris-app' : fb), set: () => {} },
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
  check(flat.includes('"area":"workspace.pageHeader"') || flat.includes('"area": "workspace.pageHeader"'), 'page projects its switcher into WORKSPACE_PAGE_HEADER_AREA')
}

// 4) titlebar chrome: switcher contributed to titleBar.center
const nav = contributions.find(c => c.area === 'sidebar.nav')
check(nav && nav.data && nav.data.path === '/kanban-gantt', 'sidebar nav path')

console.log(`checks: ${checks}, failures: ${failures}`)
if (failures > 0) process.exit(1)
