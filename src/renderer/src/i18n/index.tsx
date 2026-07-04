/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { en, type MessageKey } from './en'
import { zh } from './zh'

export type Lang = 'en' | 'zh'
export type MessageParams = Record<string, string | number>

const dictionaries = { en, zh } as const

export function localeFor(lang: Lang): 'en-US' | 'zh-CN' {
  return lang === 'zh' ? 'zh-CN' : 'en-US'
}

export function translate(lang: Lang, key: MessageKey, params?: MessageParams): string {
  const template = dictionaries[lang][key] ?? en[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value == null ? match : String(value)
  })
}

export function tFor(lang: Lang): (key: MessageKey, params?: MessageParams) => string {
  return (key, params) => translate(lang, key, params)
}

interface I18nContextValue {
  lang: Lang
  locale: 'en-US' | 'zh-CN'
  t: (key: MessageKey, params?: MessageParams) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({
  lang,
  children
}: {
  lang: Lang
  children: ReactNode
}): React.JSX.Element {
  const value = useMemo<I18nContextValue>(
    () => ({ lang, locale: localeFor(lang), t: tFor(lang) }),
    [lang]
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}

export type { MessageKey }
