#!/usr/bin/env node
/**
 * Build script — compiles src/ into the distributable desktop halves:
 *
 *   desktop/plugin.js       bundled renderer (src/main.ts), with
 *                           @hermes/plugin-sdk, react, react/jsx-runtime kept
 *                           EXTERNAL — the desktop loader rewrites exactly
 *                           those bare specifiers.
 *   desktop/gantt-core.js   pure core as a standalone ESM module, consumed by
 *                           tests/gantt-core.test.mjs.
 *
 * CI guard: rebuild and `git diff --exit-code desktop/` to detect drift.
 */
import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const common = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'info',
  jsx: 'automatic',
  external: ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime']
}

await build({
  ...common,
  entryPoints: [join(root, 'src', 'main.ts')],
  outfile: join(root, 'desktop', 'plugin.js'),
  banner: {
    js: [
      '/*',
      ' * Hermes Kanban Gantt — desktop renderer (BUILD ARTIFACT).',
      ' * Source of truth: src/ — run `npm run build` after editing.',
      ' * Loaded uncompiled by Hermes Desktop; only @hermes/plugin-sdk, react',
      ' * and react/jsx-runtime are importable specifiers.',
      ' */'
    ].join('\n')
  }
})

await build({
  ...common,
  entryPoints: [join(root, 'src', 'core', 'gantt-core.ts')],
  outfile: join(root, 'desktop', 'gantt-core.js')
})

await build({
  ...common,
  // Pure client logic of the websocket prototype (spike t_64075faf): built
  // standalone so tests/ws-core.test.mjs exercises the shipped decisions.
  entryPoints: [join(root, 'src', 'core', 'ws-core.ts')],
  outfile: join(root, 'desktop', 'ws-core.js')
})

console.log('build OK')
