import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../i18n/app_localizations.dart';
import '../i18n/plan_format.dart';
import '../i18n/status_format.dart';
import '../providers/dashboard_provider.dart';
import '../providers/notifications_provider.dart';
import '../providers/subscription_provider.dart';
import '../theme/theme.dart';
import '../widgets/widgets.dart';

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

  String _formatBytes(BuildContext context, int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) {
      return '${(bytes / 1024).toStringAsFixed(1)} ${context.tr('vouchers.unitKb')}';
    }
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} ${context.tr('vouchers.unitMb')}';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} ${context.tr('vouchers.unitGb')}';
  }

  String _relativeTime(BuildContext context, String? isoDate) {
    if (isoDate == null || isoDate.isEmpty) return context.tr('common.notAvailable');
    try {
      final date = DateTime.parse(isoDate);
      final now = DateTime.now();
      final diff = now.difference(date);
      if (diff.inSeconds < 60) return context.tr('routers.justNow');
      if (diff.inMinutes < 60) {
        return context.trPlural('routers.minutesAgo', diff.inMinutes, [diff.inMinutes.toString()]);
      }
      if (diff.inHours < 24) {
        return context.trPlural('routers.hoursAgo', diff.inHours, [diff.inHours.toString()]);
      }
      return context.trPlural('routers.daysAgo', diff.inDays, [diff.inDays.toString()]);
    } catch (_) {
      return context.tr('common.notAvailable');
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(dashboardProvider);
    final isActive =
        ref.watch(subscriptionProvider).subscription?.isActive ?? false;

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
      body: _buildBody(state, isActive),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _onQuickCreate(state),
        icon: const Icon(Icons.add),
        label: Text(context.tr('dashboard.quickCreateVoucher')),
      ),
    );
  }

  void _onQuickCreate(DashboardState state) {
    final subState = ref.read(subscriptionProvider);

    // If the subscription failed to load (null + error), retry instead of
    // showing the paywall — the user may well have an active subscription.
    if (subState.subscription == null && subState.error != null) {
      ref.read(subscriptionProvider.notifier).loadSubscription();
      return;
    }

    final isActive = subState.subscription?.isActive ?? false;
    if (!isActive) {
      _showSubscriptionGate();
      return;
    }
    final routers = state.routers;
    if (routers.isEmpty) {
      AppSnackbar.info(context, context.tr('dashboard.addRouterFirst'));
      return;
    }
    final firstRouterId = routers[0]['id'] as String;
    context.push('/vouchers/create', extra: firstRouterId);
  }

  void _showSubscriptionGate() {
    showDialog<void>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        title: Text(context.tr('subscription.required')),
        content: Text(context.tr('subscription.requiredDesc')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx).pop(),
            child: Text(context.tr('common.cancel')),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(dialogCtx).pop();
              context.push('/subscription');
            },
            child: Text(context.tr('subscription.viewPlans')),
          ),
        ],
      ),
    );
  }

  Widget _buildBody(DashboardState state, bool isActive) {
    if (state.isLoading && state.data == null) {
      return _buildLoadingSkeleton();
    }

    if (state.error != null && state.data == null) {
      return ErrorState(
        message: state.error!,
        onRetry: () => ref.read(dashboardProvider.notifier).loadDashboard(),
        retryLabel: context.tr('common.retry'),
      );
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
            _buildQuickStatsRow(state, isActive),
            const SizedBox(height: AppSpacing.md),
            _buildSecondStatsRow(state, isActive),
            const SizedBox(height: AppSpacing.lg),
            _buildDataUsageCard(state, isActive),
            const SizedBox(height: AppSpacing.lg),
            _buildRoutersCard(state),
            const SizedBox(height: AppSpacing.lg),
            _buildSessionsByRouterCard(state, isActive),
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
      return AppCard(
        child: Column(
          children: [
            const Icon(Icons.credit_card_off,
                size: 40, color: AppColors.textTertiary),
            const SizedBox(height: AppSpacing.sm),
            Text(context.tr('dashboard.noActiveSubscription'),
                style: AppTypography.headline),
            const SizedBox(height: AppSpacing.sm),
            FilledButton(
              onPressed: () => context.push('/subscription'),
              child: Text(context.tr('dashboard.viewPlans')),
            ),
          ],
        ),
      );
    }

    final planName = sub['planName'] as String? ?? 'Unknown';
    final planNameAr = sub['planNameAr'] as String?;
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

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                pickPlanName(context, name: planName, nameAr: planNameAr),
                style: AppTypography.title2,
              ),
              StatusBadge(
                label: trStatus(context, 'subscription', status),
                color: statusBadgeColor,
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
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
            style: AppTypography.footnote,
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Quick Stats Row
  // ---------------------------------------------------------------------------
  Widget _buildQuickStatsRow(DashboardState state, bool isActive) {
    return Row(
      children: [
        Expanded(
          child: StatCard(
            icon: Icons.wifi,
            label: context.tr('dashboard.activeSessions'),
            value: isActive ? '${state.totalActiveSessions}' : '--',
            color: AppColors.primary,
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: StatCard(
            icon: Icons.confirmation_number,
            label: context.tr('dashboard.vouchersToday'),
            value: isActive ? '${state.vouchersUsedToday}' : '--',
            color: AppColors.secondary,
          ),
        ),
      ],
    );
  }

  Widget _buildSecondStatsRow(DashboardState state, bool isActive) {
    final revenue = state.dailyRevenue;
    final symbol = context.tr('common.currencySymbol');
    final revenueText = revenue == revenue.roundToDouble()
        ? '$symbol ${revenue.toStringAsFixed(0)}'
        : '$symbol ${revenue.toStringAsFixed(2)}';

    return Row(
      children: [
        Expanded(
          child: StatCard(
            icon: Icons.payments,
            label: context.tr('dashboard.dailyRevenue'),
            value: isActive ? revenueText : '--',
            color: AppColors.success,
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: StatCard(
            icon: Icons.router,
            label: context.tr('dashboard.onlineRouters'),
            value: '${state.onlineRouters}',
            color: AppColors.online,
          ),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Data Usage Card (24h)
  // ---------------------------------------------------------------------------
  Widget _buildDataUsageCard(DashboardState state, bool isActive) {
    final usage = state.dataUsage24h;
    final totalInput = usage['totalInput'] as int? ?? 0;
    final totalOutput = usage['totalOutput'] as int? ?? 0;
    final downloadText = isActive ? _formatBytes(context, totalInput) : '--';
    final uploadText = isActive ? _formatBytes(context, totalOutput) : '--';

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(title: context.tr('dashboard.dataUsage24h')),
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
                            style: AppTypography.caption1),
                        Text(downloadText,
                            style: AppTypography.headline),
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
                            style: AppTypography.caption1),
                        Text(uploadText,
                            style: AppTypography.headline),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Routers Status Card
  // ---------------------------------------------------------------------------
  Widget _buildRoutersCard(DashboardState state) {
    final routers = state.routers;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(title: context.tr('dashboard.routers')),
          if (routers.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
              child: Center(
                child: Text(context.tr('dashboard.noRoutersAdded'),
                    style: AppTypography.footnote),
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
                      StatusDot(AppColors.routerStatus(status)),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Text(name,
                            style: const TextStyle(
                                fontWeight: FontWeight.w500)),
                      ),
                      Text(_relativeTime(context, lastSeen),
                          style: AppTypography.footnote),
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
    );
  }

  // ---------------------------------------------------------------------------
  // Active Sessions by Router
  // ---------------------------------------------------------------------------
  Widget _buildSessionsByRouterCard(DashboardState state, bool isActive) {
    final sessions = state.activeSessionsByRouter;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(title: context.tr('dashboard.sessionsByRouter')),
          if (sessions.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
              child: Center(
                child: Text(context.tr('dashboard.noActiveSessions'),
                    style: AppTypography.footnote),
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
                    StatusBadge(
                      label: isActive ? '$count' : '--',
                      color: AppColors.primary,
                    ),
                  ],
                ),
              );
            }),
        ],
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
          const SkeletonCard(height: 140),
          const SizedBox(height: AppSpacing.lg),
          Row(
            children: const [
              Expanded(child: SkeletonCard(height: 100)),
              SizedBox(width: AppSpacing.md),
              Expanded(child: SkeletonCard(height: 100)),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          const SkeletonCard(height: 80),
          const SizedBox(height: AppSpacing.lg),
          const SkeletonCard(height: 120),
          const SizedBox(height: AppSpacing.lg),
          const SkeletonCard(height: 100),
        ],
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
                    color: AppColors.textInverse,
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
