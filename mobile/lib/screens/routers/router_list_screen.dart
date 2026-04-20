import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../i18n/app_localizations.dart';
import '../../providers/routers_provider.dart';
import '../../providers/subscription_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class RouterListScreen extends ConsumerStatefulWidget {
  const RouterListScreen({super.key});

  @override
  ConsumerState<RouterListScreen> createState() => _RouterListScreenState();
}

class _RouterListScreenState extends ConsumerState<RouterListScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(routersProvider.notifier).loadRouters());
  }

  bool _hasActiveSubscription() {
    final sub = ref.read(subscriptionProvider).subscription;
    return sub?.isActive ?? false;
  }

  void _onAddRouter() {
    if (!_hasActiveSubscription()) {
      _showSubscriptionGate();
      return;
    }
    context.push('/routers/add');
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
              context.go('/subscription');
            },
            child: Text(context.tr('subscription.viewPlans')),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(routersProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(context.tr('routers.title')),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: _onAddRouter,
          ),
        ],
      ),
      body: state.isLoading && state.routers.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : state.error != null && state.routers.isEmpty
              ? _buildError(state.error!)
              : state.routers.isEmpty
                  ? _buildEmpty()
                  : _buildList(state),
    );
  }

  Widget _buildError(String error) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 64, color: AppColors.error),
            const SizedBox(height: AppSpacing.lg),
            Text(error, style: AppTypography.body, textAlign: TextAlign.center),
            const SizedBox(height: AppSpacing.xxl),
            SizedBox(
              height: 48,
              child: ElevatedButton(
                onPressed: () =>
                    ref.read(routersProvider.notifier).loadRouters(),
                child: Text(context.tr('common.retry')),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmpty() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.router, size: 64, color: AppColors.textTertiary),
            const SizedBox(height: AppSpacing.lg),
            Text(context.tr('routers.noRouters'),
                style: AppTypography.title2, textAlign: TextAlign.center),
            const SizedBox(height: AppSpacing.sm),
            Text(
              context.tr('routers.addFirstRouter'),
              style: AppTypography.subhead
                  .copyWith(color: AppColors.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xxl),
            SizedBox(
              height: 48,
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _onAddRouter,
                icon: const Icon(Icons.add),
                label: Text(context.tr('routers.addRouter')),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildList(RoutersState state) {
    return RefreshIndicator(
      onRefresh: () => ref.read(routersProvider.notifier).loadRouters(),
      child: ListView.builder(
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: state.routers.length,
        itemBuilder: (context, index) {
          final router = state.routers[index];
          return _RouterCard(
            router: router,
            onTap: () => context.push('/routers/detail', extra: router.id),
          );
        },
      ),
    );
  }
}

class _RouterCard extends StatelessWidget {
  final dynamic router;
  final VoidCallback onTap;

  const _RouterCard({required this.router, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _statusDot(router.status),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(router.name, style: AppTypography.title3),
                ),
                Icon(Icons.chevron_right,
                    color: AppColors.textTertiary, size: 20),
              ],
            ),
            if (router.model != null) ...[
              const SizedBox(height: AppSpacing.xs),
              Padding(
                padding: const EdgeInsets.only(left: 20),
                child: Text(router.model!,
                    style: AppTypography.footnote),
              ),
            ],
            if (router.tunnelIp != null) ...[
              const SizedBox(height: AppSpacing.xs),
              Padding(
                padding: const EdgeInsets.only(left: 20),
                child: Text(router.tunnelIp!,
                    style: AppTypography.caption1),
              ),
            ],
            const SizedBox(height: AppSpacing.sm),
            Padding(
              padding: const EdgeInsets.only(left: 20),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    _capitalizeStatus(router.status),
                    style: AppTypography.caption1.copyWith(
                      color: _statusColor(router.status),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    _formatLastSeen(context, router.lastSeen),
                    style: AppTypography.caption1,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statusDot(String status) {
    return Container(
      width: 12,
      height: 12,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: _statusColor(status),
      ),
    );
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'online':
        return AppColors.success;
      case 'degraded':
        return AppColors.warning;
      case 'offline':
      default:
        return AppColors.error;
    }
  }

  String _capitalizeStatus(String status) {
    if (status.isEmpty) return status;
    return status[0].toUpperCase() + status.substring(1);
  }

  String _formatLastSeen(BuildContext context, DateTime? lastSeen) {
    if (lastSeen == null) return context.tr('routers.never');
    final diff = DateTime.now().difference(lastSeen);
    if (diff.inSeconds < 60) return context.tr('routers.justNow');
    if (diff.inMinutes < 60) return context.tr('routers.minutesAgo', [diff.inMinutes.toString()]);
    if (diff.inHours < 24) return context.tr('routers.hoursAgo', [diff.inHours.toString()]);
    if (diff.inDays < 30) return context.tr('routers.daysAgo', [diff.inDays.toString()]);
    return context.tr('routers.monthsAgo', [(diff.inDays / 30).floor().toString()]);
  }
}
