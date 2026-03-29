import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/subscription.dart';
import '../../providers/subscription_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class SubscriptionStatusScreen extends ConsumerStatefulWidget {
  const SubscriptionStatusScreen({super.key});

  @override
  ConsumerState<SubscriptionStatusScreen> createState() =>
      _SubscriptionStatusScreenState();
}

class _SubscriptionStatusScreenState
    extends ConsumerState<SubscriptionStatusScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(
        () => ref.read(subscriptionProvider.notifier).loadSubscription());
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(subscriptionProvider);
    final sub = state.subscription;

    return Scaffold(
      appBar: AppBar(title: const Text('Subscription')),
      body: state.isLoading && sub == null
          ? const Center(child: CircularProgressIndicator())
          : sub == null
              ? _buildNoSubscription()
              : _buildSubscriptionDetails(sub),
    );
  }

  Widget _buildNoSubscription() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.card_membership,
                size: 64, color: AppColors.textTertiary),
            const SizedBox(height: AppSpacing.lg),
            Text(
              'No Active Subscription',
              style: AppTypography.title2,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Subscribe to a plan to start managing your routers and creating vouchers.',
              style: AppTypography.subhead.copyWith(
                color: AppColors.textSecondary,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xxl),
            SizedBox(
              height: 48,
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => context.push('/subscription/plans'),
                child: const Text('View Plans'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSubscriptionDetails(Subscription sub) {
    final statusColor = _statusColor(sub.status);
    final vouchersRemaining = sub.vouchersRemaining;
    final quotaPercent = sub.voucherQuota == -1
        ? 0.0
        : sub.vouchersUsed / sub.voucherQuota;

    return RefreshIndicator(
      onRefresh: () =>
          ref.read(subscriptionProvider.notifier).loadSubscription(),
      child: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          // Status card
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
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(sub.planName, style: AppTypography.title1),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.sm,
                        vertical: AppSpacing.xs,
                      ),
                      decoration: BoxDecoration(
                        color: statusColor.withValues(alpha: 0.1),
                        borderRadius:
                            BorderRadius.circular(AppSpacing.radiusSm),
                      ),
                      child: Text(
                        sub.status.toString().toUpperCase(),
                        style: AppTypography.caption1.copyWith(
                          color: statusColor,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),
                if (sub.isActive) ...[
                  _InfoRow(
                    label: 'Days Remaining',
                    value: '${sub.daysRemaining} days',
                    icon: Icons.calendar_today,
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],
                _InfoRow(
                  label: 'Start Date',
                  value: _formatDate(sub.startDate),
                  icon: Icons.play_arrow,
                ),
                const SizedBox(height: AppSpacing.md),
                _InfoRow(
                  label: 'End Date',
                  value: _formatDate(sub.endDate),
                  icon: Icons.stop,
                ),
                const SizedBox(height: AppSpacing.md),
                _InfoRow(
                  label: 'Max Routers',
                  value: '${sub.maxRouters}',
                  icon: Icons.router,
                ),
              ],
            ),
          ),

          const SizedBox(height: AppSpacing.lg),

          // Voucher quota card
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
                Text('Voucher Usage', style: AppTypography.title3),
                const SizedBox(height: AppSpacing.lg),
                if (sub.voucherQuota == -1) ...[
                  Row(
                    children: [
                      const Icon(Icons.all_inclusive,
                          color: AppColors.primary, size: 24),
                      const SizedBox(width: AppSpacing.sm),
                      Text(
                        'Unlimited — ${sub.vouchersUsed} used this month',
                        style: AppTypography.body,
                      ),
                    ],
                  ),
                ] else ...[
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '${sub.vouchersUsed} / ${sub.voucherQuota}',
                        style: AppTypography.title2.copyWith(
                          color: AppColors.primary,
                        ),
                      ),
                      Text(
                        vouchersRemaining == 0
                            ? 'Quota reached'
                            : '$vouchersRemaining remaining',
                        style: AppTypography.footnote,
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  ClipRRect(
                    borderRadius:
                        BorderRadius.circular(AppSpacing.radiusSm),
                    child: LinearProgressIndicator(
                      value: quotaPercent.clamp(0.0, 1.0),
                      minHeight: 8,
                      backgroundColor: AppColors.background,
                      valueColor: AlwaysStoppedAnimation(
                        quotaPercent > 0.9
                            ? AppColors.error
                            : quotaPercent > 0.7
                                ? AppColors.warning
                                : AppColors.primary,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),

          const SizedBox(height: AppSpacing.xxl),

          // Actions
          if (sub.isPending)
            SizedBox(
              height: 48,
              child: OutlinedButton.icon(
                onPressed: () => context.push('/subscription/payment'),
                icon: const Icon(Icons.payment),
                label: const Text('View Payment Instructions'),
              ),
            ),
          if (sub.isActive)
            SizedBox(
              height: 48,
              child: OutlinedButton.icon(
                onPressed: () => context.push('/subscription/plans'),
                icon: const Icon(Icons.upgrade),
                label: const Text('Change Plan'),
              ),
            ),
        ],
      ),
    );
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'active':
        return AppColors.success;
      case 'pending':
        return AppColors.warning;
      case 'expired':
        return AppColors.error;
      default:
        return AppColors.textSecondary;
    }
  }

  String _formatDate(DateTime date) {
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
  }
}

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
        Text(label, style: AppTypography.subhead.copyWith(
          color: AppColors.textSecondary,
        )),
        const Spacer(),
        Text(value, style: AppTypography.subhead.copyWith(
          fontWeight: FontWeight.w600,
        )),
      ],
    );
  }
}
