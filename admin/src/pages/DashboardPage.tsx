import { useQuery } from '@tanstack/react-query';
import {
  Users,
  CreditCard,
  Clock,
  DollarSign,
  Wifi,
  WifiOff,
  Ticket,
} from 'lucide-react';
import api from '../lib/api';
import StatCard from '../components/StatCard';

interface Stats {
  totalUsers: number;
  activeSubscriptions: number;
  pendingPayments: number;
  totalRevenue: number;
  routersOnline: number;
  routersOffline: number;
  totalVouchers: number;
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const { data: res } = await api.get('/admin/stats');
      return res.data as Stats;
    },
  });

  const cards = [
    { title: 'Total Users', key: 'totalUsers' as const, icon: <Users className="w-6 h-6" />, color: 'text-blue-600' },
    { title: 'Active Subscriptions', key: 'activeSubscriptions' as const, icon: <CreditCard className="w-6 h-6" />, color: 'text-green-600' },
    { title: 'Pending Payments', key: 'pendingPayments' as const, icon: <Clock className="w-6 h-6" />, color: 'text-yellow-600' },
    { title: 'Total Revenue', key: 'totalRevenue' as const, icon: <DollarSign className="w-6 h-6" />, color: 'text-emerald-600' },
    { title: 'Routers Online', key: 'routersOnline' as const, icon: <Wifi className="w-6 h-6" />, color: 'text-green-600' },
    { title: 'Routers Offline', key: 'routersOffline' as const, icon: <WifiOff className="w-6 h-6" />, color: 'text-red-600' },
    { title: 'Total Vouchers', key: 'totalVouchers' as const, icon: <Ticket className="w-6 h-6" />, color: 'text-purple-600' },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {isLoading
          ? cards.map((card) => (
              <div
                key={card.key}
                className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse"
              >
                <div className="flex items-start gap-4">
                  <div className="w-6 h-6 bg-gray-200 rounded" />
                  <div className="flex-1">
                    <div className="h-3 bg-gray-200 rounded w-20 mb-3" />
                    <div className="h-6 bg-gray-200 rounded w-12" />
                  </div>
                </div>
              </div>
            ))
          : cards.map((card) => (
              <StatCard
                key={card.key}
                title={card.title}
                value={
                  card.key === 'totalRevenue'
                    ? `$${(data?.[card.key] ?? 0).toLocaleString()}`
                    : data?.[card.key] ?? 0
                }
                icon={card.icon}
                color={card.color}
              />
            ))}
      </div>
    </div>
  );
}
