import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../i18n/app_localizations.dart';
import '../providers/dashboard_provider.dart';
import '../providers/notifications_provider.dart';
import '../theme/theme.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(dashboardProvider.notifier).loadDashboard();
      ref.read(notificationsProvider.notifier).refresh();
    });
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'online':
        return AppColors.online;
      case 'offline':
        return AppColors.offline;
      case 'degraded':
        return AppColors.degraded;
      default:
        return AppColors.textTertiary;
    }
  }

  String _relativeTime(BuildContext context, String? isoDate) {
    if (isoDate == null || isoDate.isEmpty) return 'N/A';
    try {
      final date = DateTime.parse(isoDate);
      final now = DateTime.now();
      final diff = now.difference(date);
      if (diff.inSeconds < 60) return context.tr('routers.justNow');
      if (diff.inMinutes < 60) return context.tr('routers.minutesAgo', [diff.inMinutes.toString()]);
      if (diff.inHours < 24) return context.tr('routers.hoursAgo', [diff.inHours.toString()]);
      return context.tr('routers.daysAgo', [diff.inDays.toString()]);
    } catch (_) {
      return 'N/A';
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(dashboardProvider);

    final unreadCount = ref.watch(notificationsProvider).unreadCount;

    return Scaffold(
      appBar: AppBar(
        title: Text(context.tr('dashboard.title')),
        automaticallyImplyLeading: false,
        actions: [
          _NotificationBell(
            unreadCount: unreadCount,
            onTap: () => context.push('/notifications'),
          ),
          const SizedBox(width: AppSpacing.sm),
        ],
      ),
      body: _buildBody(state),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _onQuickCreate(state),
        icon: const Icon(Icons.add),
        label: Text(context.tr('dashboard.quickCreateVoucher')),
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.textInverse,
      ),
    );
  }

  void _onQuickCreate(DashboardState state) {
    final routers = state.routers;
    if (routers.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.tr('dashboard.addRouterFirst'))),
      );
      return;
    }
    final firstRouterId = routers[0]['id'] as String;
    context.push('/vouchers/create', extra: firstRouterId);
  }

  Widget _buildBody(DashboardState state) {
    if (state.isLoading && state.data == null) {
      return _buildLoadingSkeleton();
    }

    if (state.error != null && state.data == null) {
      return _buildErrorState(state.error!);
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(dashboardProvider.notifier).loadDashboard(),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSubscriptionCard(state),
            const SizedBox(height: AppSpacing.lg),
            _buildQuickStatsRow(state),
            const SizedBox(height: AppSpacing.md),
            _buildSecondStatsRow(state),
            const SizedBox(height: AppSpacing.lg),
            _buildDataUsageCard(state),
            const SizedBox(height: AppSpacing.lg),
            _buildRoutersCard(state),
            const SizedBox(height: AppSpacing.lg),
            _buildSessionsByRouterCard(state),
            const SizedBox(height: 80), // Space for FAB
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Subscription Status Card
  // ---------------------------------------------------------------------------
  Widget _buildSubscriptionCard(DashboardState state) {
    final sub = state.subscription;
    if (sub == null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            children: [
              const Icon(Icons.credit_card_off,
                  size: 40, color: AppColors.textTertiary),
              const SizedBox(height: AppSpacing.sm),
              Text(context.tr('dashboard.noActiveSubscription'),
                  style: const TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w600)),
              const SizedBox(height: AppSpacing.sm),
              FilledButton(
                onPressed: () => context.push('/subscription/plans'),
                child: Text(context.tr('dashboard.viewPlans')),
              ),
            ],
          ),
        ),
      );
    }

    final planName = sub['planName'] as String? ?? 'Unknown';
    final status = (sub['status'] as String?) ?? 'unknown';
    final vouchersUsed = sub['vouchersUsed'] as int? ?? 0;
    final voucherQuota = sub['voucherQuota'] as int? ?? 1;
    final daysRemaining = sub['daysRemaining'] as int? ?? 0;
    final isUnlimited = voucherQuota == -1;
    final progress = isUnlimited ? 0.0 : vouchersUsed / voucherQuota;

    Color statusBadgeColor;
    switch (status.toLowerCase()) {
      case 'active':
        statusBadgeColor = AppColors.success;
        break;
      case 'expiring':
        statusBadgeColor = AppColors.warning;
        break;
      default:
        statusBadgeColor = AppColors.error;
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(planName,
                    style: const TextStyle(
                        fontSize: 18, fontWeight: FontWeight.bold)),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm, vertical: AppSpacing.xs),
                  decoration: BoxDecoration(
                    color: statusBadgeColor.withValues(alpha: 0.15),
                    borderRadius:
                        BorderRadius.circular(AppSpacing.radiusSm),
                  ),
                  child: Text(
                    status[0].toUpperCase() + status.substring(1),
                    style: TextStyle(
                        color: statusBadgeColor,
                        fontSize: 12,
                        fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            // Voucher usage
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(context.tr('dashboard.vouchersUsed'),
                    style: const TextStyle(color: AppColors.textSecondary)),
                Text(
                  isUnlimited
                      ? '$vouchersUsed / ${context.tr('dashboard.unlimited')}'
                      : '$vouchersUsed / $voucherQuota',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            if (!isUnlimited)
              ClipRRect(
                borderRadius:
                    BorderRadius.circular(AppSpacing.radiusSm),
                child: LinearProgressIndicator(
                  value: progress.clamp(0.0, 1.0),
                  minHeight: 8,
                  backgroundColor: AppColors.border,
                  valueColor: AlwaysStoppedAnimation<Color>(
                    progress >= 0.9
                        ? AppColors.error
                        : progress >= 0.7
                            ? AppColors.warning
                            : AppColors.success,
                  ),
                ),
              ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              context.tr('dashboard.daysRemaining', [daysRemaining.toString()]),
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Quick Stats Row
  // ---------------------------------------------------------------------------
  Widget _buildQuickStatsRow(DashboardState state) {
    return Row(
      children: [
        Expanded(
          child: _buildStatCard(
            icon: Icons.wifi,
            label: context.tr('dashboard.activeSessions'),
            value: '${state.totalActiveSessions}',
            color: AppColors.primary,
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: _buildStatCard(
            icon: Icons.confirmation_number,
            label: context.tr('dashboard.vouchersToday'),
            value: '${state.vouchersUsedToday}',
            color: AppColors.secondary,
          ),
        ),
      ],
    );
  }

  Widget _buildSecondStatsRow(DashboardState state) {
    final revenue = state.dailyRevenue;
    final revenueText = revenue == revenue.roundToDouble()
        ? '\$${revenue.toStringAsFixed(0)}'
        : '\$${revenue.toStringAsFixed(2)}';

    return Row(
      children: [
        Expanded(
          child: _buildStatCard(
            icon: Icons.payments,
            label: context.tr('dashboard.dailyRevenue'),
            value: revenueText,
            color: AppColors.success,
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: _buildStatCard(
            icon: Icons.router,
            label: context.tr('dashboard.onlineRouters'),
            value: '${state.onlineRouters}',
            color: AppColors.online,
          ),
        ),
      ],
    );
  }

  Widget _buildStatCard({
    required IconData icon,
    required String label,
    required String value,
    required Color color,
  }) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          children: [
            Icon(icon, size: 28, color: color),
            const SizedBox(height: AppSpacing.sm),
            Text(value,
                style: const TextStyle(
                    fontSize: 24, fontWeight: FontWeight.bold)),
            const SizedBox(height: AppSpacing.xs),
            Text(label,
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 13)),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Data Usage Card (24h)
  // ---------------------------------------------------------------------------
  Widget _buildDataUsageCard(DashboardState state) {
    final usage = state.dataUsage24h;
    final totalInput = usage['totalInput'] as int? ?? 0;
    final totalOutput = usage['totalOutput'] as int? ?? 0;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(context.tr('dashboard.dataUsage24h'),
                style: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  child: Row(
                    children: [
                      const Icon(Icons.arrow_downward,
                          size: 20, color: AppColors.success),
                      const SizedBox(width: AppSpacing.sm),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(context.tr('dashboard.download'),
                              style: const TextStyle(
                                  color: AppColors.textSecondary,
                                  fontSize: 12)),
                          Text(_formatBytes(totalInput),
                              style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 15)),
                        ],
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: Row(
                    children: [
                      const Icon(Icons.arrow_upward,
                          size: 20, color: AppColors.primary),
                      const SizedBox(width: AppSpacing.sm),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(context.tr('dashboard.upload'),
                              style: const TextStyle(
                                  color: AppColors.textSecondary,
                                  fontSize: 12)),
                          Text(_formatBytes(totalOutput),
                              style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 15)),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Routers Status Card
  // ---------------------------------------------------------------------------
  Widget _buildRoutersCard(DashboardState state) {
    final routers = state.routers;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(context.tr('dashboard.routers'),
                style: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: AppSpacing.md),
            if (routers.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
                child: Center(
                  child: Text(context.tr('dashboard.noRoutersAdded'),
                      style: const TextStyle(color: AppColors.textSecondary)),
                ),
              )
            else
              ...routers.map((r) {
                final name = r['name'] as String? ?? 'Unknown';
                final status = r['status'] as String? ?? 'offline';
                final lastSeen = r['lastSeen'] as String?;
                final routerId = r['id'] as String;

                return InkWell(
                  onTap: () =>
                      context.push('/routers/detail', extra: routerId),
                  borderRadius:
                      BorderRadius.circular(AppSpacing.radiusMd),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                        vertical: AppSpacing.sm),
                    child: Row(
                      children: [
                        Container(
                          width: 10,
                          height: 10,
                          decoration: BoxDecoration(
                            color: _statusColor(status),
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Text(name,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w500)),
                        ),
                        Text(_relativeTime(context, lastSeen),
                            style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 13)),
                        const SizedBox(width: AppSpacing.xs),
                        const Icon(Icons.chevron_right,
                            size: 18,
                            color: AppColors.textTertiary),
                      ],
                    ),
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Active Sessions by Router
  // ---------------------------------------------------------------------------
  Widget _buildSessionsByRouterCard(DashboardState state) {
    final sessions = state.activeSessionsByRouter;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(context.tr('dashboard.sessionsByRouter'),
                style: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: AppSpacing.md),
            if (sessions.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
                child: Center(
                  child: Text(context.tr('dashboard.noActiveSessions'),
                      style: const TextStyle(color: AppColors.textSecondary)),
                ),
              )
            else
              ...sessions.map((s) {
                final routerName =
                    s['routerName'] as String? ?? 'Unknown';
                final count = s['activeSessions'] as int? ?? 0;

                return Padding(
                  padding: const EdgeInsets.symmetric(
                      vertical: AppSpacing.sm),
                  child: Row(
                    children: [
                      const Icon(Icons.router,
                          size: 20, color: AppColors.textSecondary),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Text(routerName,
                            style: const TextStyle(
                                fontWeight: FontWeight.w500)),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.sm,
                            vertical: AppSpacing.xs),
                        decoration: BoxDecoration(
                          color: AppColors.primaryLight,
                          borderRadius: BorderRadius.circular(
                              AppSpacing.radiusSm),
                        ),
                        child: Text(
                          '$count',
                          style: const TextStyle(
                              color: AppColors.primary,
                              fontWeight: FontWeight.w600,
                              fontSize: 13),
                        ),
                      ),
                    ],
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Loading Skeleton
  // ---------------------------------------------------------------------------
  Widget _buildLoadingSkeleton() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        children: [
          _skeletonCard(height: 140),
          const SizedBox(height: AppSpacing.lg),
          Row(
            children: [
              Expanded(child: _skeletonCard(height: 100)),
              const SizedBox(width: AppSpacing.md),
              Expanded(child: _skeletonCard(height: 100)),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          _skeletonCard(height: 80),
          const SizedBox(height: AppSpacing.lg),
          _skeletonCard(height: 120),
          const SizedBox(height: AppSpacing.lg),
          _skeletonCard(height: 100),
        ],
      ),
    );
  }

  Widget _skeletonCard({required double height}) {
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: Colors.grey[200],
        borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Error State
  // ---------------------------------------------------------------------------
  Widget _buildErrorState(String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxl),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline,
                size: 48, color: AppColors.error),
            const SizedBox(height: AppSpacing.lg),
            Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 15)),
            const SizedBox(height: AppSpacing.lg),
            FilledButton.icon(
              onPressed: () =>
                  ref.read(dashboardProvider.notifier).loadDashboard(),
              icon: const Icon(Icons.refresh),
              label: Text(context.tr('common.retry')),
            ),
          ],
        ),
      ),
    );
  }
}

class _NotificationBell extends StatelessWidget {
  final int unreadCount;
  final VoidCallback onTap;

  const _NotificationBell({required this.unreadCount, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onTap,
      tooltip: context.tr('notifications.title'),
      icon: Stack(
        clipBehavior: Clip.none,
        children: [
          const Icon(Icons.notifications_none),
          if (unreadCount > 0)
            Positioned(
              right: -4,
              top: -4,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                decoration: BoxDecoration(
                  color: AppColors.error,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  unreadCount > 99 ? '99+' : '$unreadCount',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
