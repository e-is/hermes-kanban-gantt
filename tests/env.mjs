// env.mjs — tiny .env loader for the demo/test scripts (no dependency).
//
// Reads <repo root>/.env (KEY=VALUE lines, # comments, blank lines ignored)
// and exports each key into process.env WITHOUT overriding variables that are
// already set in the real environment (explicit env wins).
//
// The repo ships .env.example instead: copy it to .env and adapt the paths to
// your machine. .env itself is gitignored.

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export async function loadEnv() {
  let text = ''
  try {
    text = await readFile(join(REPO_ROOT, '.env'), 'utf8')
  } catch {
    return // no .env — env vars / defaults only
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    // strip optional surrounding quotes
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}