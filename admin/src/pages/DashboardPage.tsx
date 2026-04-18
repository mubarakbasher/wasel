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
import ErrorPanel from '../components/ErrorPanel';

interface Stats {
  totalUsers: number;
  subscriptionsByStatus: Record<string, number>;
  pendingPayments: number;
  totalRevenue: number;
  routersByStatus: Record<string, number>;
  totalVouchers: number;
}

export default function DashboardPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const { data: res } = await api.get('/admin/stats');
      return res.data as Stats;
    },
  });

  if (isError) {
    return (
      <ErrorPanel
        message={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  const cards = [
    { title: 'Total Users', value: data?.totalUsers ?? 0, icon: <Users className="w-6 h-6" />, color: 'text-blue-600' },
    { title: 'Active Subscriptions', value: data?.subscriptionsByStatus?.active ?? 0, icon: <CreditCard className="w-6 h-6" />, color: 'text-green-600' },
    { title: 'Pending Payments', value: data?.pendingPayments ?? 0, icon: <Clock className="w-6 h-6" />, color: 'text-yellow-600' },
    { title: 'Total Revenue', value: `$${(data?.totalRevenue ?? 0).toLocaleString()}`, icon: <DollarSign className="w-6 h-6" />, color: 'text-emerald-600' },
    { title: 'Routers Online', value: data?.routersByStatus?.online ?? 0, icon: <Wifi className="w-6 h-6" />, color: 'text-green-600' },
    { title: 'Routers Offline', value: data?.routersByStatus?.offline ?? 0, icon: <WifiOff className="w-6 h-6" />, color: 'text-red-600' },
    { title: 'Total Vouchers', value: data?.totalVouchers ?? 0, icon: <Ticket className="w-6 h-6" />, color: 'text-purple-600' },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {isLoading
          ? cards.map((_, i) => (
              <div
                key={i}
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
                key={card.title}
                title={card.title}
                value={card.value}
                icon={card.icon}
                color={card.color}
              />
            ))}
      </div>
    </div>
  );
}
