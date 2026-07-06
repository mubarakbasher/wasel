import { BadgeCheck, EyeOff, Lock, ShieldCheck } from 'lucide-react'
import Section from '../components/Section'
import type { Strings } from '../i18n/strings'

const ICONS = [ShieldCheck, Lock, EyeOff, BadgeCheck]

export default function Security({ t }: { t: Strings }) {
  return (
    <div className="relative overflow-hidden bg-night">
      {/* decorative brand arcs glowing out of the corner */}
      <svg
        viewBox="0 0 1024 1024"
        aria-hidden="true"
        focusable="false"
        className="pointer-events-none absolute -top-40 end-[-8rem] w-[34rem] text-sky-400/10"
      >
        <g fill="none" stroke="currentColor" strokeWidth="40" strokeLinecap="round">
          <path d="M 384.72 702.72 A 180 180 0 0 1 639.28 702.72" />
          <path d="M 271.60 589.60 A 340 340 0 0 1 752.40 589.60" />
          <path d="M 172.60 490.60 A 480 480 0 0 1 851.40 490.60" />
        </g>
      </svg>
      <Section id="security" title={t.security.title} intro={t.security.intro} dark>
        <dl className="grid gap-x-8 gap-y-9 sm:grid-cols-2">
          {t.security.points.map((point, i) => {
            const Icon = ICONS[i]
            return (
              <div key={point.title} className="flex gap-4">
                <dt className="sr-only">{point.title}</dt>
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-sky-300">
                  <Icon className="h-5.5 w-5.5" aria-hidden="true" />
                </span>
                <dd>
                  <p className="text-lg font-bold text-white">{point.title}</p>
                  <p className="mt-1 leading-relaxed text-slate-300">{point.body}</p>
                </dd>
              </div>
            )
          })}
        </dl>
      </Section>
    </div>
  )
}
