import { useLocation } from 'react-router-dom';
import { LogOut, Menu } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/users': 'Users',
  '/subscriptions': 'Subscriptions',
  '/payments': 'Payments',
  '/routers': 'Routers',
  '/audit-logs': 'Audit Logs',
};

export default function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();

  const title =
    pageTitles[pathname] ||
    (pathname.startsWith('/users/') && pathname !== '/users'
      ? 'User Details'
      : 'Admin Panel');

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between h-16 px-4 lg:px-8 bg-white border-b border-slate-200">
      <div className="flex items-center gap-2">
        <button
          onClick={onMenuClick}
          aria-label="Open menu"
          className="lg:hidden -ml-1 mr-1 p-2 text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium text-slate-700">{user?.name}</p>
          <p className="text-xs text-slate-400 hidden sm:block">{user?.role}</p>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 rounded-lg hover:bg-slate-100 hover:text-red-600 transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </header>
  );
}
