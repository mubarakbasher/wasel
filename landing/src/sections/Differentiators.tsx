import { Cloud, Languages, Wallet, Zap } from 'lucide-react'
import Section from '../components/Section'
import type { Strings } from '../i18n/strings'

export default function Differentiators({ t }: { t: Strings }) {
  const [main, ...rest] = t.diff.cards
  const restIcons = [Cloud, Languages, Wallet]
  return (
    <Section id="why" title={t.diff.title} intro={t.diff.intro}>
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Large bento card: the zero-port-forwarding story + terminal mock */}
        <div className="rounded-card bg-white p-7 shadow-card transition-all duration-300 ease-brand hover:-translate-y-1 hover:shadow-card-md lg:col-span-2">
          <div className="grid items-center gap-7 md:grid-cols-2">
            <div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Zap className="h-5.5 w-5.5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-xl font-bold text-ink">{main.title}</h3>
              <p className="mt-2 leading-relaxed text-ink-2">{main.body}</p>
            </div>
            <div className="rounded-xl bg-night p-4.5 font-mono text-sm leading-7 shadow-card-md">
              <div aria-hidden="true" className="mb-2.5 flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-error/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
              </div>
              <p className="text-slate-400">{t.diff.terminal[0]}</p>
              <p dir="ltr" className="text-start text-sky-300">
                {t.diff.terminal[1]}
              </p>
              <p dir="ltr" className="text-start text-emerald-300">
                {t.diff.terminal[2]}
              </p>
            </div>
          </div>
        </div>

        {rest.map((card, i) => {
          const Icon = restIcons[i]
          return (
            <div
              key={card.title}
              className={`rounded-card bg-white p-7 shadow-card transition-all duration-300 ease-brand hover:-translate-y-1 hover:shadow-card-md ${
                i === 2 ? 'lg:col-span-2' : ''
              }`}
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Icon className="h-5.5 w-5.5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-xl font-bold text-ink">{card.title}</h3>
              <p className="mt-2 leading-relaxed text-ink-2">{card.body}</p>
            </div>
          )
        })}
      </div>
    </Section>
  )
}
