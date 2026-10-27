// Locale bundles for the Kanban Gantt plugin.
//
// One module per language: the bundles live in `src/locales/<lang>.ts` — en.ts,
// fr.ts, zh.ts — so a language can be edited on its own without touching the
// others, and a new one is added by dropping a file there and listing it below.
//
// Shipped locales (17): en, fr, zh, zh-hant (zhHant), af, ar, de, es, ga, hu,
// it, ja, ko, pt, ru, tr, uk — the ids match the Hermes desktop locale ids,
// because `ctx.i18n.register(LOCALES)` resolves the app language by that key.
import { useMemo } from 'react'
import { usePluginI18n } from '@hermes/plugin-sdk'

import { en } from './locales/en'
import { fr } from './locales/fr'
import { zh } from './locales/zh'
import { af } from './locales/af'
import { ar } from './locales/ar'
import { de } from './locales/de'
import { es } from './locales/es'
import { ga } from './locales/ga'
import { hu } from './locales/hu'
import { it } from './locales/it'
import { ja } from './locales/ja'
import { ko } from './locales/ko'
import { pt } from './locales/pt'
import { ru } from './locales/ru'
import { tr } from './locales/tr'
import { uk } from './locales/uk'
import { zhHant } from './locales/zh-hant'

const ID = 'kanban-gantt'

const GANTT_LOCALES = {
  en,
  fr,
  zh,
  'zh-hant': zhHant,
  af,
  ar,
  de,
  es,
  ga,
  hu,
  it,
  ja,
  ko,
  pt,
  ru,
  tr,
  uk,
}


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
