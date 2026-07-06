import { Download } from 'lucide-react'
import BrandMark from '../components/BrandMark'
import LangToggle from '../components/LangToggle'
import { APK_URL } from '../config'
import type { Lang, Strings } from '../i18n/strings'

interface NavProps {
  t: Strings
  lang: Lang
  onToggleLang: () => void
}

export default function Nav({ t, lang, onToggleLang }: NavProps) {
  const links = [
    { href: '#why', label: t.nav.features },
    { href: '#how', label: t.nav.how },
    { href: '#faq', label: t.nav.faq },
  ]
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
        <a href="#top" className="rounded-lg" aria-label={lang === 'ar' ? 'واصل — الصفحة الرئيسية' : 'Wasel — home'}>
          <BrandMark lang={lang} />
        </a>
        <div className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-bold text-ink-2 transition-colors duration-200 hover:text-brand"
            >
              {l.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2.5">
          <LangToggle lang={lang} label={t.a11y.langToggle} onToggle={onToggleLang} />
          <a
            href={APK_URL}
            className="hidden min-h-11 items-center gap-2 rounded-full bg-cta px-5 text-sm font-bold text-white shadow-card transition-colors duration-200 hover:bg-cta-dark sm:inline-flex"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {t.nav.download}
          </a>
        </div>
      </nav>
    </header>
  )
}
