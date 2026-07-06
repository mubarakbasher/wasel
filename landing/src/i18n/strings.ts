export type Lang = 'ar' | 'en'

export interface Strings {
  meta: { title: string }
  a11y: { skipToContent: string; langToggle: string }
  nav: { features: string; how: string; faq: string; download: string }
  hero: {
    eyebrow: string
    headline: string
    headlineAccent: string
    subline: string
    ctaApk: string
    ctaWhatsApp: string
    mock: {
      routerName: string
      online: string
      voucherLabel: string
      soldToday: string
      soldCount: string
    }
  }
  trust: { items: [string, string, string, string] }
  diff: {
    title: string
    intro: string
    terminal: [string, string, string]
    cards: { title: string; body: string }[]
  }
  how: {
    title: string
    intro: string
    steps: { title: string; body: string }[]
  }
  features: {
    title: string
    intro: string
    items: { title: string; body: string }[]
  }
  portals: {
    title: string
    intro: string
    alts: [string, string, string]
    names: [string, string, string]
  }
  security: {
    title: string
    intro: string
    points: { title: string; body: string }[]
  }
  faq: {
    title: string
    items: { q: string; a: string }[]
  }
  footer: {
    ctaTitle: string
    ctaBody: string
    ctaApk: string
    ctaWhatsApp: string
    tagline: string
    copyright: string
  }
}

