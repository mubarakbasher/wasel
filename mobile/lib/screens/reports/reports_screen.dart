import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/reports_provider.dart';
import '../../providers/routers_provider.dart';
import '../../theme/theme.dart';

class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});

  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(routersProvider.notifier).loadRouters();
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
  }

  String _formatDuration(double seconds) {
    if (seconds < 60) return '${seconds.toInt()}s';
    if (seconds < 3600) return '${(seconds / 60).toInt()}m';
    final hours = (seconds / 3600).toInt();
    final mins = ((seconds % 3600) / 60).toInt();
    if (mins == 0) return '${hours}h';
    return '${hours}h ${mins}m';
  }

  String _formatDate(DateTime date) {
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
  }

  String _reportTypeLabel(String type) {
    switch (type) {
      case 'voucher-sales':
        return 'Voucher Sales';
      case 'sessions':
        return 'Sessions';
      case 'revenue':
        return 'Revenue';
      case 'router-uptime':
        return 'Router Uptime';
      default:
        return type;
    }
  }

  IconData _reportTypeIcon(String type) {
    switch (type) {
      case 'voucher-sales':
        return Icons.confirmation_number;
      case 'sessions':
        return Icons.wifi;
      case 'revenue':
        return Icons.attach_money;
      case 'router-uptime':
        return Icons.router;
      default:
        return Icons.bar_chart;
    }
  }

  Color _reportTypeColor(String type) {
    switch (type) {
      case 'voucher-sales':
        return AppColors.primary;
      case 'sessions':
        return AppColors.success;
      case 'revenue':
        return AppColors.secondary;
      case 'router-uptime':
        return const Color(0xFF5856D6);
      default:
        return AppColors.textSecondary;
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  Future<void> _selectDateRange() async {
    final state = ref.read(reportsProvider);
    final now = DateTime.now();
    final result = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
      initialDateRange: DateTimeRange(
        start: state.startDate,
        end: state.endDate,
      ),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: Theme.of(context).colorScheme.copyWith(
                  primary: AppColors.primary,
                ),
          ),
          child: child!,
        );
      },
    );
    if (result != null) {
      ref
          .read(reportsProvider.notifier)
          .setDateRange(result.start, result.end);
    }
  }

  Future<void> _generateReport() async {
    await ref.read(reportsProvider.notifier).loadReport();
  }

  Future<void> _exportReport() async {
    await ref.read(reportsProvider.notifier).exportReport();
    if (!mounted) return;
    final state = ref.read(reportsProvider);
    if (state.exportData != null && state.exportData!.isNotEmpty) {
      context.push('/reports/export', extra: {
        'reportType': _reportTypeLabel(state.reportType),
        'exportData': state.exportData,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(reportsProvider);
    final routersState = ref.watch(routersProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Reports'),
        actions: [
          if (state.reportData != null)
            IconButton(
              icon: const Icon(Icons.file_download_outlined),
              tooltip: 'Export CSV',
              onPressed: state.isLoading ? null : _exportReport,
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _generateReport,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Report type selector
              _buildReportTypeSelector(state),
              const SizedBox(height: AppSpacing.lg),

              // Date range picker
              _buildDateRangePicker(state),
              const SizedBox(height: AppSpacing.md),

              // Router filter
              _buildRouterFilter(state, routersState),
              const SizedBox(height: AppSpacing.xl),

              // Generate button
              SizedBox(
                width: double.infinity,
                height: AppSpacing.touchTargetMin,
                child: FilledButton.icon(
                  onPressed: state.isLoading ? null : _generateReport,
                  icon: state.isLoading
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: AppColors.textInverse,
                          ),
                        )
                      : const Icon(Icons.bar_chart),
                  label: Text(
                      state.isLoading ? 'Generating...' : 'Generate Report'),
                ),
              ),
              const SizedBox(height: AppSpacing.xxl),

              // Error
              if (state.error != null) ...[
                _buildErrorBanner(state.error!),
                const SizedBox(height: AppSpacing.lg),
              ],

              // Report results
              if (state.reportData != null) _buildReportResults(state),

              const SizedBox(height: 80), // space for FAB
            ],
          ),
        ),
      ),
      floatingActionButton: state.reportData != null
          ? FloatingActionButton.extended(
              onPressed: state.isLoading ? null : _exportReport,
              icon: const Icon(Icons.share),
              label: const Text('Export & Share'),
              backgroundColor: AppColors.primary,
              foregroundColor: AppColors.textInverse,
            )
          : null,
    );
  }

  // ---------------------------------------------------------------------------
  // Report Type Selector
  // ---------------------------------------------------------------------------

  Widget _buildReportTypeSelector(ReportsState state) {
    const types = ['voucher-sales', 'sessions', 'revenue', 'router-uptime'];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Report Type',
            style: AppTypography.headline.copyWith(fontSize: 15)),
        const SizedBox(height: AppSpacing.sm),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: types.map((type) {
            final selected = state.reportType == type;
            final color = _reportTypeColor(type);
            return ChoiceChip(
              label: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    _reportTypeIcon(type),
                    size: 16,
                    color: selected ? AppColors.textInverse : color,
                  ),
                  const SizedBox(width: AppSpacing.xs),
                  Text(_reportTypeLabel(type)),
                ],
              ),
              selected: selected,
              onSelected: (_) {
                ref.read(reportsProvider.notifier).setReportType(type);
              },
              selectedColor: color,
              labelStyle: TextStyle(
                color: selected ? AppColors.textInverse : AppColors.textPrimary,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                fontSize: 13,
              ),
              showCheckmark: false,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              ),
              side: BorderSide(
                color: selected ? color : AppColors.border,
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Date Range Picker
  // ---------------------------------------------------------------------------

  Widget _buildDateRangePicker(ReportsState state) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Date Range',
            style: AppTypography.headline.copyWith(fontSize: 15)),
        const SizedBox(height: AppSpacing.sm),
        InkWell(
          onTap: _selectDateRange,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          child: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.md,
            ),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              children: [
                const Icon(Icons.calendar_today,
                    size: 18, color: AppColors.primary),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(
                    '${_formatDate(state.startDate)}  to  ${_formatDate(state.endDate)}',
                    style: AppTypography.subhead,
                  ),
                ),
                const Icon(Icons.arrow_drop_down,
                    color: AppColors.textSecondary),
              ],
            ),
          ),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Router Filter
  // ---------------------------------------------------------------------------

  Widget _buildRouterFilter(ReportsState state, RoutersState routersState) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Router (Optional)',
            style: AppTypography.headline.copyWith(fontSize: 15)),
        const SizedBox(height: AppSpacing.sm),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            border: Border.all(color: AppColors.border),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String?>(
              value: state.routerId,
              hint: const Text('All routers'),
              isExpanded: true,
              items: [
                const DropdownMenuItem<String?>(
                  value: null,
                  child: Text('All routers'),
                ),
                ...routersState.routers.map((router) {
                  return DropdownMenuItem<String?>(
                    value: router.id,
                    child: Row(
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: router.isOnline
                                ? AppColors.online
                                : router.isDegraded
                                    ? AppColors.degraded
                                    : AppColors.offline,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Text(router.name),
                      ],
                    ),
                  );
                }),
              ],
              onChanged: (value) {
                ref.read(reportsProvider.notifier).setRouterId(value);
              },
            ),
          ),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Error Banner
  // ---------------------------------------------------------------------------

  Widget _buildErrorBanner(String message) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.errorLight,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.error.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, size: 20, color: AppColors.error),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: AppTypography.subhead.copyWith(color: AppColors.error),
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Report Results
  // ---------------------------------------------------------------------------

  Widget _buildReportResults(ReportsState state) {
    switch (state.reportType) {
      case 'voucher-sales':
        return _buildVoucherSalesReport(state.reportData!);
      case 'sessions':
        return _buildSessionsReport(state.reportData!);
      case 'revenue':
        return _buildRevenueReport(state.reportData!);
      case 'router-uptime':
        return _buildRouterUptimeReport(state.reportData!);
      default:
        return const SizedBox.shrink();
    }
  }

  // ---------------------------------------------------------------------------
  // Voucher Sales Report
  // ---------------------------------------------------------------------------

  Widget _buildVoucherSalesReport(Map<String, dynamic> data) {
    final summary = data['summary'] as Map<String, dynamic>? ?? {};
    final created = summary['created'] as int? ?? 0;
    final used = summary['used'] as int? ?? 0;
    final expired = summary['expired'] as int? ?? 0;
    final active = summary['active'] as int? ?? 0;
    final dailyBreakdown =
        (data['dailyBreakdown'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Summary', style: AppTypography.title3),
        const SizedBox(height: AppSpacing.md),
        Row(
          children: [
            Expanded(
                child: _SummaryCard(
                    label: 'Created',
                    value: '$created',
                    color: AppColors.primary,
                    icon: Icons.add_circle_outline)),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
                child: _SummaryCard(
                    label: 'Used',
                    value: '$used',
                    color: AppColors.secondary,
                    icon: Icons.check_circle_outline)),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        Row(
          children: [
            Expanded(
                child: _SummaryCard(
                    label: 'Expired',
                    value: '$expired',
                    color: AppColors.error,
                    icon: Icons.cancel_outlined)),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
                child: _SummaryCard(
                    label: 'Active',
                    value: '$active',
                    color: AppColors.success,
                    icon: Icons.radio_button_checked)),
          ],
        ),
        if (dailyBreakdown.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.xxl),
          Text('Daily Breakdown', style: AppTypography.title3),
          const SizedBox(height: AppSpacing.md),
          ...dailyBreakdown.map((day) => _DailyBreakdownTile(
                date: day['date'] as String? ?? '',
                value: '${day['count'] ?? 0} vouchers',
                icon: Icons.confirmation_number_outlined,
              )),
        ],
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Sessions Report
  // ---------------------------------------------------------------------------

  Widget _buildSessionsReport(Map<String, dynamic> data) {
    final summary = data['summary'] as Map<String, dynamic>? ?? {};
    final totalSessions = summary['totalSessions'] as int? ?? 0;
    final avgDuration = (summary['avgDuration'] as num?)?.toDouble() ?? 0.0;
    final totalDataIn = summary['totalDataIn'] as int? ?? 0;
    final totalDataOut = summary['totalDataOut'] as int? ?? 0;
    final dailyBreakdown =
        (data['dailyBreakdown'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Summary', style: AppTypography.title3),
        const SizedBox(height: AppSpacing.md),
        Row(
          children: [
            Expanded(
                child: _SummaryCard(
                    label: 'Total Sessions',
                    value: '$totalSessions',
                    color: AppColors.primary,
                    icon: Icons.wifi)),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
                child: _SummaryCard(
                    label: 'Avg Duration',
                    value: _formatDuration(avgDuration),
                    color: AppColors.secondary,
                    icon: Icons.timer)),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        Row(
          children: [
            Expanded(
                child: _SummaryCard(
                    label: 'Data In',
                    value: _formatBytes(totalDataIn),
                    color: AppColors.success,
                    icon: Icons.arrow_downward)),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
                child: _SummaryCard(
                    label: 'Data Out',
                    value: _formatBytes(totalDataOut),
                    color: const Color(0xFF5856D6),
                    icon: Icons.arrow_upward)),
          ],
        ),
        if (dailyBreakdown.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.xxl),
          Text('Daily Breakdown', style: AppTypography.title3),
          const SizedBox(height: AppSpacing.md),
          ...dailyBreakdown.map((day) => _DailyBreakdownTile(
                date: day['date'] as String? ?? '',
                value:
                    '${day['sessions'] ?? 0} sessions, ${_formatBytes((day['dataIn'] as int?) ?? 0)} in',
                icon: Icons.wifi,
              )),
        ],
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Revenue Report
  // ---------------------------------------------------------------------------

  Widget _buildRevenueReport(Map<String, dynamic> data) {
    final summary = data['summary'] as Map<String, dynamic>? ?? {};
    final totalVouchers = summary['totalVouchers'] as int? ?? 0;
    final profileBreakdown =
        (data['profileBreakdown'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ??
            [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Summary', style: AppTypography.title3),
        const SizedBox(height: AppSpacing.md),
        _SummaryCard(
          label: 'Total Vouchers',
          value: '$totalVouchers',
          color: AppColors.primary,
          icon: Icons.confirmation_number,
        ),
        if (profileBreakdown.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.xxl),
          Text('Breakdown by Profile', style: AppTypography.title3),
          const SizedBox(height: AppSpacing.md),
          ...profileBreakdown.map((profile) {
            final profileName =
                profile['profileName'] as String? ?? 'Unknown';
            final count = profile['count'] as int? ?? 0;
            final percentage =
                (profile['percentage'] as num?)?.toDouble() ?? 0.0;

            return Card(
              margin: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text(
                            profileName,
                            style: AppTypography.headline.copyWith(fontSize: 15),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.sm,
                            vertical: AppSpacing.xs,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.primaryLight,
                            borderRadius:
                                BorderRadius.circular(AppSpacing.radiusSm),
                          ),
                          child: Text(
                            '$count vouchers',
                            style: AppTypography.caption1.copyWith(
                              color: AppColors.primary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    ClipRRect(
                      borderRadius:
                          BorderRadius.circular(AppSpacing.radiusSm),
                      child: LinearProgressIndicator(
                        value: (percentage / 100).clamp(0.0, 1.0),
                        minHeight: 6,
                        backgroundColor: AppColors.border,
                        valueColor: const AlwaysStoppedAnimation<Color>(
                            AppColors.primary),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      '${percentage.toStringAsFixed(1)}% of total',
                      style: AppTypography.caption1,
                    ),
                  ],
                ),
              ),
            );
          }),
        ],
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Router Uptime Report
  // ---------------------------------------------------------------------------

  Widget _buildRouterUptimeReport(Map<String, dynamic> data) {
    final routers =
        (data['routers'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];

    if (routers.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxxl),
          child: Column(
            children: [
              Icon(Icons.router, size: 48, color: Colors.grey[400]),
              const SizedBox(height: AppSpacing.md),
              Text(
                'No router uptime data available',
                style: AppTypography.subhead
                    .copyWith(color: AppColors.textSecondary),
              ),
            ],
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Router Uptime', style: AppTypography.title3),
        const SizedBox(height: AppSpacing.md),
        ...routers.map((router) {
          final name = router['name'] as String? ?? 'Unknown';
          final status = router['status'] as String? ?? 'offline';
          final uptimePercent =
              (router['uptimePercent'] as num?)?.toDouble() ?? 0.0;
          final totalOnline = router['totalOnlineSeconds'] as int? ?? 0;
          final totalOffline = router['totalOfflineSeconds'] as int? ?? 0;

          Color statusColor;
          switch (status.toLowerCase()) {
            case 'online':
              statusColor = AppColors.online;
              break;
            case 'degraded':
              statusColor = AppColors.degraded;
              break;
            default:
              statusColor = AppColors.offline;
          }

          Color uptimeBarColor;
          if (uptimePercent >= 99) {
            uptimeBarColor = AppColors.success;
          } else if (uptimePercent >= 95) {
            uptimeBarColor = AppColors.warning;
          } else {
            uptimeBarColor = AppColors.error;
          }

          return Card(
            margin: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          color: statusColor,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: Text(
                          name,
                          style:
                              AppTypography.headline.copyWith(fontSize: 15),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(
                        '${uptimePercent.toStringAsFixed(1)}%',
                        style: AppTypography.title3.copyWith(
                          color: uptimeBarColor,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  ClipRRect(
                    borderRadius:
                        BorderRadius.circular(AppSpacing.radiusSm),
                    child: LinearProgressIndicator(
                      value: (uptimePercent / 100).clamp(0.0, 1.0),
                      minHeight: 8,
                      backgroundColor: AppColors.border,
                      valueColor:
                          AlwaysStoppedAnimation<Color>(uptimeBarColor),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Row(
                    children: [
                      _UptimeChip(
                        icon: Icons.arrow_upward,
                        label: 'Online: ${_formatDuration(totalOnline.toDouble())}',
                        color: AppColors.success,
                      ),
                      const SizedBox(width: AppSpacing.md),
                      _UptimeChip(
                        icon: Icons.arrow_downward,
                        label: 'Offline: ${_formatDuration(totalOffline.toDouble())}',
                        color: AppColors.error,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        }),
      ],
    );
  }
}

// =============================================================================
// Reusable private widgets
// =============================================================================

class _SummaryCard extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final IconData icon;

  const _SummaryCard({
    required this.label,
    required this.value,
    required this.color,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 18, color: color),
                const Spacer(),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              value,
              style: AppTypography.title1.copyWith(
                color: color,
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              label,
              style: AppTypography.caption1,
            ),
          ],
        ),
      ),
    );
  }
}

class _DailyBreakdownTile extends StatelessWidget {
  final String date;
  final String value;
  final IconData icon;

  const _DailyBreakdownTile({
    required this.date,
    required this.value,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.textSecondary),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  date,
                  style: AppTypography.subhead
                      .copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 2),
                Text(value, style: AppTypography.footnote),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _UptimeChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;

  const _UptimeChip({
    required this.icon,
    required this.label,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12, color: color),
        const SizedBox(width: AppSpacing.xs),
        Text(
          label,
          style: AppTypography.caption1.copyWith(
            color: AppColors.textSecondary,
          ),
        ),
      ],
    );
  }
}
