import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

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

  Future<void> _resubmitReceipt(PaymentRecord payment) async {
    final source = await _showSourcePicker();
    if (source == null || !mounted) return;

    final picker = ImagePicker();
    final XFile? picked = await picker.pickImage(
      source: source,
      maxWidth: 2000,
      imageQuality: 85,
    );
    if (picked == null || !mounted) return;

    final success = await ref
        .read(subscriptionProvider.notifier)
        .resubmitReceipt(paymentId: payment.id, file: File(picked.path));

    if (!mounted) return;
    if (success) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.tr('payments.resubmitSuccess'))),
      );
    } else {
      final error = ref.read(subscriptionProvider).error;
      if (error != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error)),
        );
      }
    }
  }

  Future<ImageSource?> _showSourcePicker() {
    return showModalBottomSheet<ImageSource>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt, color: AppColors.primary),
              title: Text(context.tr('payment.takePhoto')),
              onTap: () => Navigator.pop(ctx, ImageSource.camera),
            ),
            ListTile(
              leading:
                  const Icon(Icons.photo_library, color: AppColors.primary),
              title: Text(context.tr('payment.pickFromGallery')),
              onTap: () => Navigator.pop(ctx, ImageSource.gallery),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
        ),
      ),
    );
  }

  Future<void> _cancelPayment(PaymentRecord payment) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(context.tr('payments.cancelConfirmTitle')),
        content: Text(context.tr('payments.cancelConfirmBody')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(context.tr('payments.keepPayment')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.error),
            child: Text(context.tr('payments.cancelConfirmAction')),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    final success = await ref
        .read(subscriptionProvider.notifier)
        .cancelPayment(payment.id);

    if (!mounted) return;
    if (!success) {
      final error = ref.read(subscriptionProvider).error;
      if (error != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error)),
        );
      }
    }
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
                        final payment = state.payments[index];
                        return _PaymentTile(
                          payment: payment,
                          busy: state.isLoading,
                          onResubmit: () => _resubmitReceipt(payment),
                          onCancel: () => _cancelPayment(payment),
                        );
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
        Icon(Icons.receipt_long, size: 64, color: AppColors.textTertiary),
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
  final bool busy;
  final VoidCallback onResubmit;
  final VoidCallback onCancel;

  const _PaymentTile({
    required this.payment,
    required this.busy,
    required this.onResubmit,
    required this.onCancel,
  });

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
      'cancelled' => (
          AppColors.textSecondary,
          context.tr('payments.statusCancelled'),
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
          if (payment.isRejected) ...[
            const SizedBox(height: AppSpacing.md),
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.error.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                border: Border.all(
                    color: AppColors.error.withValues(alpha: 0.25)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.info_outline,
                          size: 18, color: AppColors.error),
                      const SizedBox(width: AppSpacing.xs),
                      Text(
                        context.tr('payments.rejectionReasonLabel'),
                        style: AppTypography.footnote.copyWith(
                          color: AppColors.error,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    payment.rejectionReason ?? '',
                    style: AppTypography.footnote
                        .copyWith(color: AppColors.textPrimary),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: busy ? null : onCancel,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.error,
                      side: BorderSide(color: AppColors.error),
                    ),
                    icon: const Icon(Icons.close, size: 18),
                    label: Text(context.tr('payments.cancelAndSwitchPlan')),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: busy ? null : onResubmit,
                    icon: const Icon(Icons.upload_file, size: 18),
                    label: Text(context.tr('payments.resubmitReceipt')),
                  ),
                ),
              ],
            ),
          ],
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
