// Regression: every shipped locale bundle must stay at key parity with English.
//
// The plugin ships 17 bundles under `src/locales/` (en + 16 translations). A
// missing key, an extra key, a string where English has an interpolation
// function (or a function with a different arity) silently falls back to the
// English bundle at runtime — the user just sees un-translated copy. This test
// imports the REAL modules (Node's type stripping handles the .ts sources) and
// compares every leaf against `en`.
//
// It also guards the wiring: a bundle that exists on disk but is not listed in
// `src/i18n.ts` is dead weight the app can never select.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const LOCALES_DIR = join(HERE, '..', 'src', 'locales')
const I18N_SRC = join(HERE, '..', 'src', 'i18n.ts')

// The Hermes desktop locale ids the plugin registers. `zh-hant` is the only id
// that differs from its module name (`zh-hant.ts` exports `zhHant`).
const EXPECTED_IDS = [
  'af', 'ar', 'de', 'en', 'es', 'fr', 'ga', 'hu', 'it',
  'ja', 'ko', 'pt', 'ru', 'tr', 'uk', 'zh', 'zh-hant',
]

/** Flatten a bundle into `{ 'a.b.c': { kind, arity } }`. */
function leaves(node, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'function') out[path] = { kind: 'function', arity: value.length }
    else if (value && typeof value === 'object') leaves(value, path, out)
    else out[path] = { kind: typeof value, value }
  }
  return out
}

const FILES = (await readdir(LOCALES_DIR))
  .filter((f) => f.endsWith('.ts'))
  .sort()

function idOf(file) {
  return file.replace(/\.ts$/, '')
}

async function loadBundle(file) {
  const mod = await import(pathToFileURL(join(LOCALES_DIR, file)).href)
  const names = Object.keys(mod)
  assert.equal(names.length, 1, `${file} must export exactly one bundle, found: ${names.join(', ')}`)
  return mod[names[0]]
}

const en = await loadBundle('en.ts')
const EN = leaves(en)

test('every expected locale module exists, and nothing else is shipped', () => {
  const onDisk = FILES.map(idOf).sort()
  assert.deepEqual(onDisk, [...EXPECTED_IDS].sort(), 'src/locales/ must hold exactly the 17 shipped locales')
})

test('the English bundle has no empty string', () => {
  const empty = Object.entries(EN).filter(([, v]) => v.kind === 'string' && v.value.trim() === '')
  assert.deepEqual(empty.map(([k]) => k), [], 'empty strings in en')
})

for (const file of FILES) {
  const id = idOf(file)
  if (id === 'en') continue

  test(`${id}: identical recursive key set, value kinds and arity vs en`, async () => {
    const bundle = await loadBundle(file)
    const got = leaves(bundle)

    const missing = Object.keys(EN).filter((k) => !(k in got))
    const extra = Object.keys(got).filter((k) => !(k in EN))
    assert.deepEqual(missing, [], `${id}: missing key paths`)
    assert.deepEqual(extra, [], `${id}: extra key paths`)

    const kindMismatch = []
    const arityMismatch = []
    for (const [path, expected] of Object.entries(EN)) {
      const actual = got[path]
      if (actual.kind !== expected.kind) {
        kindMismatch.push(`${path}: expected ${expected.kind}, got ${actual.kind}`)
      } else if (expected.kind === 'function' && actual.arity !== expected.arity) {
        arityMismatch.push(`${path}: expected ${expected.arity} args, got ${actual.arity}`)
      }
    }
    assert.deepEqual(kindMismatch, [], `${id}: value kind mismatches`)
    assert.deepEqual(arityMismatch, [], `${id}: interpolation arity mismatches`)

    const empty = Object.entries(got).filter(([, v]) => v.kind === 'string' && v.value.trim() === '')
    assert.deepEqual(empty.map(([k]) => k), [], `${id}: empty strings`)
  })
}

test('src/i18n.ts imports and registers every bundle', async () => {
  const src = await readFile(I18N_SRC, 'utf8')
  for (const id of EXPECTED_IDS) {
    assert.ok(
      src.includes(`from './locales/${id}'`),
      `src/i18n.ts does not import ./locales/${id}`,
    )
  }
  const imports = [...src.matchAll(/from '\.\/locales\/([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(imports.sort(), [...EXPECTED_IDS].sort(), 'src/i18n.ts must import each locale exactly once')
  // The registry key must equal the Hermes locale id, or the app cannot select it.
  assert.match(src, /'zh-hant':\s*zhHant/, "src/i18n.ts must register zh-hant as 'zh-hant'")
})
