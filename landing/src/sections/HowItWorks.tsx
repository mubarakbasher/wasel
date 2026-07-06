import Section from '../components/Section'
import type { Strings } from '../i18n/strings'

export default function HowItWorks({ t }: { t: Strings }) {
  return (
    <Section id="how" title={t.how.title} intro={t.how.intro} className="bg-white">
      <ol className="relative grid gap-10 md:grid-cols-3 md:gap-8">
        {/* dashed connector (decorative) */}
        <div
          aria-hidden="true"
          className="absolute top-7 hidden h-0 w-full border-t-2 border-dashed border-line md:block"
        />
        {t.how.steps.map((step, i) => (
          <li key={step.title} className="relative">
            <span className="relative z-10 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-2xl font-extrabold text-white shadow-card-md">
              {i + 1}
            </span>
            <h3 className="mt-4 text-xl font-bold text-ink">{step.title}</h3>
            <p className="mt-1.5 max-w-xs leading-relaxed text-ink-2">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  )
}
