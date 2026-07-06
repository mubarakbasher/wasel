import { Download, MessageCircle, ShieldCheck, Wifi } from 'lucide-react'
import { Monogram } from '../components/BrandMark'
import { APK_URL, WHATSAPP_URL } from '../config'
import type { Strings } from '../i18n/strings'

/** Oversized decorative brand arcs (aria-hidden, pure ornament). */
function ArcMotif({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={className} aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="40" strokeLinecap="round">
        <path d="M 384.72 702.72 A 180 180 0 0 1 639.28 702.72" />
        <path d="M 271.60 589.60 A 340 340 0 0 1 752.40 589.60" />
        <path d="M 172.60 490.60 A 480 480 0 0 1 851.40 490.60" />
      </g>
    </svg>
  )
}

export default function Hero({ t }: { t: Strings }) {
  return (
    <div id="top" className="dot-grid relative overflow-hidden">
      {/* soft brand blobs */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 end-[-10%] h-96 w-96 rounded-full bg-brand-light opacity-60 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-20%] start-[-8%] h-80 w-80 rounded-full bg-brand-light opacity-40 blur-3xl"
      />

      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[1.1fr_0.9fr] lg:py-28">
        {/* Copy */}
        <div>
          <p className="animate-rise inline-flex items-center gap-2 rounded-full bg-brand-light px-4 py-1.5 text-sm font-bold text-brand-dark">
            <Wifi className="h-4 w-4" aria-hidden="true" />
            {t.hero.eyebrow}
          </p>
          <h1 className="animate-rise mt-5 text-4xl font-extrabold leading-[1.3] tracking-tight text-ink [animation-delay:90ms] sm:text-5xl lg:text-[3.4rem]">
            {t.hero.headline} <span className="inline-block text-brand">{t.hero.headlineAccent}</span>
          </h1>
          <p className="animate-rise mt-5 max-w-xl text-lg leading-relaxed text-ink-2 [animation-delay:180ms] sm:text-xl">
            {t.hero.subline}
          </p>
          <div className="animate-rise mt-8 flex flex-wrap items-center gap-3.5 [animation-delay:270ms]">
            <a
              href={APK_URL}
              className="inline-flex min-h-13 items-center gap-2.5 rounded-2xl bg-cta px-7 text-lg font-bold text-white shadow-card-md transition-all duration-300 ease-brand hover:-translate-y-0.5 hover:bg-cta-dark hover:shadow-card-lg"
            >
              <Download className="h-5 w-5" aria-hidden="true" />
              {t.hero.ctaApk}
            </a>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-13 items-center gap-2.5 rounded-2xl border border-line bg-white px-7 text-lg font-bold text-ink transition-all duration-300 ease-brand hover:-translate-y-0.5 hover:border-brand hover:text-brand"
            >
              <MessageCircle className="h-5 w-5" aria-hidden="true" />
              {t.hero.ctaWhatsApp}
            </a>
          </div>
        </div>

        {/* CSS-built app-card mock */}
        <div className="relative mx-auto w-full max-w-sm lg:max-w-none">
          <ArcMotif className="pointer-events-none absolute -top-24 start-1/2 w-[26rem] -translate-x-1/2 text-brand/10 rtl:translate-x-1/2" />
          <div className="animate-float relative">
            <div className="animate-rise relative z-10 mx-auto w-full max-w-xs rounded-card bg-white p-5 shadow-card-lg [animation-delay:200ms] sm:max-w-sm">
              {/* header: router + status */}
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5">
                  <Monogram className="h-7 w-7" />
                  <span className="font-bold text-ink">{t.hero.mock.routerName}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success-light px-3 py-1 text-xs font-bold text-success-dark">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
                  {t.hero.mock.online}
                </span>
              </div>
              {/* voucher row */}
              <div className="mt-4 rounded-xl bg-surface-muted p-3.5">
                <p className="text-xs font-semibold text-ink-2">{t.hero.mock.voucherLabel}</p>
                <p dir="ltr" className="mt-1 text-start font-mono text-xl font-bold tracking-[0.18em] text-ink">
                  WS-4K7F92
                </p>
              </div>
              {/* sales stat + mini bars */}
              <div className="mt-4 flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-ink-2">{t.hero.mock.soldToday}</p>
                  <p className="text-2xl font-extrabold text-brand-dark">{t.hero.mock.soldCount}</p>
                </div>
                <div aria-hidden="true" className="flex items-end gap-1.5 pb-1">
                  {[10, 16, 12, 22, 18, 28].map((h, i) => (
                    <span
                      key={i}
                      style={{ height: `${h * 2}px` }}
                      className={`w-2.5 rounded-full ${i === 5 ? 'bg-brand' : 'bg-brand/20'}`}
                    />
                  ))}
                </div>
              </div>
              {/* floating tunnel chip — anchored to the card, hangs off its bottom end corner */}
              <div className="animate-rise absolute -bottom-6 end-[-0.75rem] z-20 flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 shadow-card-md [animation-delay:420ms]">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-success-light text-success-dark">
                  <ShieldCheck className="h-4.5 w-4.5" aria-hidden="true" />
                </span>
                <span dir="ltr" className="font-mono text-sm font-semibold text-ink">
                  WireGuard ✓
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
