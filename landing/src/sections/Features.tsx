import { Activity, BarChart3, Palette, Printer, Receipt, Users } from 'lucide-react'
import FeatureCard from '../components/FeatureCard'
import Section from '../components/Section'
import type { Strings } from '../i18n/strings'

const ICONS = [Printer, Users, Palette, Activity, BarChart3, Receipt]

export default function Features({ t }: { t: Strings }) {
  return (
    <Section id="features" title={t.features.title} intro={t.features.intro}>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {t.features.items.map((item, i) => (
          <FeatureCard key={item.title} icon={ICONS[i]} title={item.title} body={item.body} />
        ))}
      </div>
    </Section>
  )
}
