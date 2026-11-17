// Regression guard for issue #21: Desktop/Gateway 0.22.5 does not export KANBAN_CARD_AREAS, and a
// NAMED import of a name a host lacks fails the whole module at link time ("does not provide an
// export named ...") — the plugin then disappears from Capabilities. Optional SDK surface must be
// read off the default export object, never destructured in an import statement.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = join(dirname(new URL(import.meta.url).pathname), '..', '..')
const artifact = readFileSync(join(root, 'desktop', 'plugin.js'), 'utf8')

/** Every `import { ... } from '@hermes/plugin-sdk'` statement, as its list of names. */
function sdkImports(source) {
  const names = []
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@hermes\/plugin-sdk["']/g)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim()
      if (name) names.push(name)
    }
  }
  return names
}

test('the plugin never named-imports KANBAN_CARD_AREAS (issue #21)', () => {
  assert.ok(sdkImports(artifact).length > 0, 'the artifact imports the SDK')
  assert.ok(!sdkImports(artifact).includes('KANBAN_CARD_AREAS'),
    'KANBAN_CARD_AREAS is optional in the host: read it off the default export, or 0.22.5 cannot load the plugin')
  // And it IS still used, through the object — otherwise the badge silently vanished everywhere.
  assert.match(artifact, /KANBAN_CARD_AREAS/, 'the badge area is still read off the SDK object')
})
