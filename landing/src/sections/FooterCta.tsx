import { Download, MessageCircle } from 'lucide-react'
import { Monogram } from '../components/BrandMark'
import { APK_URL, WHATSAPP_URL } from '../config'
import type { Lang, Strings } from '../i18n/strings'

interface FooterCtaProps {
  t: Strings
  lang: Lang
}

export default function FooterCta({ t, lang }: FooterCtaProps) {
  const year = new Date().getFullYear()
  const links = [
    { href: '#why', label: t.nav.features },
    { href: '#how', label: t.nav.how },
    { href: '#faq', label: t.nav.faq },
  ]
  return (
    <footer>
      {/* CTA band */}
      <section aria-labelledby="cta-title" className="bg-brand">
        <div className="mx-auto max-w-6xl px-5 py-16 text-center sm:px-8 sm:py-20">
          <h2 id="cta-title" className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            {t.footer.ctaTitle}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-lg leading-relaxed text-blue-100">{t.footer.ctaBody}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3.5">
            <a
              href={APK_URL}
              className="inline-flex min-h-13 items-center gap-2.5 rounded-2xl bg-cta px-7 text-lg font-bold text-white shadow-card-md transition-all duration-300 ease-brand hover:-translate-y-0.5 hover:bg-cta-dark"
            >
              <Download className="h-5 w-5" aria-hidden="true" />
              {t.footer.ctaApk}
            </a>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-13 items-center gap-2.5 rounded-2xl border-2 border-white/60 px-7 text-lg font-bold text-white transition-colors duration-300 hover:bg-white/10"
            >
              <MessageCircle className="h-5 w-5" aria-hidden="true" />
              {t.footer.ctaWhatsApp}
            </a>
          </div>
        </div>
      </section>

      {/* footer proper */}
      <div className="bg-night">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-5 py-10 sm:px-8 md:flex-row md:justify-between">
          <p className="flex items-center gap-2.5 text-slate-300">
            <Monogram className="h-6 w-6" />
            <span className="text-sm font-semibold">{t.footer.tagline}</span>
          </p>
          <nav aria-label={lang === 'ar' ? 'روابط الصفحة' : 'Page links'} className="flex items-center gap-6">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-sm font-bold text-slate-400 transition-colors duration-200 hover:text-white"
              >
                {l.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="border-t border-white/10">
          <p className="mx-auto max-w-6xl px-5 py-5 text-center text-sm text-slate-400 sm:px-8 md:text-start">
            © <span dir="ltr">{year}</span> {t.footer.copyright}
          </p>
        </div>
      </div>
    </footer>
  )
}
