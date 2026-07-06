import { useEffect, useState } from 'react'
import { strings, type Lang } from './strings'

const STORAGE_KEY = 'wasel-landing-lang'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'ar') return saved
  } catch {
    /* private mode etc. */
  }
  return 'ar' // Arabic-first default
}

export function useLang() {
  const [lang, setLang] = useState<Lang>(initialLang)

  useEffect(() => {
    const el = document.documentElement
    el.lang = lang
    el.dir = lang === 'ar' ? 'rtl' : 'ltr'
    document.title = strings[lang].meta.title
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      /* noop */
    }
  }, [lang])

  return {
    lang,
    t: strings[lang],
    toggle: () => setLang((l) => (l === 'ar' ? 'en' : 'ar')),
  }
}
