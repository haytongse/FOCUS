import { useState, useEffect } from 'react';
import { DashboardStat } from '../models/SaleOrder';
import Colors from '../theme/colors';

interface RecentOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  total: number;
  status: string;
  time: string;
}

interface DashboardViewModel {
  stats: DashboardStat[];
  recentOrders: RecentOrder[];
  loading: boolean;
  refresh: () => void;
}

const fetchDashboardData = async () => {
  await new Promise<void>(resolve => setTimeout(() => resolve(), 800));
  return {
    stats: [
      { label: "Today's Sales", value: '$2,450', change: 12.5, icon: 'trending-up', color: Colors.success },
      { label: 'Orders', value: 38, change: 5.2, icon: 'receipt', color: Colors.primary },
    ] as DashboardStat[],
    recentOrders: [
      { id: '1', orderNumber: '#1042', customerName: 'John Smith', total: 85.5, status: 'paid', time: '2 min ago' },
      { id: '2', orderNumber: '#1041', customerName: 'Sarah Lee', total: 120.0, status: 'confirmed', time: '15 min ago' },
      { id: '3', orderNumber: '#1040', customerName: 'Mike Johnson', total: 45.0, status: 'paid', time: '1 hr ago' },
      { id: '4', orderNumber: '#1039', customerName: 'Emma Davis', total: 200.0, status: 'paid', time: '2 hr ago' },
      { id: '5', orderNumber: '#1038', customerName: 'Chris Brown', total: 67.5, status: 'cancelled', time: '3 hr ago' },
    ] as RecentOrder[],
  };
};

export const useDashboardViewModel = (): DashboardViewModel => {
  const [stats, setStats] = useState<DashboardStat[]>([]);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchDashboardData();
      setStats(data.stats);
      setRecentOrders(data.recentOrders);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return { stats, recentOrders, loading, refresh: load };
};
