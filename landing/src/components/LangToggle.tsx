import type { Lang } from '../i18n/strings'

interface LangToggleProps {
  lang: Lang
  label: string
  onToggle: () => void
}

export default function LangToggle({ lang, label, onToggle }: LangToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      className="min-h-11 cursor-pointer rounded-full border border-line bg-white px-4 text-sm font-bold text-ink-2 transition-colors duration-200 hover:border-brand hover:text-brand"
    >
      {lang === 'ar' ? 'EN' : 'عربي'}
    </button>
  )
}
