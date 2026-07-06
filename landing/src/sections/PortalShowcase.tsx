import Section from '../components/Section'
import type { Strings } from '../i18n/strings'

const IMAGES = ['/previews/portal-clean.png', '/previews/portal-dark.png', '/previews/portal-warm.png']

export default function PortalShowcase({ t }: { t: Strings }) {
  return (
    <Section id="portals" title={t.portals.title} intro={t.portals.intro} className="bg-white">
      <div className="grid gap-8 sm:grid-cols-3">
        {IMAGES.map((src, i) => (
          <figure key={src} className={i === 1 ? 'sm:-translate-y-3' : ''}>
            <img
              src={src}
              alt={t.portals.alts[i]}
              width={500}
              height={920}
              loading="lazy"
              decoding="async"
              className="w-full rounded-2xl border border-line shadow-card transition-all duration-300 ease-brand hover:-translate-y-1 hover:shadow-card-lg"
            />
            <figcaption className="mt-3 text-center text-sm font-bold text-ink-2">
              {t.portals.names[i]}
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  )
}
