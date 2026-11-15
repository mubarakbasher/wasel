import { describe, it, expect } from 'vitest';
import { ChartColumn } from 'lucide-react';
import { NAV_ITEMS, pageTitleFor } from '../nav';

describe('nav', () => {
  it('lists Analytics right after Dashboard', () => {
    expect(NAV_ITEMS[0]).toMatchObject({ label: 'Dashboard', path: '/dashboard' });
    expect(NAV_ITEMS[1]).toEqual({ label: 'Analytics', path: '/analytics', icon: ChartColumn });
  });

  it('titles every analytics tab "Analytics"', () => {
    expect(pageTitleFor('/analytics/network')).toBe('Analytics');
    expect(pageTitleFor('/analytics/money')).toBe('Analytics');
    expect(pageTitleFor('/analytics')).toBe('Analytics');
  });

  it('leaves the existing titles as they were', () => {
    expect(pageTitleFor('/dashboard')).toBe('Dashboard');
    expect(pageTitleFor('/payments')).toBe('Payments');
    expect(pageTitleFor('/users/42')).toBe('User Detail');
    expect(pageTitleFor('/messages/42')).toBe('Conversation');
    expect(pageTitleFor('/analytics-old')).toBe('Admin Panel');
    expect(pageTitleFor('/nowhere')).toBe('Admin Panel');
  });
});
