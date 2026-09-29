#!/usr/bin/env node
// Contrast probe for plugin UI palettes, measured in Chromium against the app's
// REAL stylesheet. A palette claim ("readable on the app's surfaces") is only
// worth the tokens it was measured against: hand-copied hexes and a bare `.dark`
// class both lie, because every dark value arrives INLINE from the active skin
// (:root.dark only flips the mix knobs).
//
// Usage:
//   PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright \
//     node scripts/theme-contrast-probe.mjs [--css palette.css] [--out DIR]
//   node scripts/theme-contrast-probe.mjs --from-src src/main.ts --marker 'Readability:'
//
// --css <file>        CSS to test (e.g. a `.kg-prose { --tw-prose-body: … }` palette).
//                     Omit it and the probe measures the baseline (no palette).
// --from-src <file>   extract the block from a source file instead, starting at the
//                     nearest `/*` comment before --marker (a plugin's injected style).
// --marker <string>   marker inside that source file.
// --out <dir>         screenshots + result.json (default: /tmp/kg-contrast-probe).
//
// Env: KG_APP_CSS_DIR (built desktop stylesheets), KG_PLAYWRIGHT_MODULE,
//      KG_SKIN_JSON ({"light":{…},"dark":{…}} of --theme-* seed values).

import { readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name)
  return i === -1 ? fallback : argv[i + 1]
}
const CSS_FILE = flag('--css')
const FROM_SRC = flag('--from-src')
const MARKER = flag('--marker')
const OUT = flag('--out', '/tmp/kg-contrast-probe')
const PW_MODULE = process.env.KG_PLAYWRIGHT_MODULE ||
  `${process.env.HOME}/.nvm/versions/node/v22.21.1/lib/node_modules/playwright/index.mjs`
const { chromium } = await import(PW_MODULE)

// The built app stylesheet already carries every --ui-* definition, the Tailwind
// typography rules and the :root / :root.dark split — loading it keeps the
// cascade the app's instead of re-declaring tokens by hand.
const APP_CSS_DIR = process.env.KG_APP_CSS_DIR || `${process.env.HOME}/.hermes/hermes-agent/apps/desktop/dist/assets`
const appCssFile = readdirSync(APP_CSS_DIR).find(f => /^index-.*\.css$/.test(f))
if (!appCssFile) throw new Error(`no index-*.css in ${APP_CSS_DIR} (set KG_APP_CSS_DIR)`)
const APP_CSS = readFileSync(`${APP_CSS_DIR}/${appCssFile}`, 'utf8')

let EXTRA_CSS = ''
if (CSS_FILE) EXTRA_CSS = readFileSync(CSS_FILE, 'utf8')
else if (FROM_SRC) {
  const src = readFileSync(FROM_SRC, 'utf8')
  const i = MARKER ? src.indexOf(MARKER) : 0
  if (i < 0) throw new Error(`marker not found in ${FROM_SRC}`)
  const start = Math.max(src.lastIndexOf('/*', i), 0)
  const end = src.indexOf('\n`', start)
  EXTRA_CSS = src.slice(start, end === -1 ? start + 4000 : end)
}

// Skin seeds: the `nous` skin from apps/shared/src/theme-presets.ts
// (GitHub Light/Dark Default + Nous accent; the DARK popover is #161b22).
const SKINS = process.env.KG_SKIN_JSON ? JSON.parse(process.env.KG_SKIN_JSON) : {
  light: { '--theme-foreground': '#1f2328', '--theme-background-seed': '#ffffff', '--theme-card-seed': '#f6f8fa', '--theme-elevated-seed': '#ffffff', '--theme-midground': '#0053fd' },
  dark: { '--theme-foreground': '#e6edf3', '--theme-background-seed': '#0d1117', '--theme-card-seed': '#010409', '--theme-elevated-seed': '#161b22', '--theme-midground': '#4a84fe' }
}