export const strings: Record<Lang, Strings> = {
  ar: {
    meta: { title: 'واصل — بِع كروت الواي فاي من موبايلك' },
    a11y: { skipToContent: 'تخطَّ إلى المحتوى', langToggle: 'Switch to English' },
    nav: { features: 'المميزات', how: 'كيف يعمل', faq: 'الأسئلة', download: 'حمّل التطبيق' },
    hero: {
      eyebrow: 'لمشغّلي هوت سبوت مايكروتيك',
      headline: 'بِع كروت الواي فاي',
      headlineAccent: 'من موبايلك',
      subline:
        'بدون سيرفر، بدون IP حقيقي، وبدون زيارات فني. راوتر مايكروتيك، تطبيق أندرويد، وكروتك محفوظة في السحابة.',
      ctaApk: 'حمّل تطبيق أندرويد',
      ctaWhatsApp: 'كلّمنا على واتساب',
      mock: {
        routerName: 'راوتر المقهى',
        online: 'متصل الآن',
        voucherLabel: 'كرت واي فاي — 5 جيجا',
        soldToday: 'مبيعات اليوم',
        soldCount: '38 كرت',
      },
    },
    trust: {
      items: [
        'قيد التشغيل مع مشغّلين حقيقيين',
        'اتصال مشفّر عبر WireGuard',
        'عربي وإنجليزي بالكامل',
        'اشتراك ثابت — لا نأخذ نسبة من مبيعاتك',
      ],
    },
    diff: {
      title: 'ليش واصل مختلف؟',
      intro: 'أربعة أشياء ما بتلقاها مع بعض في أي أداة كروت أخرى.',
      terminal: [
        '> الصق سكربت واصل في التيرمنال…',
        'wireguard tunnel: connected',
        'router status: online ✓',
      ],
      cards: [
        {
          title: 'بدون IP حقيقي وبدون بورت فورورد',
          body: 'الصق سكربت واحد في تيرمنال المايكروتيك، والراوتر يفتح نفق WireGuard آمن إلى المنصة ويظهر أونلاين في ثوانٍ — يعمل خلف CGNAT، خلف ستارلينك، ومع أي مزوّد إنترنت.',
        },
        {
          title: 'كروتك في السحابة، مش في الراوتر',
          body: 'الكروت حسابات RADIUS حقيقية: تعيش لو اتفرمت الراوتر، تشتغل على كل راوتراتك، وتوقفها فورًا بضغطة. وحلّينا مشكلة الجوالات الحديثة التي تغيّر الـ MAC وتقفل الكرت.',
        },
        {
          title: 'عربي أولًا… في كل شيء',
          body: 'التطبيق، الإشعارات، الكروت المطبوعة، وحتى صفحة دخول زبائنك — كلها بالعربي والإنجليزي، بخط واضح واتجاه صحيح.',
        },
        {
          title: 'اشتراك ثابت يناسب السوق',
          body: 'ادفع بتحويل بنكي وارفع الإيصال من التطبيق. بدون بطاقات، وبدون نسبة من مبيعاتك — أرباح كروتك لك وحدك.',
        },
      ],
    },
    how: {
      title: 'ثلاث خطوات وتبدأ البيع',
      intro: 'من التسجيل إلى أول كرت مبيوع في نفس اليوم.',
      steps: [
        { title: 'سجّل في التطبيق', body: 'أنشئ حسابك واختر باقتك من داخل التطبيق.' },
        {
          title: 'الصق سكربت واحد',
          body: 'التطبيق يولّد سكربتًا جاهزًا — الصقه في تيرمنال المايكروتيك ويظهر راوترك أونلاين.',
        },
        { title: 'اطبع وبِع', body: 'أنشئ الكروت بالجملة، اطبعها PDF، وبِعها لزبائنك.' },
      ],
    },
    features: {
      title: 'كل شغلك اليومي… في جيبك',
      intro: 'أدوات المشغّل كاملة، من إنشاء الكروت إلى متابعة الإيرادات.',
      items: [
        { title: 'كروت بالجملة وطباعة PDF', body: 'حتى 500 كرت دفعة واحدة، وأوراق طباعة جاهزة بالعربي.' },
        { title: 'جلسات حيّة وفصل فوري', body: 'شاهد المتصلين الآن وافصل أي جلسة بضغطة واحدة.' },
        { title: 'صفحات دخول مصمّمة', body: 'اختر تصميم صفحة الدخول والتطبيق يرسله إلى الراوتر مباشرة.' },
        { title: 'مراقبة صحة الراوتر', body: 'أونلاين، متدهور، أو أوفلاين — مع إشعارات ومعالجة تلقائية.' },
        { title: 'تقارير المبيعات والاستخدام', body: 'إيرادات، استهلاك بيانات، وتصدير CSV.' },
        { title: 'ادفع بتحويل بنكي', body: 'ارفع صورة الإيصال من التطبيق وتتفعّل باقتك بعد المراجعة.' },
      ],
    },
    portals: {
      title: 'صفحة دخول تليق بمكانك',
      intro: 'ثلاثة تصاميم جاهزة بالعربي والإنجليزي، تصل إلى الراوتر عبر النفق المشفّر — بدون FTP وبدون ملفات يدوية.',
      alts: [
        'تصميم «الفاتح» لصفحة دخول الهوت سبوت',
        'تصميم «الداكن» لصفحة دخول الهوت سبوت',
        'تصميم «الدافئ» لصفحة دخول الهوت سبوت',
      ],
      names: ['الفاتح', 'الداكن', 'الدافئ'],
    },
    security: {
      title: 'مبني على أمان جاد',
      intro: 'بنية مصمّمة من الأساس بحيث لا يظهر راوترك ولا بياناتك للإنترنت.',
      points: [
        { title: 'أنفاق WireGuard صادرة فقط', body: 'الراوتر هو من يتصل بالمنصة؛ لا شيء يدخل إليه من الإنترنت.' },
        { title: 'تشفير AES-256-GCM', body: 'بيانات اعتماد الراوترات وأسرار RADIUS مشفّرة دائمًا.' },
        { title: 'RADIUS غير مكشوف للإنترنت', body: 'منافذ المصادقة محصورة داخل شبكة الأنفاق الخاصة.' },
        { title: 'مراجعة أمنية مستقلة', body: 'فحص أمني عدائي، وكل الملاحظات الحرجة والعالية مُغلقة.' },
      ],
    },
    faq: {
      title: 'أسئلة يسألها كل مشغّل',
      items: [
        {
          q: 'هل أحتاج IP حقيقي أو بورت فورورد؟',
          a: 'لا. الراوتر يفتح نفقًا صادرًا إلى المنصة، فيعمل كل شيء حتى خلف CGNAT أو ستارلينك أو أي مزوّد.',
        },
        {
          q: 'ما هي الراوترات المدعومة؟',
          a: 'راوترات مايكروتيك (RouterOS) — وهي الأكثر انتشارًا في سوق الهوت سبوت.',
        },
        {
          q: 'كيف أدفع الاشتراك؟',
          a: 'تحويل بنكي: تظهر لك بيانات الحساب ورقم مرجعي في التطبيق، ترفع صورة الإيصال، ويتفعّل اشتراكك بعد المراجعة. اشتراك ثابت بدون نسبة من مبيعاتك.',
        },
        {
          q: 'ماذا يحدث لو اتفرمت الراوتر أو اتبدّل؟',
          a: 'لا شيء يضيع. كروتك محفوظة في السحابة وليست داخل الراوتر — أعد ربط الراوتر وتعود الكروت للعمل فورًا.',
        },
        {
          q: 'هل يوجد تطبيق آيفون؟',
          a: 'حاليًا التطبيق متاح لأندرويد فقط. نسخة iOS على خارطة الطريق.',
        },
        {
          q: 'هل تأخذون نسبة من مبيعات الكروت؟',
          a: 'أبدًا. اشتراكك الشهري ثابت مهما بعت — أرباح الكروت كلها لك.',
        },
      ],
    },
    footer: {
      ctaTitle: 'جاهز تبيع أول كرت؟',
      ctaBody: 'نزّل التطبيق وكلّمنا على واتساب — نساعدك تشغّل أول راوتر خطوة بخطوة.',
      ctaApk: 'حمّل تطبيق أندرويد',
      ctaWhatsApp: 'واتساب',
      tagline: 'واصل — إدارة كروت الواي فاي لراوترات مايكروتيك، من موبايلك.',
      copyright: 'واصل. جميع الحقوق محفوظة.',
    },
  },

  en: {
    meta: { title: 'Wasel — Sell Wi-Fi vouchers from your phone' },
    a11y: { skipToContent: 'Skip to content', langToggle: 'التبديل إلى العربية' },
    nav: { features: 'Features', how: 'How it works', faq: 'FAQ', download: 'Download the app' },
    hero: {
      eyebrow: 'For Mikrotik hotspot operators',
      headline: 'Sell Wi-Fi vouchers',
      headlineAccent: 'from your phone',
      subline:
        'No server, no public IP, no technician visits. A Mikrotik router, an Android app, and your vouchers safe in the cloud.',
      ctaApk: 'Download for Android',
      ctaWhatsApp: 'Chat on WhatsApp',
      mock: {
        routerName: 'Café router',
        online: 'Online now',
        voucherLabel: 'Wi-Fi voucher — 5 GB',
        soldToday: "Today's sales",
        soldCount: '38 vouchers',
      },
    },
    trust: {
      items: [
        'Running live with real operators',
        'WireGuard-encrypted connection',
        'Fully Arabic & English',
        'Flat subscription — we never take a cut of your sales',
      ],
    },
    diff: {
      title: 'Why Wasel is different',
      intro: 'Four things you won’t find together in any other voucher tool.',
      terminal: [
        '> paste the Wasel setup script…',
        'wireguard tunnel: connected',
        'router status: online ✓',
      ],
      cards: [
        {
          title: 'No public IP, no port forwarding',
          body: 'Paste one script into the Mikrotik terminal and the router opens a secure WireGuard tunnel to the platform — online in seconds, even behind CGNAT, Starlink, or any ISP.',
        },
        {
          title: 'Vouchers live in the cloud, not the router',
          body: 'Vouchers are real RADIUS accounts: they survive router resets, work across your whole fleet, and can be disabled instantly. And we fixed the modern-phone MAC-randomization lockout for good.',
        },
        {
          title: 'Arabic-first, everywhere',
          body: 'The app, notifications, printed cards, and even your customers’ login page — all in Arabic and English, with proper type and direction.',
        },
        {
          title: 'Flat pricing that fits the market',
          body: 'Pay by bank transfer and upload the receipt in-app. No cards required, and no revenue share — your voucher profits stay yours.',
        },
      ],
    },
    how: {
      title: 'Three steps to your first sale',
      intro: 'From sign-up to a sold voucher on the same day.',
      steps: [
        { title: 'Sign up in the app', body: 'Create your account and pick a plan, right inside the app.' },
        {
          title: 'Paste one script',
          body: 'The app generates a ready-made script — paste it into the Mikrotik terminal and your router comes online.',
        },
        { title: 'Print & sell', body: 'Create vouchers in bulk, print them as PDF sheets, and sell.' },
      ],
    },
    features: {
      title: 'Your daily work, in your pocket',
      intro: 'The complete operator toolkit, from voucher creation to revenue tracking.',
      items: [
        { title: 'Bulk vouchers & PDF printing', body: 'Up to 500 vouchers at once, with ready-to-print Arabic sheets.' },
        { title: 'Live sessions & instant kick', body: 'See who is connected right now and disconnect any session with one tap.' },
        { title: 'Designed login pages', body: 'Pick a captive-portal design and the app pushes it straight to your router.' },
        { title: 'Router health monitoring', body: 'Online, degraded, or offline — with notifications and automatic remediation.' },
        { title: 'Sales & usage reports', body: 'Revenue, data usage, and CSV export.' },
        { title: 'Pay by bank transfer', body: 'Upload the receipt photo in-app; your plan activates after review.' },
      ],
    },
    portals: {
      title: 'A login page that fits your place',
      intro: 'Three ready designs in Arabic and English, delivered to the router over the encrypted tunnel — no FTP, no manual files.',
      alts: [
        'The “Clean” hotspot login page design',
        'The “Dark” hotspot login page design',
        'The “Warm” hotspot login page design',
      ],
      names: ['Clean', 'Dark', 'Warm'],
    },
    security: {
      title: 'Built on serious security',
      intro: 'An architecture designed so your router and your data never face the internet.',
      points: [
        { title: 'Outbound-only WireGuard tunnels', body: 'The router calls the platform; nothing reaches into it from the internet.' },
        { title: 'AES-256-GCM encryption', body: 'Router credentials and RADIUS secrets are always encrypted at rest.' },
        { title: 'RADIUS never faces the internet', body: 'Authentication ports are confined to the private tunnel network.' },
        { title: 'Independently reviewed', body: 'Adversarial security review, with every critical and high finding closed.' },
      ],
    },
    faq: {
      title: 'Questions every operator asks',
      items: [
        {
          q: 'Do I need a public IP or port forwarding?',
          a: 'No. The router opens an outbound tunnel to the platform, so everything works even behind CGNAT, Starlink, or any ISP.',
        },
        {
          q: 'Which routers are supported?',
          a: 'Mikrotik routers (RouterOS) — the most common choice in the hotspot market.',
        },
        {
          q: 'How do I pay for the subscription?',
          a: 'Bank transfer: the app shows the account details and a reference number, you upload the receipt photo, and your subscription activates after review. Flat fee, never a share of your sales.',
        },
        {
          q: 'What if my router gets reset or replaced?',
          a: 'Nothing is lost. Your vouchers live in the cloud, not inside the router — reconnect the router and they work again immediately.',
        },
        {
          q: 'Is there an iPhone app?',
          a: 'The app is Android-only for now. An iOS version is on the roadmap.',
        },
        {
          q: 'Do you take a cut of voucher sales?',
          a: 'Never. Your monthly subscription is flat no matter how much you sell — voucher profits are all yours.',
        },
      ],
    },
    footer: {
      ctaTitle: 'Ready to sell your first voucher?',
      ctaBody: 'Download the app and message us on WhatsApp — we’ll help you bring your first router online, step by step.',
      ctaApk: 'Download for Android',
      ctaWhatsApp: 'WhatsApp',
      tagline: 'Wasel — Mikrotik Wi-Fi voucher management, from your phone.',
      copyright: 'Wasel. All rights reserved.',
    },
  },
}
