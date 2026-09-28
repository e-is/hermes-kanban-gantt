#!/usr/bin/env node
/**
 * kanban-gantt demo server — ONE port (default 4200) serving everything:
 *
 *   http://<host>:4200/demo.html      the Gantt demo page
 *   http://<host>:4200/plugin.js      the shipped plugin (page extracts its core)
 *   http://<host>:4200/api/*          PROXIED to the standalone backend
 *                                     (dashboard/plugin_api.py, auto-spawned)
 *
 * This IS the plugin's real backend code running (uvicorn + plugin_api.py),
 * with only env config on top (KANBAN_GANTT_BOARDS / HERMES_KANBAN_HOME to
 * pick the boards root, HERMES_KANBAN_BOARD for the default board). One port
 * for everything -> works from outside a container without CORS setup.
 *
 * Usage: node tests/demo-server.mjs [--port 4200] [--api-port 8765]
 *        env: KG_BOARDS=/path/to/kanban/boards  KG_BOARD=<default slug>
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadEnv } from './env.mjs'
// .env (machine-local, gitignored — see .env.example) before any env use.
await loadEnv()

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..', 'desktop')
const DASHBOARD = join(HERE, '..', 'dashboard')
const PY = process.env.KG_PYTHON || '/opt/hermes/.venv/bin/python'

const args = process.argv.slice(2)
const argVal = name => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const PORT = Number(argVal('--port') || process.env.KG_PORT || 4200)
const API_PORT = Number(argVal('--api-port') || process.env.KG_API_PORT || 8765)

// playwright (npm -g) resolution for the CLI fallback is not needed here.

function freePort(pref) {
  return new Promise(resolve => {
    const srv = createServer()
    srv.listen(pref, '127.0.0.1', () => {
      const p = srv.address().port
      srv.close(() => resolve(p))
    })
    srv.on('error', () => resolve(freePort(0)))
  })
}

// ── auto-spawn the standalone backend (the plugin's real backend code) ──────
const backend = spawn(PY, [
  DASHBOARD + '/plugin_api.py',
  '--host', '127.0.0.1', '--port', String(API_PORT)
], { env: process.env, stdio: 'inherit' })
process.on('exit', () => backend.kill())

// wait for readiness
const deadline = Date.now() + 20_000
while (Date.now() < deadline) {
  try {
    const r = await fetch(`http://127.0.0.1:${API_PORT}/meta`)
    if (r.ok) break
  } catch { /* warming up */ }
  await new Promise(r => setTimeout(r, 300))
}

const httpd = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  try {
    if (url.pathname.startsWith('/api/')) {
      // strip the /api prefix: the backend serves /boards, /gantt, /tasks/*
      const upstreamPath = url.pathname.replace(/^\/api/, '') || '/'
      const init = { method: req.method, headers: {} }
      if (req.method === 'PATCH' || req.method === 'POST') {
        const chunks = []
        for await (const c of req) chunks.push(c)
        init.body = Buffer.concat(chunks)
        init.headers['Content-Type'] = req.headers['content-type'] || 'application/json'
      }
      const upstream = await fetch(`http://127.0.0.1:${API_PORT}${upstreamPath}${url.search}`, init)
      const body = Buffer.from(await upstream.arrayBuffer())
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Access-Control-Allow-Origin': '*'
      })
      res.end(body)
      return
    }
    // static: demo.html from tests/, plugin.js from the plugin root
    const raw = url.pathname.slice(1) || 'demo.html'
    const name = raw === 'plugin.js' ? join(PLUGIN, 'plugin.js') : raw === 'gantt-core.js' ? join(PLUGIN, 'gantt-core.js') : join(HERE, raw)
    const body = await readFile(name)
    res.writeHead(200, {
      'Content-Type': name.endsWith('.html') ? 'text/html' : 'text/javascript',
      'Cache-Control': 'no-store'
    })
    res.end(body)
  } catch (e) {
    res.writeHead(e?.code === 'ENOENT' ? 404 : 502)
    res.end(String(e))
  }
})

httpd.listen(PORT, '0.0.0.0', () => {
  console.log(`kanban-gantt demo : http://0.0.0.0:${PORT}/demo.html`)
  console.log(`  backend (plugin_api.py) proxied at /api -> 127.0.0.1:${API_PORT}`)
})