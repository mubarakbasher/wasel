import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../i18n/app_localizations.dart';
import '../../models/app_notification.dart';
import '../../providers/notifications_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';
import '../../widgets/widgets.dart';

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() =>
      _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    Future.microtask(
        () => ref.read(notificationsProvider.notifier).refresh());
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      ref.read(notificationsProvider.notifier).loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(notificationsProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(context.tr('notifications.title')),
        actions: [
          if (state.unreadCount > 0)
            TextButton(
              onPressed: () =>
                  ref.read(notificationsProvider.notifier).markAllRead(),
              child: Text(context.tr('notifications.markAllRead')),
            ),
        ],
      ),
      body: _buildBody(state),
    );
  }

  Widget _buildBody(NotificationsState state) {
    if (state.isLoading && state.items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.error != null && state.items.isEmpty) {
      return ErrorState(
        message: state.error!,
        onRetry: () => ref.read(notificationsProvider.notifier).refresh(),
        retryLabel: context.tr('common.retry'),
      );
    }

    if (state.items.isEmpty) {
      return EmptyState(
        icon: Icons.notifications_none,
        title: context.tr('notifications.empty'),
      );
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(notificationsProvider.notifier).refresh(),
      child: ListView.separated(
        controller: _scrollController,
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
        itemCount: state.items.length + (state.hasMore ? 1 : 0),
        separatorBuilder: (_, _) => const Divider(height: 1),
        itemBuilder: (context, index) {
          if (index >= state.items.length) {
            return const Padding(
              padding: EdgeInsets.all(AppSpacing.lg),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          final item = state.items[index];
          return Dismissible(
            key: ValueKey(item.id),
            direction: DismissDirection.endToStart,
            background: Container(
              color: AppColors.error,
              alignment: AlignmentDirectional.centerEnd,
              padding: const EdgeInsetsDirectional.only(end: AppSpacing.lg),
              child: const Icon(Icons.delete, color: AppColors.textInverse),
            ),
            onDismissed: (_) =>
                ref.read(notificationsProvider.notifier).delete(item.id),
            child: _NotificationTile(
              item: item,
              onTap: () {
                if (item.isUnread) {
                  ref
                      .read(notificationsProvider.notifier)
                      .markRead(item.id);
                }
              },
            ),
          );
        },
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  final AppNotification item;
  final VoidCallback onTap;

  const _NotificationTile({required this.item, required this.onTap});

  IconData _iconFor(String category) {
    switch (category) {
      case 'payment_confirmed':
        return Icons.check_circle;
      case 'subscription_expiring':
      case 'subscription_expired':
        return Icons.event_busy;
      case 'router_offline':
        return Icons.wifi_off;
      case 'router_online':
        return Icons.wifi;
      case 'voucher_quota_low':
        return Icons.warning_amber;
      case 'bulk_creation_complete':
        return Icons.auto_awesome;
      default:
        return Icons.notifications;
    }
  }

  Color _colorFor(String category) {
    switch (category) {
      case 'payment_confirmed':
      case 'router_online':
        return AppColors.success;
      case 'router_offline':
      case 'subscription_expired':
        return AppColors.error;
      case 'voucher_quota_low':
      case 'subscription_expiring':
        return AppColors.warning;
      default:
        return AppColors.primary;
    }
  }

  String _relativeTime(BuildContext context, DateTime d) {
    final diff = DateTime.now().difference(d);
    if (diff.inSeconds < 60) return context.tr('routers.justNow');
    if (diff.inMinutes < 60) {
      return context.tr('routers.minutesAgo', [diff.inMinutes.toString()]);
    }
    if (diff.inHours < 24) {
      return context.tr('routers.hoursAgo', [diff.inHours.toString()]);
    }
    return context.tr('routers.daysAgo', [diff.inDays.toString()]);
  }

  @override
  Widget build(BuildContext context) {
    final color = _colorFor(item.category);
    return InkWell(
      onTap: onTap,
      child: Container(
        color: item.isUnread ? color.withValues(alpha: 0.05) : null,
        padding: const EdgeInsetsDirectional.symmetric(
            horizontal: AppSpacing.lg, vertical: AppSpacing.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(_iconFor(item.category), color: color, size: 22),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          item.title,
                          style: AppTypography.subhead.copyWith(
                            fontWeight: item.isUnread
                                ? FontWeight.w700
                                : FontWeight.w500,
                          ),
                        ),
                      ),
                      if (item.isUnread)
                        StatusDot(AppColors.primary, size: 8),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    item.body,
                    style: AppTypography.footnote
                        .copyWith(color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _relativeTime(context, item.createdAt),
                    style: AppTypography.caption1
                        .copyWith(color: AppColors.textTertiary),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
