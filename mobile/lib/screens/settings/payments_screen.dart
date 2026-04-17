import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../i18n/app_localizations.dart';
import '../../models/payment_record.dart';
import '../../providers/subscription_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class PaymentsScreen extends ConsumerStatefulWidget {
  const PaymentsScreen({super.key});

  @override
  ConsumerState<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends ConsumerState<PaymentsScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(
        () => ref.read(subscriptionProvider.notifier).loadPayments());
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(subscriptionProvider);
    final isLoading = state.isLoadingPayments && state.payments.isEmpty;

    return Scaffold(
      appBar: AppBar(title: Text(context.tr('payments.title'))),
      body: isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: () =>
                  ref.read(subscriptionProvider.notifier).loadPayments(),
              child: state.payments.isEmpty
                  ? _buildEmpty()
                  : ListView.separated(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      itemCount: state.payments.length,
                      separatorBuilder: (_, __) =>
                          const SizedBox(height: AppSpacing.md),
                      itemBuilder: (context, index) {
                        return _PaymentTile(payment: state.payments[index]);
                      },
                    ),
            ),
    );
  }

  Widget _buildEmpty() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        const SizedBox(height: 120),
        Icon(Icons.receipt_long,
            size: 64, color: AppColors.textTertiary),
        const SizedBox(height: AppSpacing.lg),
        Center(
          child: Text(
            context.tr('payments.empty'),
            style: AppTypography.subhead
                .copyWith(color: AppColors.textSecondary),
          ),
        ),
      ],
    );
  }
}

class _PaymentTile extends StatelessWidget {
  final PaymentRecord payment;

  const _PaymentTile({required this.payment});

  @override
  Widget build(BuildContext context) {
    final (statusColor, statusLabel) = switch (payment.status) {
      'approved' => (
          AppColors.success,
          context.tr('payments.statusApproved'),
        ),
      'rejected' => (
          AppColors.error,
          context.tr('payments.statusRejected'),
        ),
      _ => (AppColors.warning, context.tr('payments.statusPending')),
    };

    return Container(
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
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(payment.planName, style: AppTypography.headline),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.sm,
                  vertical: AppSpacing.xs,
                ),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                ),
                child: Text(
                  statusLabel,
                  style: AppTypography.caption1.copyWith(
                    color: statusColor,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Icon(Icons.attach_money,
                  size: 18, color: AppColors.textSecondary),
              const SizedBox(width: AppSpacing.xs),
              Text(
                '${payment.currency} ${payment.amount.toStringAsFixed(2)}',
                style: AppTypography.subhead
                    .copyWith(fontWeight: FontWeight.w600),
              ),
            ],
          ),
          if (payment.referenceCode != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Row(
              children: [
                Icon(Icons.tag, size: 18, color: AppColors.textSecondary),
                const SizedBox(width: AppSpacing.xs),
                Text(
                  payment.referenceCode!,
                  style: AppTypography.subhead.copyWith(
                    fontWeight: FontWeight.w600,
                    color: AppColors.primary,
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: AppSpacing.xs),
          Row(
            children: [
              Icon(Icons.access_time,
                  size: 18, color: AppColors.textSecondary),
              const SizedBox(width: AppSpacing.xs),
              Text(
                _formatDate(payment.createdAt),
                style: AppTypography.footnote
                    .copyWith(color: AppColors.textSecondary),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _formatDate(DateTime d) {
    final local = d.toLocal();
    return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')} '
        '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  }
}
