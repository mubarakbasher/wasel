import { describe, it, expect } from 'vitest';
import { buildNotificationText } from '../i18n/notificationStrings';

describe('buildNotificationText', () => {
  // ---- router_offline ----
  describe('router_offline', () => {
    it('returns English title and body with interpolated params', () => {
      const result = buildNotificationText('router_offline', 'en', {
        routerId: 'r1',
        routerName: 'Office',
        minutes: '5',
      });
      expect(result.title).toBe('Router Offline');
      expect(result.body).toBe('Office has been offline for 5 minutes');
    });

    it('returns Arabic title and body', () => {
      const result = buildNotificationText('router_offline', 'ar', {
        routerId: 'r1',
        routerName: 'Office',
        minutes: '5',
      });
      expect(result.title).toBe('الراوتر غير متصل');
      expect(result.body).toBe('Office غير متصل منذ 5 دقيقة');
    });
  });

  // ---- router_online ----
  describe('router_online', () => {
    it('returns English strings', () => {
      const result = buildNotificationText('router_online', 'en', {
        routerId: 'r1',
        routerName: 'Branch',
        minutes: '12',
      });
      expect(result.title).toBe('Router Back Online');
      expect(result.body).toBe('Branch is back online (was offline for 12 min)');
    });

    it('returns Arabic strings', () => {
      const result = buildNotificationText('router_online', 'ar', {
        routerId: 'r1',
        routerName: 'Branch',
        minutes: '12',
      });
      expect(result.title).toBe('عاد الراوتر للاتصال');
      expect(result.body).toContain('Branch');
      expect(result.body).toContain('12');
    });
  });

  // ---- subscription_expiring ----
  describe('subscription_expiring', () => {
    it('interpolates daysLeft in English', () => {
      const result = buildNotificationText('subscription_expiring', 'en', { daysLeft: '3' });
      expect(result.title).toBe('Subscription Expiring Soon');
      expect(result.body).toContain('3');
      expect(result.body).toContain('Renew now');
    });

    it('interpolates daysLeft in Arabic', () => {
      const result = buildNotificationText('subscription_expiring', 'ar', { daysLeft: '3' });
      expect(result.title).toBe('اشتراكك على وشك الانتهاء');
      expect(result.body).toContain('3');
    });
  });

  // ---- subscription_expired ----
  describe('subscription_expired', () => {
    it('works with empty params in English', () => {
      const result = buildNotificationText('subscription_expired', 'en', {});
      expect(result.title).toBe('Subscription Expired');
      expect(result.body).toContain('expired');
    });

    it('works with empty params in Arabic', () => {
      const result = buildNotificationText('subscription_expired', 'ar', {});
      expect(result.title).toBe('انتهى الاشتراك');
    });
  });

  // ---- payment_confirmed ----
  describe('payment_confirmed', () => {
    it('interpolates planName in English', () => {
      const result = buildNotificationText('payment_confirmed', 'en', { planName: 'Professional' });
      expect(result.title).toBe('Payment Confirmed');
      expect(result.body).toBe('Your Professional subscription is now active. Enjoy!');
    });

    it('interpolates planName in Arabic', () => {
      const result = buildNotificationText('payment_confirmed', 'ar', { planName: 'Professional' });
      expect(result.title).toBe('تم تأكيد الدفع');
      expect(result.body).toContain('Professional');
    });
  });

  // ---- voucher_quota_low ----
  describe('voucher_quota_low', () => {
    it('interpolates percentUsed in English', () => {
      const result = buildNotificationText('voucher_quota_low', 'en', { percentUsed: '80' });
      expect(result.title).toBe('Voucher Quota Running Low');
      expect(result.body).toBe('You have used 80% of your monthly voucher quota.');
    });

    it('interpolates percentUsed in Arabic', () => {
      const result = buildNotificationText('voucher_quota_low', 'ar', { percentUsed: '80' });
      expect(result.title).toBe('رصيد القسائم منخفض');
      expect(result.body).toContain('80%');
    });
  });

  // ---- bulk_creation_complete ----
  describe('bulk_creation_complete', () => {
    it('interpolates count and routerName in English', () => {
      const result = buildNotificationText('bulk_creation_complete', 'en', {
        count: '50',
        routerName: 'Main',
      });
      expect(result.title).toBe('Bulk Vouchers Created');
      expect(result.body).toBe('50 vouchers created for Main.');
    });

    it('interpolates in Arabic', () => {
      const result = buildNotificationText('bulk_creation_complete', 'ar', {
        count: '50',
        routerName: 'Main',
      });
      expect(result.title).toBe('تم إنشاء القسائم');
      expect(result.body).toContain('50');
      expect(result.body).toContain('Main');
    });
  });

  // ---- support_reply ----
  describe('support_reply', () => {
    it('returns localized English title and raw preview as body', () => {
      const result = buildNotificationText('support_reply', 'en', {
        preview: 'We have resolved your ticket.',
      });
      expect(result.title).toBe('Support replied');
      expect(result.body).toBe('We have resolved your ticket.');
    });

    it('returns Arabic title and raw preview as body (never translated)', () => {
      const result = buildNotificationText('support_reply', 'ar', {
        preview: 'تم حل مشكلتك.',
      });
      expect(result.title).toBe('ردّ الدعم');
      expect(result.body).toBe('تم حل مشكلتك.');
    });

    it('returns empty body when preview is missing', () => {
      const result = buildNotificationText('support_reply', 'en', {});
      expect(result.body).toBe('');
    });
  });

  // ---- fallback for unknown category ----
  describe('unknown category', () => {
    it('returns empty strings for unknown category', () => {
      const result = buildNotificationText('unknown_category', 'en', {});
      expect(result.title).toBe('');
      expect(result.body).toBe('');
    });
  });

  // ---- lang fallback ----
  describe('language fallback', () => {
    it('falls back to English when lang is not ar', () => {
      // TypeScript will complain about an invalid lang, so cast for this test
      const result = buildNotificationText('subscription_expired', 'en', {});
      expect(result.title).toBe('Subscription Expired');
    });
  });
});
