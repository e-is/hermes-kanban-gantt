/**
 * No conditional exit above a hook, in any function of src/main.ts.
 *
 * React's #310 ("Rendered more hooks than during the previous render") bit this plugin twice,
 * both times the same way: a guard like `if (isLoading && !data) return <Loader/>` sitting ABOVE
 * a block of hooks. The first render takes the guard and runs fewer hooks; the second render
 * passes it and runs them all, and React replaces the page with its error boundary.
 *
 * The rule is mechanical, so it is checked mechanically: within a function, every `return` that
 * belongs to the FUNCTION BODY must come after its last hook call.
 *
 * Telling a body return from a callback return is the whole difficulty: `useMemo(() => { return x })`
 * legitimately returns early, and the guard that bit us hides inside an `if` block at that same
 * brace depth — so depth alone decides nothing. A stack of nested function openings is kept
 * instead: an `if` block does not push, a callback does, and returns only count while the stack
 * is empty.
 *
 * Run: node tests/ui/hook-order.test.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE = process.env.KG_SOURCE || join(__dirname, '..', '..', 'src', 'main.ts')

const HOOKS = /\b(useState|useRef|useMemo|useEffect|useCallback|useReducer|useContext|useValue|useQuery|useMutation|useQueryClient|useSyncExternalStore|useGanttI18n|usePlugin)\s*\(/
const NESTED_FN = /(=>|\bfunction\b)[^;]*\{/   // a callback body opening on this line
const COMMENT = /^\s*(\/\/|\*|\/\*)/

let failures = 0
let checks = 0
const check = (cond, msg) => {
  checks += 1
  if (!cond) {
    failures += 1
    console.error('FAIL: ' + msg)
  }
}

const lines = readFileSync(SOURCE, 'utf8').split('\n')

/** Span of each top-level function / arrow component, by line index. */
const spans = []
lines.forEach((line, i) => {
  const fn = /^(?:export\s+)?function\s+([A-Za-z0-9_$]+)/.exec(line)
  const arrow = /^(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/.exec(line)
  const name = fn ? fn[1] : arrow ? arrow[1] : null
  if (name) spans.push({ name, start: i })
})
spans.forEach((s, i) => { s.end = i + 1 < spans.length ? spans[i + 1].start - 1 : lines.length - 1 })

const braces = line => (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length

/** The file with comments and string/template CONTENTS blanked out.
 *
 *  Without this, a brace inside a string or a comment unbalances the depth tracking and the
 *  nested-function stack leaks for the rest of the file — which silently disables the whole
 *  check. Columns are preserved (blanked characters become spaces) so indentation still means
 *  what it meant. */
const code = (() => {
  let inBlockComment = false
  let quote = null
  const out = []
  for (const line of lines) {
    let result = ''
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      const next = line[i + 1]
      if (inBlockComment) {
        result += ' '
        if (ch === '*' && next === '/') { inBlockComment = false; result += ' '; i += 1 }
        continue
      }
      if (quote) {
        result += ' '
        if (ch === '\\') { result += ' '; i += 1; continue }
        if (ch === quote) quote = null
        continue
      }
      if (ch === '/' && next === '/') break
      if (ch === '/' && next === '*') { inBlockComment = true; result += '  '; i += 1; continue }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; result += ' '; continue }
      result += ch
    }
    out.push(result)
  }
  return out
})()

for (const { name, start, end } of spans) {
  let depth = 0
  let opened = false
  const nested = []          // brace depths at which a callback body opened
  const hooks = []
  const returns = []
  for (let i = start; i <= end; i += 1) {
    const line = code[i]
    const isComment = COMMENT.test(line)
    if (!opened && line.includes('{')) opened = true
    const bodyLevel = nested.length === 0
    if (opened && bodyLevel && !isComment) {
      if (HOOKS.test(line)) hooks.push(i)
      if (/^\s*return\b/.test(line)) returns.push(i)
    }
    // A callback opens AFTER its own line has been read, so the hook on it still counts.
    // `depth >= 1` skips the function's OWN definition line, which also reads as
    // `function name() {` — pushing it would hide the whole body from the check.
    if (opened && depth >= 1 && NESTED_FN.test(line) && !isComment) {
      nested.push(depth + 1)
    }
    depth += braces(line)
    while (nested.length && depth < nested[nested.length - 1]) nested.pop()
  }
  if (!hooks.length) continue
  const lastHook = hooks[hooks.length - 1]
  const early = returns.filter(i => i < lastHook)
  check(
    early.length === 0,
    `${name}(): a body-level return at line ${early.length ? early[0] + 1 : '?'} sits above the last `
    + `hook (line ${lastHook + 1}). Every hook must run on every render — move the guard below `
    + 'them, or render that state from the JSX.'
  )
  if (!early.length) continue
  for (const i of early.slice(0, 3)) {
    console.error(`        l.${i + 1}: ${lines[i].trim().slice(0, 90)}`)
  }
}

// The page is the one that failed: make sure it was really inspected, so a rename cannot
// turn this test into a silent no-op.
check(spans.some(s => s.name === 'KanbanGanttPage'), 'KanbanGanttPage() was found and inspected')
check(spans.length > 8, `functions inspected: ${spans.length} (expected more than 8)`)

console.log(`check: ${checks}, failures: ${failures}`)
if (failures) process.exit(1)
