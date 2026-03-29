import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/routers_provider.dart';
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

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(routersProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Routers'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () => context.push('/routers/add'),
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
                child: const Text('Retry'),
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
            Text('No Routers Yet',
                style: AppTypography.title2, textAlign: TextAlign.center),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Add your first router to get started.',
              style: AppTypography.subhead
                  .copyWith(color: AppColors.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xxl),
            SizedBox(
              height: 48,
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () => context.push('/routers/add'),
                icon: const Icon(Icons.add),
                label: const Text('Add Router'),
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
                    _formatLastSeen(router.lastSeen),
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

  String _formatLastSeen(DateTime? lastSeen) {
    if (lastSeen == null) return 'Never';
    final diff = DateTime.now().difference(lastSeen);
    if (diff.inSeconds < 60) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 30) return '${diff.inDays}d ago';
    return '${(diff.inDays / 30).floor()}mo ago';
  }
}
