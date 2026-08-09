import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../i18n/app_localizations.dart';
import '../../models/voucher_batch.dart';
import '../../providers/routers_provider.dart';
import '../../providers/voucher_batches_provider.dart';
import '../../services/voucher_service.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';
import '../../widgets/widgets.dart';

class VoucherBatchHistoryScreen extends ConsumerStatefulWidget {
  final String routerId;

  const VoucherBatchHistoryScreen({super.key, required this.routerId});

  @override
  ConsumerState<VoucherBatchHistoryScreen> createState() =>
      _VoucherBatchHistoryScreenState();
}

class _VoucherBatchHistoryScreenState
    extends ConsumerState<VoucherBatchHistoryScreen> {
  bool _isPrintLoading = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      if (!mounted) return;
      // Load routers if empty so router name can be resolved for print.
      final routersState = ref.read(routersProvider);
      if (routersState.routers.isEmpty) {
        ref.read(routersProvider.notifier).loadRouters();
      }
      // Load the batches list.
      ref.read(voucherBatchesProvider.notifier).load(widget.routerId);
    });
  }

  Future<void> _onPrintBatch(VoucherBatch batch) async {
    setState(() => _isPrintLoading = true);
    try {
      final service = VoucherService();
      final vouchers = await service.getAllVouchers(
        widget.routerId,
        batch: batch.batchKey,
      );

      if (!mounted) return;
      setState(() => _isPrintLoading = false);

      if (vouchers.isEmpty) {
        AppSnackbar.info(context, context.tr('vouchers.noVouchersToPrint'));
        return;
      }

      // Resolve router name
      final routersState = ref.read(routersProvider);
      final router = routersState.routers
          .where((r) => r.id == widget.routerId)
          .firstOrNull;
      final routerName =
          router?.name ?? context.tr('routers.defaultRouterName');

      context.push('/vouchers/print', extra: {
        'vouchers': vouchers,
        'routerName': routerName,
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _isPrintLoading = false);
      AppSnackbar.error(context, context.tr('vouchers.failedToLoad'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final batchesState = ref.watch(voucherBatchesProvider);
    final routerName = ref
        .watch(routersProvider)
        .routers
        .where((r) => r.id == widget.routerId)
        .firstOrNull
        ?.name;

    return Scaffold(
      appBar: AppBar(
        title: _AppBarTitle(
          routerName: routerName,
          mainTitle: context.tr('vouchers.batchHistory'),
        ),
      ),
      body: Stack(
        children: [
          _buildBody(batchesState, routerName),
          if (_isPrintLoading)
            Positioned.fill(
              child: Container(
                color: AppColors.scrim,
                child: const Center(child: CircularProgressIndicator()),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildBody(VoucherBatchesState batchesState, String? routerName) {
    if (batchesState.isLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (batchesState.error != null && batchesState.batches.isEmpty) {
      return ErrorState(
        message: batchesState.error!,
        onRetry: () =>
            ref.read(voucherBatchesProvider.notifier).load(widget.routerId),
        retryLabel: context.tr('common.retry'),
      );
    }
    if (batchesState.batches.isEmpty) {
      return EmptyState(
        icon: Icons.history,
        title: context.tr('vouchers.noBatches'),
        message: routerName != null
            ? context.tr('vouchers.noBatchesForRouter', [routerName])
            : '',
      );
    }
    return RefreshIndicator(
      onRefresh: () =>
          ref.read(voucherBatchesProvider.notifier).load(widget.routerId),
      child: ListView.builder(
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: batchesState.batches.length,
        itemBuilder: (context, index) {
          final batch = batchesState.batches[index];
          return _BatchCard(
            batch: batch,
            onPrint: () => _onPrintBatch(batch),
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Two-line AppBar title: main title + optional router name subtitle.
// ---------------------------------------------------------------------------

class _AppBarTitle extends StatelessWidget {
  final String mainTitle;
  final String? routerName;

  const _AppBarTitle({required this.mainTitle, this.routerName});

  @override
  Widget build(BuildContext context) {
    if (routerName == null) {
      return Text(mainTitle);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(mainTitle),
        Text(
          routerName!,
          style: AppTypography.caption1.copyWith(
            color: AppColors.textInverse.withValues(alpha: 0.75),
          ),
        ),
      ],
    );
  }
}

class _BatchCard extends StatelessWidget {
  final VoucherBatch batch;
  final VoidCallback onPrint;

  const _BatchCard({required this.batch, required this.onPrint});

  @override
  Widget build(BuildContext context) {
    final d = batch.createdAt.toLocal();
    final dateLabel =
        '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')} '
        '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

    final limitLabel = batch.limitDisplayText;
    final detailParts = <String>[
      context.tr('vouchers.batchCount', [batch.count.toString()]),
      if (limitLabel.isNotEmpty) limitLabel,
      if (batch.price != null) '${batch.price}',
    ];

    return AppCard(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  dateLabel,
                  style: AppTypography.subhead
                      .copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  detailParts.join(' · '),
                  style: AppTypography.footnote.copyWith(
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          ElevatedButton(
            onPressed: onPrint,
            child: Text(context.tr('vouchers.printVouchers')),
          ),
        ],
      ),
    );
  }
}
