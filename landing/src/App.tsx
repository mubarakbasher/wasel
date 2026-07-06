import { useLang } from './i18n/useLang'
import Nav from './sections/Nav'
import Hero from './sections/Hero'
import TrustStrip from './sections/TrustStrip'
import Differentiators from './sections/Differentiators'
import HowItWorks from './sections/HowItWorks'
import Features from './sections/Features'
import PortalShowcase from './sections/PortalShowcase'
import Security from './sections/Security'
import Faq from './sections/Faq'
import FooterCta from './sections/FooterCta'

export default function App() {
  const { lang, t, toggle } = useLang()

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-bold focus:text-brand focus:shadow-card-md"
      >
        {t.a11y.skipToContent}
      </a>
      <Nav t={t} lang={lang} onToggleLang={toggle} />
      <main id="main">
        <Hero t={t} />
        <TrustStrip t={t} />
        <Differentiators t={t} />
        <HowItWorks t={t} />
        <Features t={t} />
        <PortalShowcase t={t} />
        <Security t={t} />
        <Faq t={t} />
      </main>
      <FooterCta t={t} lang={lang} />
    </>
  )
}
