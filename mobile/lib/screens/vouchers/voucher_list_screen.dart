import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../i18n/app_localizations.dart';
import '../../models/voucher.dart';
import '../../providers/routers_provider.dart';
import '../../providers/subscription_provider.dart';
import '../../providers/vouchers_provider.dart';
import '../../services/voucher_service.dart';
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
  final _scrollController = ScrollController();
  bool _isSelectMode = false;
  bool _isPrintLoading = false;
  final Set<String> _selectedVoucherIds = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _scrollController.addListener(_onScroll);
    Future.microtask(() {
      ref.read(routersProvider.notifier).loadRouters();
    });
    // Auto-select first router when routers load
    Future.microtask(() {
      ref.listenManual(routersProvider, (previous, next) {
        if (_selectedRouterId == null && next.routers.isNotEmpty) {
          _onRouterSelected(next.routers.first.id);
        }
      });
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _scrollController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (_selectedRouterId != null) {
        ref.read(vouchersProvider.notifier).loadVouchers(_selectedRouterId!, refresh: true);
      }
    }
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      if (_selectedRouterId != null) {
        ref.read(vouchersProvider.notifier).loadMore(_selectedRouterId!);
      }
    }
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

  bool _hasActiveSubscription() {
    final sub = ref.read(subscriptionProvider).subscription;
    return sub?.isActive ?? false;
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

  Future<void> _onCreateVoucher() async {
    if (!_hasActiveSubscription()) {
      _showSubscriptionGate();
      return;
    }
    await context.push('/vouchers/create', extra: _selectedRouterId);
    if (mounted && _selectedRouterId != null) {
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

  Future<void> _onDeleteSelected() async {
    final count = _selectedVoucherIds.length;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('vouchers.deleteTitle')),
        content: Text(
          context.tr('vouchers.deleteBody', [count.toString()]),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(context.tr('common.cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(context.tr('common.delete'), style: const TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    final ids = _selectedVoucherIds.toList();
    _exitSelectMode();
    final deleted = await ref.read(vouchersProvider.notifier)
        .bulkDeleteVouchers(_selectedRouterId!, ids);
    if (mounted && deleted != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.tr('vouchers.vouchersDeleted', [deleted.toString()]))),
      );
    }
  }

  Future<void> _onDeleteAll(int total) async {
    final filterLabel = _statusFilter != null ? ' ${_capitalizeStatus(_statusFilter!)}' : '';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('vouchers.deleteAllTitle')),
        content: Text(
          context.tr('vouchers.deleteAllBody', [total.toString(), filterLabel]),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(context.tr('common.cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(context.tr('vouchers.deleteAll'), style: const TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    _exitSelectMode();
    final deleted = await ref.read(vouchersProvider.notifier)
        .deleteAllVouchers(_selectedRouterId!);
    if (mounted && deleted != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.tr('vouchers.vouchersDeleted', [deleted.toString()]))),
      );
    }
  }

  Future<void> _onPrintAll() async {
    final routersState = ref.read(routersProvider);
    final router = routersState.routers
        .where((r) => r.id == _selectedRouterId)
        .firstOrNull;
    final routerName = router?.name ?? 'Wi-Fi';
    final routerId = _selectedRouterId!;

    // Read filter state once before async gap
    final vState = ref.read(vouchersProvider);
    final status = vState.filterStatus;
    final limitType = vState.filterLimitType;
    final search = vState.searchQuery;

    setState(() => _isPrintLoading = true);

    try {
      final service = VoucherService();
      final vouchers = await service.getAllVouchers(
        routerId,
        status: status,
        limitType: limitType,
        search: search,
      );

      if (!mounted) return;
      setState(() => _isPrintLoading = false);

      if (vouchers.isNotEmpty) {
        context.push('/vouchers/print', extra: {
          'vouchers': vouchers,
          'routerName': routerName,
        });
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('vouchers.noVouchersToPrint'))),
        );
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _isPrintLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.tr('vouchers.failedToLoad'))),
      );
    }
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
              title: Text(context.tr('vouchers.selected', [_selectedVoucherIds.length.toString()])),
              actions: [
                TextButton(
                  onPressed: () => _selectAll(vouchersState.vouchers),
                  child: Text(context.tr('vouchers.selectAll')),
                ),
                PopupMenuButton<String>(
                  onSelected: (value) {
                    if (value == 'delete_all') {
                      _onDeleteAll(vouchersState.total);
                    }
                  },
                  itemBuilder: (context) => [
                    PopupMenuItem(
                      value: 'delete_all',
                      child: Text(
                        context.tr('vouchers.deleteAllCount', [vouchersState.total.toString()]),
                        style: const TextStyle(color: Colors.red),
                      ),
                    ),
                  ],
                ),
              ],
            )
          : AppBar(
              title: Text(context.tr('vouchers.title')),
              actions: [
                if (_selectedRouterId != null && vouchersState.total > 0)
                  IconButton(
                    icon: const Icon(Icons.print),
                    tooltip: context.tr('vouchers.printAllCount', [vouchersState.total.toString()]),
                    onPressed: () => _onPrintAll(),
                  ),
                if (_selectedRouterId != null)
                  IconButton(
                    icon: const Icon(Icons.add),
                    onPressed: _onCreateVoucher,
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
                child: Row(
                  children: [
                    Expanded(
                      child: SizedBox(
                        height: 48,
                        child: OutlinedButton.icon(
                          onPressed: () => _onDeleteSelected(),
                          icon: const Icon(Icons.delete, color: Colors.red),
                          label: Text(
                            context.tr('vouchers.deleteSelectedCount', [_selectedVoucherIds.length.toString()]),
                            style: const TextStyle(color: Colors.red),
                          ),
                          style: OutlinedButton.styleFrom(
                            side: const BorderSide(color: Colors.red),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: SizedBox(
                        height: 48,
                        child: ElevatedButton.icon(
                          onPressed: () => _onPrintSelected(vouchersState.vouchers),
                          icon: const Icon(Icons.print),
                          label: Text(context.tr('vouchers.printSelectedCount', [_selectedVoucherIds.length.toString()])),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            )
          : null,
      body: Stack(
        children: [
          Column(
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
                          hintText: context.tr('vouchers.searchHint'),
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
          if (_isPrintLoading)
            Positioned.fill(
              child: Container(
                color: Colors.black54,
                child: const Center(child: CircularProgressIndicator()),
              ),
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
          hint: Text(context.tr('vouchers.selectRouterHint')),
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
        PopupMenuItem(value: null, child: Text(context.tr('common.all'))),
        PopupMenuItem(value: 'unused', child: Text(context.tr('common.unused'))),
        PopupMenuItem(value: 'active', child: Text(context.tr('vouchers.active'))),
        PopupMenuItem(value: 'used', child: Text(context.tr('vouchers.used'))),
        PopupMenuItem(value: 'expired', child: Text(context.tr('vouchers.expired'))),
        PopupMenuItem(value: 'disabled', child: Text(context.tr('vouchers.disabled'))),
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
            Text(context.tr('vouchers.selectRouter'),
                style: AppTypography.title2, textAlign: TextAlign.center),
            const SizedBox(height: AppSpacing.sm),
            Text(
              context.tr('vouchers.chooseRouterAbove'),
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
            Icon(Icons.confirmation_number_outlined,
                size: 64, color: AppColors.textTertiary),
            const SizedBox(height: AppSpacing.lg),
            Text(context.tr('vouchers.noVouchersYet'),
                style: AppTypography.title2, textAlign: TextAlign.center),
            const SizedBox(height: AppSpacing.sm),
            Text(
              context.tr('vouchers.createFirst'),
              style: AppTypography.subhead.copyWith(color: AppColors.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xxl),
            SizedBox(
              height: 48,
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _onCreateVoucher,
                icon: const Icon(Icons.add),
                label: Text(context.tr('vouchers.createVoucher')),
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
        controller: _scrollController,
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: state.vouchers.length + (state.hasMore ? 1 : 0),
        itemBuilder: (context, index) {
          if (index == state.vouchers.length) {
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
              child: Center(child: CircularProgressIndicator()),
            );
          }
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
