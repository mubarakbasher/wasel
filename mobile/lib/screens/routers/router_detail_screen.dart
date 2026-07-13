import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../i18n/app_localizations.dart';
import '../../providers/hotspot_templates_provider.dart';
import '../../providers/routers_provider.dart';
import '../../services/router_service.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';
import '../../widgets/widgets.dart';

class RouterDetailScreen extends ConsumerStatefulWidget {
  final String routerId;

  const RouterDetailScreen({super.key, required this.routerId});

  @override
  ConsumerState<RouterDetailScreen> createState() =>
      _RouterDetailScreenState();
}

class _RouterDetailScreenState extends ConsumerState<RouterDetailScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(routersProvider.notifier).loadRouter(widget.routerId);
      ref.read(routersProvider.notifier).loadRouterStatus(widget.routerId);
    });
  }

  Future<void> _deleteRouter() async {
    final router = ref.read(routersProvider).selectedRouter;
    if (router == null) return;

    final confirmed = await showConfirmDialog(
      context,
      title: context.tr('routers.deleteRouter'),
      message: context.tr('routers.deleteConfirmNamed', [router.name]),
      confirmLabel: context.tr('common.delete'),
      cancelLabel: context.tr('common.cancel'),
      destructive: true,
    );

    if (!confirmed || !mounted) return;

    final success =
        await ref.read(routersProvider.notifier).deleteRouter(router.id);
    if (success && mounted) {
      AppSnackbar.success(context, context.tr('routers.deleted'));
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(routersProvider);
    final router = state.selectedRouter;
    final status = state.selectedRouterStatus;

    return Scaffold(
      appBar: AppBar(
        title: Text(router?.name ?? context.tr('routers.routerDetails')),
        actions: [
          if (router != null) ...[
            IconButton(
              icon: const Icon(Icons.edit),
              onPressed: () =>
                  context.push('/routers/edit', extra: router.id),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline),
              onPressed: _deleteRouter,
            ),
          ],
        ],
      ),
      body: state.isLoading && router == null
          ? const Center(child: CircularProgressIndicator())
          : router == null
              ? Center(
                  child: Text(context.tr('routers.notFound'),
                      style: AppTypography.body
                          .copyWith(color: AppColors.textSecondary)),
                )
              : RefreshIndicator(
                  onRefresh: () async {
                    await ref
                        .read(routersProvider.notifier)
                        .loadRouter(widget.routerId);
                    await ref
                        .read(routersProvider.notifier)
                        .loadRouterStatus(widget.routerId);
                  },
                  child: ListView(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    children: [
                      _buildStatusCard(router, status),
                      const SizedBox(height: AppSpacing.lg),
                      if (status?.systemInfo != null) ...[
                        _buildSystemInfoCard(status!.systemInfo!),
                        const SizedBox(height: AppSpacing.lg),
                      ],
                      _buildDetailsCard(router),
                      const SizedBox(height: AppSpacing.lg),
                      _buildActionsCard(router),
                    ],
                  ),
                ),
    );
  }

  Widget _buildStatusCard(dynamic router, RouterStatusInfo? status) {
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 24,
                height: 24,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.routerStatus(router.status),
                ),
                child: Icon(
                  router.isOnline ? Icons.check : Icons.close,
                  color: AppColors.textInverse,
                  size: 14,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              StatusBadge(
                label: context.tr('routers.${router.status}'),
                color: AppColors.routerStatus(router.status),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          _InfoRow(
            label: context.tr('routers.lastSeenLabel'),
            value: _formatLastSeen(context, router.lastSeen),
            icon: Icons.access_time,
          ),
          if (router.tunnelIp != null) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
              label: context.tr('routers.tunnelIp'),
              value: router.tunnelIp!,
              icon: Icons.lan,
            ),
          ],
          if (status?.liveDataAvailable == false) ...[
            const SizedBox(height: AppSpacing.md),
            Text(
              context.tr('routers.liveDataUnavailable'),
              style: AppTypography.caption1.copyWith(color: AppColors.warning),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildSystemInfoCard(RouterSystemInfo info) {
    final memoryUsed = info.totalMemory - info.freeMemory;
    final memoryPercent =
        info.totalMemory > 0 ? memoryUsed / info.totalMemory : 0.0;

    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(context.tr('routers.systemInformation'),
              style: AppTypography.title3),
          const SizedBox(height: AppSpacing.lg),
          _InfoRow(
              label: context.tr('routers.identity'),
              value: info.identity,
              icon: Icons.badge),
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
              label: context.tr('routers.uptimeLabel'),
              value: info.uptime,
              icon: Icons.timer),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Icon(Icons.memory, size: 18, color: AppColors.textSecondary),
              const SizedBox(width: AppSpacing.sm),
              Text(context.tr('routers.cpuLoad'),
                  style: AppTypography.subhead
                      .copyWith(color: AppColors.textSecondary)),
              const Spacer(),
              Text('${info.cpuLoad}%',
                  style: AppTypography.subhead
                      .copyWith(fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          ClipRRect(
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            child: LinearProgressIndicator(
              value: info.cpuLoad / 100.0,
              minHeight: 6,
              backgroundColor: AppColors.background,
              valueColor: AlwaysStoppedAnimation(
                info.cpuLoad > 90
                    ? AppColors.error
                    : info.cpuLoad > 70
                        ? AppColors.warning
                        : AppColors.success,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Icon(Icons.storage, size: 18, color: AppColors.textSecondary),
              const SizedBox(width: AppSpacing.sm),
              Text(context.tr('routers.memoryLabel'),
                  style: AppTypography.subhead
                      .copyWith(color: AppColors.textSecondary)),
              const Spacer(),
              Text(
                '${_formatBytes(memoryUsed)} / ${_formatBytes(info.totalMemory)}',
                style: AppTypography.subhead
                    .copyWith(fontWeight: FontWeight.w600),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          ClipRRect(
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            child: LinearProgressIndicator(
              value: memoryPercent.clamp(0.0, 1.0),
              minHeight: 6,
              backgroundColor: AppColors.background,
              valueColor: AlwaysStoppedAnimation(
                memoryPercent > 0.9
                    ? AppColors.error
                    : memoryPercent > 0.7
                        ? AppColors.warning
                        : AppColors.success,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
              label: context.tr('routers.board'),
              value: info.boardName,
              icon: Icons.developer_board),
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
              label: context.tr('routers.architecture'),
              value: info.architecture,
              icon: Icons.architecture),
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
              label: context.tr('routers.routerOS'),
              value: info.version,
              icon: Icons.info_outline),
          if (info.model != null) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
                label: context.tr('routers.model'),
                value: info.model!,
                icon: Icons.devices),
          ],
          if (info.serialNumber != null) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
                label: context.tr('routers.serial'),
                value: info.serialNumber!,
                icon: Icons.tag),
          ],
          if (info.firmware != null) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
                label: context.tr('routers.firmwareLabel'),
                value: info.firmware!,
                icon: Icons.system_update),
          ],
        ],
      ),
    );
  }

  Widget _buildDetailsCard(dynamic router) {
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(context.tr('routers.routerDetails'), style: AppTypography.title3),
          const SizedBox(height: AppSpacing.lg),
          _InfoRow(
              label: context.tr('routers.name'),
              value: router.name,
              icon: Icons.label),
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
            label: context.tr('routers.model'),
            value: router.model ?? '—',
            icon: Icons.devices,
          ),
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
            label: context.tr('routers.routerOS'),
            value: router.rosVersion ?? '—',
            icon: Icons.info_outline,
          ),
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
            label: context.tr('routers.apiUser'),
            value: router.apiUser ?? context.tr('routers.notConfigured'),
            icon: Icons.person,
          ),
          if (router.wgPublicKey != null) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
              label: context.tr('routers.wgKey'),
              value: router.wgPublicKey!.length > 20
                  ? '${router.wgPublicKey!.substring(0, 20)}...'
                  : router.wgPublicKey!,
              icon: Icons.vpn_key,
            ),
          ],
          if (router.nasIdentifier != null) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
              label: context.tr('routers.nasId'),
              value: router.nasIdentifier!,
              icon: Icons.fingerprint,
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          _InfoRow(
            label: context.tr('routers.created'),
            value: _formatDate(router.createdAt),
            icon: Icons.calendar_today,
          ),
        ],
      ),
    );
  }

  Widget _buildActionsCard(dynamic router) {
    return Column(
      children: [
        SizedBox(
          height: 48,
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: () =>
                context.push('/routers/setup-guide', extra: router.id),
            icon: const Icon(Icons.article),
            label: Text(context.tr('routers.viewSetupGuide')),
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        _HotspotTemplateRow(router: router),
        const SizedBox(height: AppSpacing.sm),
        SizedBox(
          height: 48,
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: () =>
                context.push('/routers/edit', extra: router.id),
            icon: const Icon(Icons.edit),
            label: Text(context.tr('routers.editRouter')),
          ),
        ),
      ],
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

  String _formatDate(DateTime date) {
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
  }
}

// ---------------------------------------------------------------------------
// Hotspot template entry row in the actions card
// ---------------------------------------------------------------------------

class _HotspotTemplateRow extends ConsumerWidget {
  final dynamic router;

  const _HotspotTemplateRow({required this.router});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final templateId = router.hotspotTemplateId as String?;
    final templateStatus = router.hotspotTemplateStatus as String?;

    String subtitle = context.tr('routers.hotspotTemplate.notSet');
    if (templateId != null) {
      final statusKey = templateStatus != null
          ? 'routers.hotspotTemplate.status.$templateStatus'
          : null;
      final statusLabel =
          statusKey != null ? context.tr(statusKey) : templateStatus ?? '';
      subtitle = '$templateId — $statusLabel';
    }

    return SizedBox(
      width: double.infinity,
      child: OutlinedButton(
        onPressed: () {
          ref.read(hotspotTemplateNotifierProvider.notifier).reset();
          context.push('/routers/hotspot-template', extra: {
            'id': router.id as String,
            'name': router.name as String,
            'currentAccent': router.hotspotAccentColor as String?,
          });
        },
        child: Row(
          children: [
            const Icon(Icons.web, size: 18),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    context.tr('routers.hotspotTemplate.action'),
                    style: AppTypography.callout,
                  ),
                  Text(
                    subtitle,
                    style: AppTypography.caption1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, size: 18),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;

  const _InfoRow({
    required this.label,
    required this.value,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18, color: AppColors.textSecondary),
        const SizedBox(width: AppSpacing.sm),
        Text(label,
            style:
                AppTypography.subhead.copyWith(color: AppColors.textSecondary)),
        const Spacer(),
        Flexible(
          child: Text(
            value,
            style:
                AppTypography.subhead.copyWith(fontWeight: FontWeight.w600),
            textAlign: TextAlign.end,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
