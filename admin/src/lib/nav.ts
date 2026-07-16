import {
  LayoutDashboard,
  Users,
  CreditCard,
  Banknote,
  Router,
  ScrollText,
  Package,
  MessageCircle,
  Mail,
  FileText,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

/**
 * Single source of truth for the sidebar navigation. Sidebar renders these in
 * order; Header derives the current page title from the same list (plus the
 * detail routes below). Add a route here and both surfaces pick it up.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Users', path: '/users', icon: Users },
  { label: 'Subscriptions', path: '/subscriptions', icon: CreditCard },
  { label: 'Plans', path: '/plans', icon: Package },
  { label: 'Payments', path: '/payments', icon: Banknote },
  { label: 'Messages', path: '/messages', icon: MessageCircle },
  { label: 'Routers', path: '/routers', icon: Router },
  { label: 'Audit Logs', path: '/audit-logs', icon: ScrollText },
  { label: 'Email Log', path: '/email-log', icon: Mail },
  { label: 'Email Templates', path: '/email-templates', icon: FileText },
  { label: 'Settings', path: '/settings', icon: Settings },
];

// Flat routes → title, derived from the nav list so labels never drift.
const STATIC_TITLES: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.path, item.label]),
);

/**
 * Resolve a page title for any route in App.tsx, including the detail routes
 * that are not present in the sidebar. Unknown paths fall back to a generic
 * title.
 */
export function pageTitleFor(pathname: string): string {
  const staticTitle = STATIC_TITLES[pathname];
  if (staticTitle) return staticTitle;

  // Detail routes (not in the sidebar nav).
  if (/^\/users\/[^/]+$/.test(pathname)) return 'User Detail';
  if (/^\/messages\/[^/]+$/.test(pathname)) return 'Conversation';

  return 'Admin Panel';
}
