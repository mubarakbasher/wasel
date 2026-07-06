import type { Lang } from '../i18n/strings'

/**
 * Wi-Fi arc monogram (assets/logo/svg/01-wifi-monogram.svg) inlined so it
 * costs zero requests, plus the wordmark as real Cairo text — the SVG
 * wordmark (03-wordmark.svg) uses <text> and renders inconsistently.
 */
export function Monogram({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={className} aria-hidden="true" focusable="false">
      <g fill="none" stroke="#0066FF" strokeWidth="72" strokeLinecap="round">
        <path d="M 384.72 702.72 A 180 180 0 0 1 639.28 702.72" />
        <path d="M 271.60 589.60 A 340 340 0 0 1 752.40 589.60" />
        <path d="M 172.60 490.60 A 480 480 0 0 1 851.40 490.60" />
      </g>
      <circle cx="512" cy="830" r="72" fill="#FF9500" />
    </svg>
  )
}

export default function BrandMark({ lang }: { lang: Lang }) {
  return (
    <span className="flex items-center gap-2">
      <Monogram />
      <span className="text-2xl font-extrabold tracking-tight text-ink">
        {lang === 'ar' ? 'واصل' : 'wasel'}
      </span>
    </span>
  )
}
