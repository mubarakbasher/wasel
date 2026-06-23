import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../i18n/app_localizations.dart';
import '../../models/router_model.dart';
import '../../providers/routers_provider.dart';
import '../../providers/subscription_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';
import '../../widgets/widgets.dart';

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
              context.push('/subscription');
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
              ? ErrorState(
                  message: state.error!,
                  onRetry: () =>
                      ref.read(routersProvider.notifier).loadRouters(),
                  retryLabel: context.tr('common.retry'),
                )
              : state.routers.isEmpty
                  ? EmptyState(
                      icon: Icons.router,
                      title: context.tr('routers.noRouters'),
                      message: context.tr('routers.addFirstRouter'),
                      action: ElevatedButton.icon(
                        onPressed: _onAddRouter,
                        icon: const Icon(Icons.add),
                        label: Text(context.tr('routers.addRouter')),
                      ),
                    )
                  : _buildList(state),
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
  final RouterModel router;
  final VoidCallback onTap;

  const _RouterCard({required this.router, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return AppCard(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              StatusDot(AppColors.routerStatus(router.status)),
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
              padding: const EdgeInsetsDirectional.only(start: 18),
              child: Text(router.model!, style: AppTypography.footnote),
            ),
          ],
          if (router.tunnelIp != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Padding(
              padding: const EdgeInsetsDirectional.only(start: 18),
              child: Text(router.tunnelIp!, style: AppTypography.caption1),
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
          Padding(
            padding: const EdgeInsetsDirectional.only(start: 18),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                StatusBadge(
                  label: context.tr('routers.${router.status}'),
                  color: AppColors.routerStatus(router.status),
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
    );
  }


  String _formatLastSeen(BuildContext context, DateTime? lastSeen) {
    if (lastSeen == null) return context.tr('routers.never');
    final diff = DateTime.now().difference(lastSeen);
    if (diff.inSeconds < 60) return context.tr('routers.justNow');
    if (diff.inMinutes < 60) {
      return context.tr('routers.minutesAgo', [diff.inMinutes.toString()]);
    }
    if (diff.inHours < 24) {
      return context.tr('routers.hoursAgo', [diff.inHours.toString()]);
    }
    if (diff.inDays < 30) {
      return context.tr('routers.daysAgo', [diff.inDays.toString()]);
    }
    return context.tr(
        'routers.monthsAgo', [(diff.inDays / 30).floor().toString()]);
  }
}
