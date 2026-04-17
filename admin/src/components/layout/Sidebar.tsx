import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Banknote,
  Router,
  ScrollText,
  Wifi,
  Package,
  MessageCircle,
} from 'lucide-react';
import api from '../../lib/api';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { to: '/plans', label: 'Plans', icon: Package },
  { to: '/payments', label: 'Payments', icon: Banknote },
  { to: '/messages', label: 'Messages', icon: MessageCircle },
  { to: '/routers', label: 'Routers', icon: Router },
  { to: '/audit-logs', label: 'Audit Logs', icon: ScrollText },
];

export default function Sidebar() {
  const { data: unread } = useQuery({
    queryKey: ['admin-support-unread'],
    queryFn: async () => {
      const { data } = await api.get('/admin/support/unread-count');
      return (data?.data?.unreadCount as number) ?? 0;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-64 bg-slate-900 text-white flex flex-col z-50">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-700">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600">
          <Wifi className="w-5 h-5 text-white" />
        </div>
        <span className="text-xl font-bold tracking-tight">Wasel</span>
        <span className="text-xs font-medium text-slate-400 ml-auto">Admin</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`
            }
          >
            <Icon className="w-5 h-5 shrink-0" />
            <span className="flex-1">{label}</span>
            {to === '/messages' && unread && unread > 0 ? (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-bold">
                {unread > 99 ? '99+' : unread}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-slate-700">
        <p className="text-xs text-slate-500 text-center">Wasel Admin v1.0</p>
      </div>
    </aside>
  );
}
