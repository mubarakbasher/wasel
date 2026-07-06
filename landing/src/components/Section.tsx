import type { ReactNode } from 'react'

interface SectionProps {
  id: string
  title: string
  intro?: string
  children: ReactNode
  className?: string
  dark?: boolean
}

export default function Section({ id, title, intro, children, className = '', dark = false }: SectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`py-20 sm:py-24 ${className}`}>
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <h2
          id={`${id}-title`}
          className={`text-3xl sm:text-4xl font-extrabold tracking-tight ${dark ? 'text-white' : 'text-ink'}`}
        >
          {title}
        </h2>
        {intro && (
          <p className={`mt-3 max-w-2xl text-lg leading-relaxed ${dark ? 'text-slate-300' : 'text-ink-2'}`}>
            {intro}
          </p>
        )}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  )
}
