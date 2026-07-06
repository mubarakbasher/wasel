import type { LucideIcon } from 'lucide-react'

interface FeatureCardProps {
  icon: LucideIcon
  title: string
  body: string
}

export default function FeatureCard({ icon: Icon, title, body }: FeatureCardProps) {
  return (
    <div className="rounded-card bg-white p-6 shadow-card transition-all duration-300 ease-brand hover:-translate-y-1 hover:shadow-card-md">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
        <Icon className="h-5.5 w-5.5" aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-lg font-bold text-ink">{title}</h3>
      <p className="mt-1.5 leading-relaxed text-ink-2">{body}</p>
    </div>
  )
}
