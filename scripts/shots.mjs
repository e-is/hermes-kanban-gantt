// Pick a Python that can drive CDP, then run scripts/shots.py.
//
// `websockets` is what shots.py drives the desktop with; the system python3
// usually has it absent while the Hermes runtime ships it. Candidate order:
// HERMES_PYTHON, then python3, then the interpreters under ~/.hermes/tools.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const toolsDir = join(homedir(), '.hermes', 'tools')
const installsDir = join(homedir(), '.hermes', 'installs')

// The Hermes venv is the one interpreter known to carry both websockets (CDP)
// and ruamel.yaml (the kanban domain the seed script uses).
const fromTools = existsSync(toolsDir)
  ? readdirSync(toolsDir)
      .filter(name => name.startsWith('python-'))
      .map(name => join(toolsDir, name, 'bin', 'python3'))
  : []

const fromInstalls = existsSync(installsDir)
  ? readdirSync(join(installsDir))
      .flatMap(install => {
        const envDir = join(installsDir, install, 'environments')
        return existsSync(envDir)
          ? readdirSync(envDir).map(env => join(envDir, env, 'venv', 'bin', 'python3'))
          : []
      })
      .filter(existsSync)
  : []

const candidates = [
  process.env.HERMES_PYTHON,
  join(homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'python3'),
  process.env.VIRTUAL_ENV ? join(process.env.VIRTUAL_ENV, 'bin', 'python3') : null,
  'python3',
  ...fromInstalls,
  ...fromTools,
].filter(Boolean)

for (const python of candidates) {
  const probe = spawnSync(python, ['-c', 'import websockets'], { stdio: 'ignore' })
  if (probe.status !== 0) continue

  const run = spawnSync(python, [join(here, 'shots.py'), ...process.argv.slice(2)], { stdio: 'inherit' })
  if (run.error) {
    console.error(`shots: failed to run ${python}: ${run.error.message}`)
    process.exit(1)
  }
  process.exit(run.status ?? 1)
}

console.error(
  'shots: no Python with the `websockets` package found.\n' +
    `  tried: ${candidates.join(', ')}\n` +
    '  set HERMES_PYTHON to one that has it (the Hermes runtime ships it).'
)
process.exit(1)
