import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/router_health.dart';
import '../../providers/router_health_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class RouterHealthScreen extends ConsumerWidget {
  final String routerId;

  const RouterHealthScreen({super.key, required this.routerId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final healthAsync = ref.watch(routerHealthProvider(routerId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Health Check'),
      ),
      body: healthAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _HealthError(
          message: err.toString(),
          onRetry: () => ref.invalidate(routerHealthProvider(routerId)),
        ),
        data: (report) => _HealthBody(routerId: routerId, report: report),
      ),
      floatingActionButton: _RerunFab(routerId: routerId),
    );
  }
}

// ---------------------------------------------------------------------------
// Body — pull-to-refresh + probe list
// ---------------------------------------------------------------------------

class _HealthBody extends ConsumerWidget {
  final String routerId;
  final RouterHealthReport report;

  const _HealthBody({required this.routerId, required this.report});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return RefreshIndicator(
      onRefresh: () => ref.read(routerHealthProvider(routerId).notifier).rerun(),
      child: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          _OverallBadge(report: report),
          const SizedBox(height: AppSpacing.lg),
          ...report.probes.map(
            (probe) => _ProbeRow(probe: probe, routerId: routerId),
          ),
          const SizedBox(height: AppSpacing.xxl),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Overall badge
// ---------------------------------------------------------------------------

class _OverallBadge extends StatelessWidget {
  final RouterHealthReport report;

  const _OverallBadge({required this.report});

  @override
  Widget build(BuildContext context) {
    final color = _overallColor(report.overall);
    final label = _overallLabel(report.overall);

    return Container(
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(_overallIcon(report.overall), color: color, size: 32),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: AppTypography.title3.copyWith(color: color)),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  '${report.passingCount} / ${report.probes.length} checks passing',
                  style: AppTypography.caption1,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Color _overallColor(OverallHealth overall) {
    switch (overall) {
      case OverallHealth.healthy:
        return AppColors.success;
      case OverallHealth.degraded:
        return AppColors.warning;
      case OverallHealth.broken:
        return AppColors.error;
    }
  }

  IconData _overallIcon(OverallHealth overall) {
    switch (overall) {
      case OverallHealth.healthy:
        return Icons.check_circle;
      case OverallHealth.degraded:
        return Icons.warning_amber_rounded;
      case OverallHealth.broken:
        return Icons.cancel;
    }
  }

  String _overallLabel(OverallHealth overall) {
    switch (overall) {
      case OverallHealth.healthy:
        return 'Healthy';
      case OverallHealth.degraded:
        return 'Degraded';
      case OverallHealth.broken:
        return 'Broken';
    }
  }
}

// ---------------------------------------------------------------------------
// Individual probe row
// ---------------------------------------------------------------------------

class _ProbeRow extends StatelessWidget {
  final ProbeResult probe;
  final String routerId;

  const _ProbeRow({required this.probe, required this.routerId});

  @override
  Widget build(BuildContext context) {
    if (probe.status == ProbeStatus.fail && probe.remediation != null) {
      return _FailProbeRow(probe: probe, routerId: routerId);
    }
    return _SimpleProbeRow(probe: probe);
  }
}

class _SimpleProbeRow extends StatelessWidget {
  final ProbeResult probe;

  const _SimpleProbeRow({required this.probe});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(
        _statusIcon(probe.status),
        color: _statusColor(probe.status),
      ),
      title: Text(probe.label, style: AppTypography.subhead),
      subtitle: Text(probe.detail, style: AppTypography.caption1),
      contentPadding: EdgeInsets.zero,
    );
  }
}

class _FailProbeRow extends StatelessWidget {
  final ProbeResult probe;
  final String routerId;

  const _FailProbeRow({required this.probe, required this.routerId});

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      leading: Icon(Icons.error, color: AppColors.error),
      title: Text(probe.label, style: AppTypography.subhead),
      subtitle: Text(probe.detail, style: AppTypography.caption1),
      tilePadding: EdgeInsets.zero,
      childrenPadding: const EdgeInsets.only(
        left: AppSpacing.xxl + AppSpacing.lg,
        bottom: AppSpacing.md,
      ),
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: Text(
            probe.remediation!,
            style:
                AppTypography.caption1.copyWith(color: AppColors.textSecondary),
          ),
        ),
        if (probe.setupStep != null)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => context.push(
                '/routers/setup-guide',
                extra: {
                  'routerId': routerId,
                  'initialStep': probe.setupStep,
                },
              ),
              icon: const Icon(Icons.open_in_new, size: 16),
              label: Text('Open setup step ${probe.setupStep}'),
              style: TextButton.styleFrom(
                padding: EdgeInsets.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

class _HealthError extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _HealthError({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 64, color: AppColors.error),
            const SizedBox(height: AppSpacing.lg),
            Text(message,
                style: AppTypography.body, textAlign: TextAlign.center),
            const SizedBox(height: AppSpacing.xxl),
            SizedBox(
              height: 48,
              child: ElevatedButton(
                onPressed: onRetry,
                child: const Text('Retry'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Floating action button with inline loading state
// ---------------------------------------------------------------------------

class _RerunFab extends ConsumerWidget {
  final String routerId;

  const _RerunFab({required this.routerId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isLoading = ref.watch(routerHealthProvider(routerId)).isLoading;

    return FloatingActionButton.extended(
      onPressed: isLoading
          ? null
          : () => ref.read(routerHealthProvider(routerId).notifier).rerun(),
      icon: isLoading
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.refresh),
      label: const Text('Re-run check'),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers shared by probe rows
// ---------------------------------------------------------------------------

IconData _statusIcon(ProbeStatus status) {
  switch (status) {
    case ProbeStatus.pass:
      return Icons.check_circle;
    case ProbeStatus.fail:
      return Icons.error;
    case ProbeStatus.skipped:
      return Icons.remove_circle_outline;
  }
}

Color _statusColor(ProbeStatus status) {
  switch (status) {
    case ProbeStatus.pass:
      return AppColors.success;
    case ProbeStatus.fail:
      return AppColors.error;
    case ProbeStatus.skipped:
      return AppColors.textTertiary;
  }
}
