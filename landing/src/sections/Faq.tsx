import { ChevronDown } from 'lucide-react'
import Section from '../components/Section'
import type { Strings } from '../i18n/strings'

export default function Faq({ t }: { t: Strings }) {
  return (
    <Section id="faq" title={t.faq.title} className="bg-white">
      <div className="max-w-3xl space-y-3.5">
        {t.faq.items.map((item) => (
          <details
            key={item.q}
            className="group rounded-card border border-line bg-bg px-6 py-4.5 transition-colors duration-200 open:bg-white open:shadow-card"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-bold text-ink [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown
                className="h-5 w-5 shrink-0 text-ink-2 transition-transform duration-200 group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <p className="mt-3 leading-relaxed text-ink-2">{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
  )
}
