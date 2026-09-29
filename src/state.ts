// Shared plugin state: atoms, backend doors (rest/storage) and API helpers.
// The doors are wired once at register() time via setPluginDoors().

import { atom } from '@hermes/plugin-sdk'

export const LABEL_W = 300 // px — default width of the sticky label column
/* ──────────────────────────────── data doors ──────────────────────────────── */

let rest = null
let storage = null

/** Optional custom backend base URL ('' = the plugin's own namespace). */
export const $baseUrl = atom('')
/** Slug of the selected kanban board ('' until chosen). */
export const $boardSlug = atom('')
/** Width (px) of the sticky task-name column — resizable via its drag handle. */
export const $labelW = atom(LABEL_W)
/** Width (px) of the task drawer — resizable via its left-edge handle. */
export const $drawerW = atom(416)
/** Whether the task drawer docks beside the gantt instead of overlaying it. */
export const $drawerDocked = atom(false)
export const LABEL_W_MIN = 160
export const LABEL_W_MAX = 640
export const DRAWER_W_MIN = 320
export const DRAWER_W_MAX = 720
/** Open task id in the drawer (null = closed). */
export const $openTaskId = atom(null)

/** "New task" dialog: null = closed, { parentId } = open (prefilled parent). */
export const $newTask = atom(null)

const apiBase = () => ($baseUrl.get() || '').trim().replace(/\/+$/, '')

/** GET/POST/PATCH through the plugin namespace, or an absolute custom base. */
const apiFetch = (path, init) => {
  const base = apiBase()
  if (base) {
    return fetch(`${base}${path}`, {
      method: init?.method || 'GET',
      headers: init?.body != null ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body != null ? JSON.stringify(init.body) : undefined
    }).then(r => {
      if (!r.ok) throw new Error(`${init?.method || 'GET'} ${path} → HTTP ${r.status}`)
      return r.json()
    })
  }
  if (!rest) return Promise.reject(new Error('backend not ready'))
  return rest(path, init?.body != null
    ? { method: init.method, body: init.body }
    : undefined)
}

const fetchBoards = () => apiFetch('/boards')
const fetchGantt = board =>
  apiFetch(`/gantt${board ? `?board=${encodeURIComponent(board)}` : ''}`)
const fetchTask = (id, board) =>
  apiFetch(`/tasks/${encodeURIComponent(id)}${board ? `?board=${encodeURIComponent(board)}` : ''}`)

/** Create a task on the current board (the domain derives its status). */
const createTask = (values, board) =>
  apiFetch(
    `/tasks${board ? `?board=${encodeURIComponent(board)}` : ''}`,
    { method: 'POST', body: values })

export function setPluginDoors(restFn, storageObj) {
  rest = restFn
  storage = storageObj
}
export const getStorage = () => storage

export {
  apiBase, apiFetch, fetchBoards, fetchGantt, fetchTask, createTask, applyBase
}
