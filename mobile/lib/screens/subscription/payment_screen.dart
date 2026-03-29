import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/subscription_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class PaymentScreen extends ConsumerStatefulWidget {
  const PaymentScreen({super.key});

  @override
  ConsumerState<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends ConsumerState<PaymentScreen> {
  final _receiptController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _receiptSubmitted = false;

  @override
  void dispose() {
    _receiptController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(subscriptionProvider);
    final request = state.lastRequest;
    final sub = state.subscription;

    return Scaffold(
      appBar: AppBar(title: const Text('Payment')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          // Info banner
          Container(
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: BoxDecoration(
              color: AppColors.primaryLight,
              borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
            ),
            child: Row(
              children: [
                const Icon(Icons.info_outline, color: AppColors.primary),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(
                    'Complete a bank transfer using the details below, then upload your receipt.',
                    style: AppTypography.subhead.copyWith(
                      color: AppColors.primaryDark,
                    ),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: AppSpacing.xxl),

          // Payment details card
          Container(
            padding: const EdgeInsets.all(AppSpacing.xl),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Payment Details', style: AppTypography.title3),
                const SizedBox(height: AppSpacing.lg),
                if (sub != null)
                  _DetailRow(label: 'Plan', value: sub.planName),
                if (request != null) ...[
                  const SizedBox(height: AppSpacing.md),
                  _DetailRow(
                    label: 'Amount',
                    value:
                        '${request.currency} ${request.amount.toStringAsFixed(2)}',
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _CopyableRow(
                    label: 'Reference Code',
                    value: request.referenceCode,
                  ),
                ],
                const SizedBox(height: AppSpacing.lg),
                const Divider(height: 1),
                const SizedBox(height: AppSpacing.lg),
                Text('Bank Details', style: AppTypography.headline),
                const SizedBox(height: AppSpacing.md),
                const _DetailRow(label: 'Bank', value: 'Contact admin'),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'Include your reference code in the transfer description.',
                  style: AppTypography.footnote,
                ),
              ],
            ),
          ),

          const SizedBox(height: AppSpacing.xxl),

          // Receipt upload section
          Container(
            padding: const EdgeInsets.all(AppSpacing.xl),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
              border: Border.all(color: AppColors.border),
            ),
            child: _receiptSubmitted
                ? _buildReceiptSuccess()
                : _buildReceiptForm(state),
          ),

          const SizedBox(height: AppSpacing.xxl),

          // Back to subscription
          SizedBox(
            height: 48,
            child: OutlinedButton(
              onPressed: () => context.go('/subscription'),
              child: const Text('Back to Subscription'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildReceiptSuccess() {
    return Column(
      children: [
        const Icon(Icons.check_circle, size: 48, color: AppColors.success),
        const SizedBox(height: AppSpacing.md),
        Text('Receipt Submitted', style: AppTypography.title3),
        const SizedBox(height: AppSpacing.sm),
        Text(
          'Your payment is being reviewed. You will be notified once your subscription is activated.',
          style: AppTypography.subhead.copyWith(
            color: AppColors.textSecondary,
          ),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _buildReceiptForm(SubscriptionState state) {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Upload Receipt', style: AppTypography.title3),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Provide a URL to your payment receipt (e.g., image upload link or screenshot URL).',
            style: AppTypography.footnote,
          ),
          const SizedBox(height: AppSpacing.lg),
          TextFormField(
            controller: _receiptController,
            keyboardType: TextInputType.url,
            textInputAction: TextInputAction.done,
            decoration: const InputDecoration(
              labelText: 'Receipt URL',
              hintText: 'https://...',
              prefixIcon: Icon(Icons.link),
            ),
            validator: (value) {
              if (value == null || value.trim().isEmpty) {
                return 'Receipt URL is required';
              }
              final uri = Uri.tryParse(value.trim());
              if (uri == null || !uri.hasScheme || !uri.hasAuthority) {
                return 'Enter a valid URL';
              }
              return null;
            },
          ),

          if (state.error != null) ...[
            const SizedBox(height: AppSpacing.md),
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.errorLight,
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              ),
              child: Row(
                children: [
                  const Icon(Icons.error_outline,
                      color: AppColors.error, size: 20),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      state.error!,
                      style: AppTypography.footnote.copyWith(
                        color: AppColors.error,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: AppSpacing.lg),
          SizedBox(
            height: 48,
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: state.isLoading ? null : _handleUpload,
              icon: state.isLoading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.upload),
              label: const Text('Submit Receipt'),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _handleUpload() async {
    if (!_formKey.currentState!.validate()) return;

    final request = ref.read(subscriptionProvider).lastRequest;
    if (request == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No pending payment found.')),
      );
      return;
    }

    final success = await ref.read(subscriptionProvider.notifier).uploadReceipt(
          paymentId: request.paymentId,
          receiptUrl: _receiptController.text.trim(),
        );

    if (success && mounted) {
      setState(() => _receiptSubmitted = true);
    }
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;

  const _DetailRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: AppTypography.subhead.copyWith(
          color: AppColors.textSecondary,
        )),
        Text(value, style: AppTypography.subhead.copyWith(
          fontWeight: FontWeight.w600,
        )),
      ],
    );
  }
}

class _CopyableRow extends StatelessWidget {
  final String label;
  final String value;

  const _CopyableRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: AppTypography.subhead.copyWith(
          color: AppColors.textSecondary,
        )),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              value,
              style: AppTypography.subhead.copyWith(
                fontWeight: FontWeight.w700,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(width: AppSpacing.xs),
            GestureDetector(
              onTap: () {
                Clipboard.setData(ClipboardData(text: value));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Reference code copied'),
                    duration: Duration(seconds: 2),
                  ),
                );
              },
              child: const Icon(Icons.copy, size: 18, color: AppColors.primary),
            ),
          ],
        ),
      ],
    );
  }
}
