import { Activity, Languages, ShieldCheck, Wallet } from 'lucide-react'
import type { Strings } from '../i18n/strings'

const ICONS = [Activity, ShieldCheck, Languages, Wallet]

export default function TrustStrip({ t }: { t: Strings }) {
  return (
    <div className="border-y border-line bg-white">
      <ul className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-5 py-5 sm:px-8">
        {t.trust.items.map((item, i) => {
          const Icon = ICONS[i]
          return (
            <li key={item} className="flex items-center gap-2 text-sm font-bold text-ink-2">
              <Icon className="h-4.5 w-4.5 shrink-0 text-brand" aria-hidden="true" />
              {item}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
