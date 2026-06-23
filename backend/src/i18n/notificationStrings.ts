/**
 * Localized notification strings for push-notification tray text.
 *
 * Rule for support_reply: title is localized; body is always params.preview
 * verbatim (admin free text — never translated).
 */

type Lang = 'en' | 'ar';

interface NotificationTemplate {
  title: Record<Lang, string>;
  body: Record<Lang, string> | null; // null = use params.preview
}

const templates: Record<string, NotificationTemplate> = {
  router_offline: {
    title: {
      en: 'Router Offline',
      ar: 'الراوتر غير متصل',
    },
    body: {
      en: '{routerName} has been offline for {minutes} minutes',
      ar: '{routerName} غير متصل منذ {minutes} دقيقة',
    },
  },
  router_online: {
    title: {
      en: 'Router Back Online',
      ar: 'عاد الراوتر للاتصال',
    },
    body: {
      en: '{routerName} is back online (was offline for {minutes} min)',
      ar: 'عاد {routerName} للاتصال (كان غير متصل لمدة {minutes} دقيقة)',
    },
  },
  subscription_expiring: {
    title: {
      en: 'Subscription Expiring Soon',
      ar: 'اشتراكك على وشك الانتهاء',
    },
    body: {
      en: 'Your subscription expires in {daysLeft} day(s). Renew now to avoid service interruption.',
      ar: 'ينتهي اشتراكك خلال {daysLeft} يوم. جدّد الآن لتجنّب انقطاع الخدمة.',
    },
  },
  subscription_expired: {
    title: {
      en: 'Subscription Expired',
      ar: 'انتهى الاشتراك',
    },
    body: {
      en: 'Your subscription has expired. Renew to continue managing your routers.',
      ar: 'انتهى اشتراكك. جدّد للمتابعة في إدارة راوتراتك.',
    },
  },
  payment_confirmed: {
    title: {
      en: 'Payment Confirmed',
      ar: 'تم تأكيد الدفع',
    },
    body: {
      en: 'Your {planName} subscription is now active. Enjoy!',
      ar: 'اشتراك {planName} الخاص بك أصبح نشطاً الآن. استمتع!',
    },
  },
  voucher_quota_low: {
    title: {
      en: 'Voucher Quota Running Low',
      ar: 'رصيد القسائم منخفض',
    },
    body: {
      en: 'You have used {percentUsed}% of your monthly voucher quota.',
      ar: 'لقد استخدمت {percentUsed}% من حصة القسائم الشهرية.',
    },
  },
  bulk_creation_complete: {
    title: {
      en: 'Bulk Vouchers Created',
      ar: 'تم إنشاء القسائم',
    },
    body: {
      en: '{count} vouchers created for {routerName}.',
      ar: 'تم إنشاء {count} قسيمة لـ {routerName}.',
    },
  },
  support_reply: {
    title: {
      en: 'Support replied',
      ar: 'ردّ الدعم',
    },
    body: null, // body = params.preview verbatim
  },
};

/**
 * Interpolates named placeholders of the form {placeholder} in a template string.
 */
function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    return Object.prototype.hasOwnProperty.call(params, key) ? params[key] : `{${key}}`;
  });
}

/**
 * Build localized push-notification title + body for a given category and language.
 *
 * Falls back to 'en' for unknown lang or unknown category.
 * For support_reply, body is params.preview verbatim (never translated).
 */
export function buildNotificationText(
  category: string,
  lang: 'en' | 'ar',
  params: Record<string, string>,
): { title: string; body: string } {
  const safeLang: Lang = lang === 'ar' ? 'ar' : 'en';

  const template = templates[category];
  if (!template) {
    // Unknown category — return empty strings so callers still function
    return { title: '', body: '' };
  }

  const title = interpolate(template.title[safeLang], params);

  let body: string;
  if (template.body === null) {
    // support_reply: body is admin free text passed as params.preview — never translated
    body = params.preview ?? '';
  } else {
    body = interpolate(template.body[safeLang], params);
  }

  return { title, body };
}
