import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/voucher.dart';
import '../../providers/routers_provider.dart';
import '../../providers/vouchers_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class VoucherListScreen extends ConsumerStatefulWidget {
  const VoucherListScreen({super.key});

  @override
  ConsumerState<VoucherListScreen> createState() => _VoucherListScreenState();
}

class _VoucherListScreenState extends ConsumerState<VoucherListScreen>
    with WidgetsBindingObserver {
  String? _selectedRouterId;
  String? _statusFilter;
  final _searchController = TextEditingController();
  bool _isSelectMode = false;
  final Set<String> _selectedVoucherIds = {};
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Future.microtask(() {
      ref.read(routersProvider.notifier).loadRouters();
    });
    _startAutoRefresh();
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _searchController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (_selectedRouterId != null) {
        ref.read(vouchersProvider.notifier).loadVouchers(_selectedRouterId!, refresh: true);
      }
      _startAutoRefresh();
    } else if (state == AppLifecycleState.paused) {
      _refreshTimer?.cancel();
    }
  }

  void _startAutoRefresh() {
    _refreshTimer?.cancel();
    _refreshTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_selectedRouterId != null) {
        ref.read(vouchersProvider.notifier).loadVouchers(_selectedRouterId!, refresh: true);
      }
    });
  }

  void _onRouterSelected(String? routerId) {
    setState(() => _selectedRouterId = routerId);
    if (routerId != null) {
      ref.read(vouchersProvider.notifier).loadVouchers(routerId, refresh: true);
    }
  }

  void _onStatusFilterChanged(String? status) {
    setState(() => _statusFilter = status);
    ref.read(vouchersProvider.notifier).setFilter(status: status);
    if (_selectedRouterId != null) {
      ref.read(vouchersProvider.notifier).loadVouchers(_selectedRouterId!, refresh: true);
    }
  }

  void _onSearch(String query) {
    ref.read(vouchersProvider.notifier).setSearch(query.isEmpty ? null : query);
    if (_selectedRouterId != null) {
      ref.read(vouchersProvider.notifier).loadVouchers(_selectedRouterId!, refresh: true);
    }
  }

  void _enterSelectMode(String voucherId) {
    setState(() {
      _isSelectMode = true;
      _selectedVoucherIds.add(voucherId);
    });
  }

  void _exitSelectMode() {
    setState(() {
      _isSelectMode = false;
      _selectedVoucherIds.clear();
    });
  }

  void _toggleVoucherSelection(String voucherId) {
    setState(() {
      if (_selectedVoucherIds.contains(voucherId)) {
        _selectedVoucherIds.remove(voucherId);
        if (_selectedVoucherIds.isEmpty) {
          _isSelectMode = false;
        }
      } else {
        _selectedVoucherIds.add(voucherId);
      }
    });
  }

  void _selectAll(List<Voucher> vouchers) {
    setState(() {
      _selectedVoucherIds.addAll(vouchers.map((v) => v.id));
    });
  }

  void _onPrintSelected(List<Voucher> allVouchers) {
    final selectedVouchers = allVouchers
        .where((v) => _selectedVoucherIds.contains(v.id))
        .toList();

    // Resolve router name for the print screen header
    final routersState = ref.read(routersProvider);
    final router = routersState.routers
        .where((r) => r.id == _selectedRouterId)
        .firstOrNull;
    final routerName = router?.name ?? 'Wi-Fi';

    _exitSelectMode();
    context.push('/vouchers/print', extra: {
      'vouchers': selectedVouchers,
      'routerName': routerName,
    });
  }

  @override
  Widget build(BuildContext context) {
    final routersState = ref.watch(routersProvider);
    final vouchersState = ref.watch(vouchersProvider);

    return Scaffold(
      appBar: _isSelectMode
          ? AppBar(
              leading: IconButton(
                icon: const Icon(Icons.close),
                onPressed: _exitSelectMode,
              ),
              title: Text('${_selectedVoucherIds.length} selected'),
              actions: [
                TextButton(
                  onPressed: () => _selectAll(vouchersState.vouchers),
                  child: const Text('Select All'),
                ),
              ],
            )
          : AppBar(
              title: const Text('Vouchers'),
              actions: [
                if (_selectedRouterId != null)
                  IconButton(
                    icon: const Icon(Icons.add),
                    onPressed: () async {
                      await context.push(
                        '/vouchers/create',
                        extra: _selectedRouterId,
                      );
                      if (mounted && _selectedRouterId != null) {
                        ref.read(vouchersProvider.notifier).loadVouchers(_selectedRouterId!, refresh: true);
                      }
                    },
                  ),
              ],
            ),
      bottomNavigationBar: _isSelectMode && _selectedVoucherIds.isNotEmpty
          ? SafeArea(
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.lg,
                  vertical: AppSpacing.sm,
                ),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  border: Border(
                    top: BorderSide(color: AppColors.border),
                  ),
                ),
                child: SizedBox(
                  height: 48,
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () => _onPrintSelected(vouchersState.vouchers),
                    icon: const Icon(Icons.print),
                    label: Text('Print (${_selectedVoucherIds.length})'),
                  ),
                ),
              ),
            )
          : null,
      body: Column(
        children: [
          // Router selector
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, 0,
            ),
            child: _buildRouterDropdown(routersState),
          ),
          // Search + filter row
          if (_selectedRouterId != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, 0,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: SizedBox(
                      height: 40,
                      child: TextField(
                        controller: _searchController,
                        decoration: InputDecoration(
                          hintText: 'Search voucher code...',
                          prefixIcon: const Icon(Icons.search, size: 20),
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.md,
                          ),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                          ),
                          isDense: true,
                        ),
                        style: AppTypography.subhead,
                        onSubmitted: _onSearch,
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  _buildStatusFilterChip(),
                ],
              ),
            ),
          const SizedBox(height: AppSpacing.sm),
          // Voucher list
          Expanded(
            child: _selectedRouterId == null
                ? _buildSelectRouterPrompt()
                : vouchersState.isLoading && vouchersState.vouchers.isEmpty
                    ? const Center(child: CircularProgressIndicator())
                    : vouchersState.error != null && vouchersState.vouchers.isEmpty
                        ? _buildError(vouchersState.error!)
                        : vouchersState.vouchers.isEmpty
                            ? _buildEmpty()
                            : _buildList(vouchersState),
          ),
        ],
      ),
    );
  }

  Widget _buildRouterDropdown(RoutersState routersState) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.border),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: _selectedRouterId,
          hint: const Text('Select a router'),
          isExpanded: true,
          items: routersState.routers.map((router) {
            return DropdownMenuItem(
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
          }).toList(),
          onChanged: _onRouterSelected,
        ),
      ),
    );
  }

  Widget _buildStatusFilterChip() {
    return PopupMenuButton<String?>(
      onSelected: _onStatusFilterChanged,
      itemBuilder: (context) => [
        const PopupMenuItem(value: null, child: Text('All')),
        const PopupMenuItem(value: 'unused', child: Text('Unused')),
        const PopupMenuItem(value: 'active', child: Text('Active')),
        const PopupMenuItem(value: 'used', child: Text('Used')),
        const PopupMenuItem(value: 'expired', child: Text('Expired')),
        const PopupMenuItem(value: 'disabled', child: Text('Disabled')),
      ],
      child: Container(
        height: 40,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
        decoration: BoxDecoration(
          color: _statusFilter != null ? AppColors.primaryLight : AppColors.surface,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(
            color: _statusFilter != null ? AppColors.primary : AppColors.border,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.filter_list,
              size: 18,
              color: _statusFilter != null ? AppColors.primary : AppColors.textSecondary,
            ),
            if (_statusFilter != null) ...[
              const SizedBox(width: AppSpacing.xs),
              Text(
                _capitalizeStatus(_statusFilter!),
                style: AppTypography.caption1.copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildSelectRouterPrompt() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.router, size: 64, color: AppColors.textTertiary),
            const SizedBox(height: AppSpacing.lg),
            Text('Select a Router',
                style: AppTypography.title2, textAlign: TextAlign.center),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Choose a router above to view its vouchers.',
              style: AppTypography.subhead.copyWith(color: AppColors.textSecondary),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
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
                onPressed: () => ref
                    .read(vouchersProvider.notifier)
                    .loadVouchers(_selectedRouterId!, refresh: true),
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
            Icon(Icons.confirmation_number_outlined,
                size: 64, color: AppColors.textTertiary),
            const SizedBox(height: AppSpacing.lg),
            Text('No Vouchers Yet',
                style: AppTypography.title2, textAlign: TextAlign.center),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Create your first voucher for this router.',
              style: AppTypography.subhead.copyWith(color: AppColors.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xxl),
            SizedBox(
              height: 48,
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () async {
                  await context.push(
                    '/vouchers/create',
                    extra: _selectedRouterId,
                  );
                  if (mounted && _selectedRouterId != null) {
                    ref.read(vouchersProvider.notifier).loadVouchers(_selectedRouterId!, refresh: true);
                  }
                },
                icon: const Icon(Icons.add),
                label: const Text('Create Voucher'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildList(VouchersState state) {
    return RefreshIndicator(
      onRefresh: () => ref
          .read(vouchersProvider.notifier)
          .loadVouchers(_selectedRouterId!, refresh: true),
      child: ListView.builder(
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: state.vouchers.length,
        itemBuilder: (context, index) {
          final voucher = state.vouchers[index];
          return _VoucherCard(
            voucher: voucher,
            isSelectMode: _isSelectMode,
            isSelected: _selectedVoucherIds.contains(voucher.id),
            onTap: _isSelectMode
                ? () => _toggleVoucherSelection(voucher.id)
                : () async {
                    await context.push(
                      '/vouchers/detail',
                      extra: {'routerId': _selectedRouterId!, 'voucherId': voucher.id},
                    );
                    if (mounted && _selectedRouterId != null) {
                      ref.read(vouchersProvider.notifier).loadVouchers(_selectedRouterId!, refresh: true);
                    }
                  },
            onLongPress: () {
              if (!_isSelectMode) {
                _enterSelectMode(voucher.id);
              }
            },
          );
        },
      ),
    );
  }

  String _capitalizeStatus(String status) {
    if (status.isEmpty) return status;
    return status[0].toUpperCase() + status.substring(1);
  }
}

class _VoucherCard extends StatelessWidget {
  final Voucher voucher;
  final VoidCallback onTap;
  final VoidCallback onLongPress;
  final bool isSelectMode;
  final bool isSelected;

  const _VoucherCard({
    required this.voucher,
    required this.onTap,
    required this.onLongPress,
    this.isSelectMode = false,
    this.isSelected = false,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            if (isSelectMode)
              Padding(
                padding: const EdgeInsets.only(right: AppSpacing.sm),
                child: Checkbox(
                  value: isSelected,
                  onChanged: (_) => onTap(),
                  activeColor: AppColors.primary,
                ),
              ),
            Expanded(
              child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    voucher.username,
                    style: AppTypography.title3.copyWith(
                      fontFamily: 'monospace',
                    ),
                  ),
                ),
                _StatusBadge(status: voucher.status),
              ],
            ),
            const SizedBox(height: AppSpacing.xs),
            Row(
              children: [
                Icon(Icons.layers, size: 14, color: AppColors.textSecondary),
                const SizedBox(width: AppSpacing.xs),
                Text(
                  voucher.limitDisplayText,
                  style: AppTypography.footnote,
                ),
                const Spacer(),
                Text(
                  _formatDate(voucher.createdAt),
                  style: AppTypography.caption1,
                ),
              ],
            ),
            if (voucher.usagePercent != null) ...[
              const SizedBox(height: AppSpacing.xs),
              Row(
                children: [
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(2),
                      child: LinearProgressIndicator(
                        value: voucher.usagePercent!,
                        minHeight: 4,
                        backgroundColor: AppColors.border,
                        valueColor: AlwaysStoppedAnimation<Color>(
                          voucher.usagePercent! >= 1.0
                              ? AppColors.error
                              : voucher.usagePercent! > 0.8
                                  ? AppColors.warning
                                  : AppColors.primary,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Text(
                    '${(voucher.usagePercent! * 100).toStringAsFixed(0)}%',
                    style: AppTypography.caption2,
                  ),
                ],
              ),
            ],
            if (voucher.comment != null && voucher.comment!.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.xs),
              Text(
                voucher.comment!,
                style: AppTypography.caption1.copyWith(
                  fontStyle: FontStyle.italic,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ],
        ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatDate(DateTime date) {
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
  }
}

class _StatusBadge extends StatelessWidget {
  final String status;

  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: _statusColor(status).withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      ),
      child: Text(
        _capitalizeStatus(status),
        style: AppTypography.caption1.copyWith(
          color: _statusColor(status),
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'unused':
        return AppColors.primary;
      case 'active':
        return AppColors.voucherActive;
      case 'used':
        return AppColors.voucherUsed;
      case 'expired':
        return AppColors.voucherExpired;
      case 'disabled':
        return AppColors.voucherDisabled;
      default:
        return AppColors.textSecondary;
    }
  }

  String _capitalizeStatus(String status) {
    if (status.isEmpty) return status;
    return status[0].toUpperCase() + status.substring(1);
  }
}
