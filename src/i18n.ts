// Locale bundles for the Kanban Gantt plugin.
//
// One module per language: the bundles live in `src/locales/<lang>.ts` — en.ts,
// fr.ts, zh.ts — so a language can be edited on its own without touching the
// others, and a new one is added by dropping a file there and listing it below.
import { useMemo } from 'react'
import { usePluginI18n } from '@hermes/plugin-sdk'

import { en } from './locales/en'
import { fr } from './locales/fr'
import { zh } from './locales/zh'

const ID = 'kanban-gantt'

const GANTT_LOCALES = { en, fr, zh }


function bindI18n(t, template, prefix = '') {
  const out = {}
  for (const [key, value] of Object.entries(template)) {
    const path = prefix ? `${prefix}.${key}` : key
    out[key] =
      typeof value === 'function'
        ? (...args) => t(path, ...args)
        : value && typeof value === 'object'
          ? bindI18n(t, value, path)
          : t(path)
  }
  return out
}

function useGanttI18n() {
  const t = usePluginI18n(ID)
  return useMemo(() => bindI18n(t, GANTT_LOCALES.en), [t])
}

export { GANTT_LOCALES, useGanttI18n }
