// Regression: the REST door must forward the HTTP verb when there is NO body.
//
// `ctx.rest(path, undefined)` defaults to GET, so a bodyless DELETE (removing a
// parent link) used to leave as `GET /tasks/<id>/parent/<pid>` — no route
// matches, and the backend's catch-all answers 404 with the "headless serve"
// message, which is what the user saw in the drawer.
//
// state.ts imports only `atom` from the SDK, so the test bundles the real source
// against a stub package: what runs here is the shipped module, not a copy.
import { build } from 'esbuild'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC = join(HERE, '..', 'src', 'state.ts')

const SDK_STUB = `
export const atom = (initial) => ({
  _value: initial,
  get: () => initial,
  set: () => {},
  subscribe: () => () => {}
})
`

/** Bundle src/state.ts against the stub and return the module. */
async function loadState() {
  const dir = await mkdtemp(join(tmpdir(), 'kg-state-'))
  const stub = join(dir, 'sdk-stub.mjs')
  await writeFile(stub, SDK_STUB)
  const out = join(dir, 'state.mjs')
  // The stub is injected by resolution (not by a temp node_modules) because
  // esbuild walks up from the ENTRY's directory to find packages.
  const sdkStub = {
    name: 'sdk-stub',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@hermes\/plugin-sdk$/ }, () => ({ path: stub }))
    }
  }
  await build({
    entryPoints: [SRC],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    plugins: [sdkStub],
    logLevel: 'silent'
  })
  const mod = await import(out)
  await rm(dir, { recursive: true, force: true }) // the module is already loaded
  return mod
}

test('a bodyless call still carries its method', async () => {
  const state = await loadState()
  const calls = []
  state.setPluginDoors((path, opts) => {
    calls.push({ path, opts })
    return Promise.resolve({})
  }, { get: () => null, set: () => {} })

  await state.removeParent('t_child', 't_parent', 'demo')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].opts.method, 'DELETE', 'a DELETE without a body must not degrade to GET')
  assert.equal(calls[0].path, '/tasks/t_child/parent/t_parent?board=demo')
  assert.equal(calls[0].opts.body, undefined)
})

test('methods and bodies travel unchanged on the other verbs', async () => {
  const state = await loadState()
  const calls = []
  state.setPluginDoors((path, opts) => {
    calls.push({ path, opts })
    return Promise.resolve({})
  }, { get: () => null, set: () => {} })

  await state.fetchBoards()
  await state.setParent('t_child', 't_parent', 'replace', 'demo')
  await state.createTask({ title: 'x' }, 'demo')

  assert.equal(calls[0].opts.method, 'GET')
  assert.equal(calls[0].opts.body, undefined)
  assert.equal(calls[1].opts.method, 'POST')
  assert.deepEqual(calls[1].opts.body, { parentId: 't_parent', mode: 'replace' })
  assert.equal(calls[2].opts.method, 'POST')
  assert.deepEqual(calls[2].opts.body, { title: 'x' })
})