const MD = `<h3>Goal</h3>
<p>Ship the <strong>view</strong> with <code>--ui-*</code> tokens and a <a href="#">link</a>.</p>
<ul><li>first item</li><li>second item</li></ul>
<blockquote><p>quoted note</p></blockquote>
<pre><code>npm run build</code></pre>
<p>Body text at 11px — the sentence you actually have to read.</p>`

const html = (extra) => `<!doctype html><html><head>
<style>${APP_CSS}</style>
<style id="plugin">${extra}</style>
<style>
  html, body { margin: 0; }
  body { background: var(--ui-bg-elevated); }
  .pane { padding: 12px; }
  .container { border: 1px solid var(--ui-stroke-tertiary); border-radius: 4px; padding: 8px; background: var(--ui-bg-subtle, transparent); }
</style></head><body><div class="pane"><div class="container">
  <div class="text-[11px] prose prose-sm kg-prose max-w-none" id="prose">${MD}</div>
</div></div></body></html>`

const lum = (r, g, b) => {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
// Chromium serialises color-mix() as `color(srgb 0.99 0.99 0.99)` (0..1 floats),
// and a mix against `transparent` keeps an alpha (`color(srgb r g b / a)`) that
// must be composited — ignoring it reports a readable chip as ~1:1.
const parse = s => {
  const n = s.match(/[\d.]+/g).map(Number)
  const srgb = s.startsWith('color(srgb')
  const rgb = srgb ? n.slice(0, 3).map(v => v * 255) : n.slice(0, 3)
  const a = srgb || s.startsWith('rgba') || s.startsWith('hsla') ? (n[3] ?? 1) : 1
  return [rgb[0], rgb[1], rgb[2], a]
}
const over = (fg, bg) => {
  const a = fg[3] ?? 1
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)]
}
const contrast = (a, b) => {
  const [l1, l2] = [lum(...a), lum(...b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 460, height: 380 } })
const rows = []
for (const [theme, seeds] of Object.entries(SKINS)) {
  for (const variant of EXTRA_CSS ? ['before', 'after'] : ['base']) {
    await page.setContent(html(variant === 'after' ? EXTRA_CSS : ''))
    await page.evaluate(({ t, s }) => {
      const root = document.documentElement
      root.classList.toggle('dark', t === 'dark') // class AND seeds together
      for (const [k, v] of Object.entries(s)) root.style.setProperty(k, v)
    }, { t: theme, s: seeds })
    const r = await page.evaluate(() => {
      const g = (sel, prop = 'color') => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el)[prop] : null
      }
      return {
        text: g('#prose p'),
        body: getComputedStyle(document.body).backgroundColor,
        container: getComputedStyle(document.querySelector('.container')).backgroundColor,
        code: [g('#prose code'), g('#prose code', 'backgroundColor')],
        link: g('#prose a'),
      }
    })
    const bgStr = r.container === 'rgba(0, 0, 0, 0)' ? r.body : r.container
    const surface = parse(bgStr)
    rows.push({
      theme, variant, text: r.text, bg: bgStr, link: r.link,
      contrast: +contrast(parse(r.text), surface).toFixed(2),
      codeContrast: +contrast(parse(r.code[0]), over(parse(r.code[1]), surface)).toFixed(2),
    })
    await page.screenshot({ path: `${OUT}/${theme}-${variant}.png` })
  }
}
await browser.close()

console.log(`app stylesheet: ${appCssFile}`)
for (const r of rows) {
  const verdict = r.contrast >= 4.5 ? 'OK (AA)' : r.contrast >= 3 ? 'weak' : 'UNREADABLE'
  console.log(`${r.theme.padEnd(5)} ${r.variant.padEnd(6)} text ${r.text} on ${r.bg} -> ${r.contrast}:1 (code ${r.codeContrast}:1)  ${verdict}`)
}
writeFileSync(`${OUT}/result.json`, JSON.stringify(rows, null, 2))
console.log(`\nscreenshots + result.json in ${OUT}`)
