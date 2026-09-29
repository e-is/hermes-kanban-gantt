#!/usr/bin/env node
// Refresh every agent skill listed in skills-lock.json into .agents/skills/
// (.claude/skills is a symlink to it). Run by `npm install` (postinstall).
//
// Add a skill once with `npx skills add <source> -a universal`; it lands in
// skills-lock.json and every later `npm install` re-fetches it:
//   - github entries: sparse fetch of the skill's sub-folder (fast, unlike
//     `skills update`, which clones the whole repo);
//   - local entries: copied from the lock's path, falling back to
//     $HERMES_HOME/skills/<category>/<name> (skills not published upstream).
// Skills are fetched in parallel, each in a scratch dir, then copied in and
// merged into the lock (parallel `skills add` in one dir would race on it).
// Never fails the install. Set SKIP_SKILLS_SYNC=1 to skip.

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = join(ROOT, 'skills-lock.json');
const DEST = join(ROOT, '.agents', 'skills');
const SKILLS_BIN = join(ROOT, 'node_modules', '.bin', 'skills');
const HERMES_SKILLS = join(process.env.HERMES_HOME || join(homedir(), '.hermes'), 'skills');

const log = (msg) => console.log(`skills:sync: ${msg}`);

if (process.env.SKIP_SKILLS_SYNC) { log('skipped (SKIP_SKILLS_SYNC)'); process.exit(0); }
if (!existsSync(LOCK)) { log('no skills-lock.json, nothing to sync'); process.exit(0); }
if (!existsSync(SKILLS_BIN)) { log('skills CLI not installed, skipping'); process.exit(0); }

const lock = JSON.parse(readFileSync(LOCK, 'utf8'));

// Directory holding the local skill `name`, or null.
function localParent(name, entry) {
  const candidates = [resolve(ROOT, entry.source)];
  if (existsSync(HERMES_SKILLS)) {
    for (const cat of readdirSync(HERMES_SKILLS)) candidates.push(join(HERMES_SKILLS, cat));
  }
  return candidates.find((dir) => existsSync(join(dir, name, 'SKILL.md'))) ?? null;
}

// `skills add` arguments for one lock entry, or null when unavailable.
function addArgs(name, entry) {
  if (entry.sourceType === 'github' && entry.skillPath) {
    const folder = dirname(entry.skillPath);
    return [`https://github.com/${entry.source}/tree/${entry.ref || 'main'}/${folder}`];
  }
  if (entry.sourceType === 'local') {
    const parent = localParent(name, entry);
    return parent && [parent, '-s', name];
  }
  return null;
}

function run(args, cwd) {
  return new Promise((done) => {
    const child = spawn(SKILLS_BIN, [...args, '-a', 'universal', '-y'], { cwd, stdio: 'ignore' });
    child.on('error', () => done(false));
    child.on('exit', (code) => done(code === 0));
  });
}

async function sync(name, entry) {
  const args = addArgs(name, entry);
  if (!args) return log(`✗ ${name} (source not found, kept as is)`);
  const scratch = mkdtempSync(join(tmpdir(), 'skills-sync-'));
  try {
    const fetched = join(scratch, '.agents', 'skills', name);
    if (!(await run(args, scratch)) || !existsSync(fetched)) {
      return log(`✗ ${name} (fetch failed, kept as is)`);
    }
    rmSync(join(DEST, name), { recursive: true, force: true });
    cpSync(fetched, join(DEST, name), { recursive: true });
    const fresh = JSON.parse(readFileSync(join(scratch, 'skills-lock.json'), 'utf8')).skills[name];
    // A local source is recorded relative to the scratch dir: keep ours.
    lock.skills[name] = entry.sourceType === 'local' ? { ...entry, computedHash: fresh.computedHash } : fresh;
    log(`✓ ${name} (${entry.sourceType === 'local' ? args[0] : args[0].replace('https://github.com/', '')})`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

await Promise.all(Object.entries(lock.skills).map(([name, entry]) => sync(name, entry)));
writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
