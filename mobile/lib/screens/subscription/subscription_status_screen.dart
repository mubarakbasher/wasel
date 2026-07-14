import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../i18n/app_localizations.dart';
import '../../i18n/plan_format.dart';
import '../../i18n/status_format.dart';
import '../../models/plan.dart';
import '../../models/subscription.dart';
import '../../providers/subscription_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';
import '../../widgets/widgets.dart';
import 'widgets/plan_card.dart';

class SubscriptionStatusScreen extends ConsumerStatefulWidget {
  const SubscriptionStatusScreen({super.key});

  @override
  ConsumerState<SubscriptionStatusScreen> createState() =>
      _SubscriptionStatusScreenState();
}

class _SubscriptionStatusScreenState
    extends ConsumerState<SubscriptionStatusScreen> {
  final Map<String, int> _selectedDurations = {};

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      final notifier = ref.read(subscriptionProvider.notifier);
      await notifier.loadSubscription();
      await notifier.loadPlans();
    });
  }

  int _getDuration(Plan plan) =>
      _selectedDurations[plan.tier] ?? plan.allowedDurations.first;

  Future<void> _refresh() async {
    final notifier = ref.read(subscriptionProvider.notifier);
    await notifier.loadSubscription();
    await notifier.loadPlans();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(subscriptionProvider);
    final sub = state.subscription;
    final pendingChange = state.pendingChange;
    final router = GoRouter.of(context);

    return PopScope(
      canPop: router.canPop(),
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        router.go('/dashboard');
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(context.tr('subscription.title')),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () =>
                router.canPop() ? router.pop() : router.go('/dashboard'),
          ),
        ),
        body: state.isLoading && sub == null && state.plans.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _refresh,
                child: ListView(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  children: [
                    if (sub == null)
                      _buildNoSubscriptionHeader()
                    else
                      ..._buildSubscriptionSections(sub, pendingChange),
                    const SizedBox(height: AppSpacing.xxl),
                    Text(
                      context.tr('subscription.choosePlan'),
                      style: AppTypography.title2,
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    ..._buildPlans(state),
                  ],
                ),
              ),
      ),
    );
  }

  Widget _buildNoSubscriptionHeader() {
    return AppCard(
      color: AppColors.primaryLight,
      child: Row(
        children: [
          const Icon(Icons.card_membership, size: 32, color: AppColors.primary),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  context.tr('subscription.noActiveSubscription'),
                  style:
                      AppTypography.subhead.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  context.tr('subscription.noActiveSubscriptionDesc'),
                  style: AppTypography.footnote
                      .copyWith(color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _buildSubscriptionSections(
      Subscription sub, Subscription? pendingChange) {
    final statusColor = _statusColor(sub.status);
    final vouchersRemaining = sub.vouchersRemaining;
    final quotaPercent =
        sub.voucherQuota == -1 ? 0.0 : sub.vouchersUsed / sub.voucherQuota;

    return [
      AppCard(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  pickPlanName(context,
                      name: sub.planName, nameAr: sub.planNameAr),
                  style: AppTypography.title1,
                ),
                StatusBadge(
                  label: trStatus(context, 'subscription', sub.status.toString()),
                  color: statusColor,
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
            if (sub.isActive) ...[
              _InfoRow(
                label: context.tr('subscription.daysRemainingLabel'),
                value: context.tr(
                    'subscription.daysValue', [sub.daysRemaining.toString()]),
                icon: Icons.calendar_today,
              ),
              const SizedBox(height: AppSpacing.md),
            ],
            _InfoRow(
              label: context.tr('subscription.startDate'),
              value: _formatDate(sub.startDate),
              icon: Icons.play_arrow,
            ),
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
              label: context.tr('subscription.endDate'),
              value: _formatDate(sub.endDate),
              icon: Icons.stop,
            ),
            const SizedBox(height: AppSpacing.md),
            _InfoRow(
              label: context.tr('subscription.maxRoutersLabel'),
              value: '${sub.maxRouters}',
              icon: Icons.router,
            ),
          ],
        ),
      ),
      if (pendingChange != null) ...[
        const SizedBox(height: AppSpacing.lg),
        AppCard(
          color: AppColors.warningLight,
          child: Row(
            children: [
              const Icon(Icons.pending_actions,
                  color: AppColors.warning, size: 24),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      context.tr('subscription.planChangePending'),
                      style: AppTypography.subhead
                          .copyWith(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      context.tr('subscription.upgradePending', [
                        pickPlanName(context,
                            name: pendingChange.planName,
                            nameAr: pendingChange.planNameAr)
                      ]),
                      style: AppTypography.footnote
                          .copyWith(color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
      const SizedBox(height: AppSpacing.lg),
      AppCard(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(context.tr('subscription.voucherUsage'),
                style: AppTypography.title3),
            const SizedBox(height: AppSpacing.lg),
            if (sub.voucherQuota == -1) ...[
              Row(
                children: [
                  const Icon(Icons.all_inclusive,
                      color: AppColors.primary, size: 24),
                  const SizedBox(width: AppSpacing.sm),
                  Text(
                    context.tr('subscription.unlimitedUsed',
                        [sub.vouchersUsed.toString()]),
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
                    style:
                        AppTypography.title2.copyWith(color: AppColors.primary),
                  ),
                  Text(
                    vouchersRemaining == 0
                        ? context.tr('subscription.quotaReached')
                        : context.tr('subscription.remaining',
                            [vouchersRemaining.toString()]),
                    style: AppTypography.footnote,
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              ClipRRect(
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
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
      if (sub.isPending) ...[
        const SizedBox(height: AppSpacing.lg),
        SizedBox(
          height: 48,
          child: OutlinedButton.icon(
            onPressed: () => context.push('/subscription/payment'),
            icon: const Icon(Icons.payment),
            label: Text(context.tr('subscription.viewPaymentInstructions')),
          ),
        ),
      ],
    ];
  }

  List<Widget> _buildPlans(SubscriptionState state) {
    if (state.isLoading && state.plans.isEmpty) {
      return const [
        Padding(
          padding: EdgeInsets.all(AppSpacing.xxl),
          child: Center(child: CircularProgressIndicator()),
        ),
      ];
    }
    if (state.error != null && state.plans.isEmpty) {
      return [
        Padding(
          padding: const EdgeInsets.all(AppSpacing.xxl),
          child: Column(
            children: [
              const Icon(Icons.error_outline,
                  size: 48, color: AppColors.error),
              const SizedBox(height: AppSpacing.lg),
              Text(context.trOrRaw(state.error!),
                  style: AppTypography.body, textAlign: TextAlign.center),
              const SizedBox(height: AppSpacing.lg),
              ElevatedButton(
                onPressed: () =>
                    ref.read(subscriptionProvider.notifier).loadPlans(),
                child: Text(context.tr('common.retry')),
              ),
            ],
          ),
        ),
      ];
    }

    return state.plans.map((plan) {
      final isCurrentPlan = state.subscription?.planTier == plan.tier &&
          state.subscription?.isActive == true;
      final hasPendingChange = state.pendingChange != null;
      return PlanCard(
        plan: plan,
        isCurrentPlan: isCurrentPlan,
        isLoading: state.isLoading,
        hasPendingChange: hasPendingChange,
        selectedDuration: _getDuration(plan),
        onDurationChanged: (duration) {
          setState(() {
            _selectedDurations[plan.tier] = duration;
          });
        },
        onSelect: isCurrentPlan || hasPendingChange
            ? null
            : () => _handleSelectPlan(plan),
      );
    }).toList();
  }

  Future<void> _handleSelectPlan(Plan plan) async {
    final state = ref.read(subscriptionProvider);
    final hasActiveSub = state.subscription?.isActive == true;
    final duration = _getDuration(plan);
    final totalPrice =
        plan.totalPriceLabel(context.tr('common.currencySymbol'), duration);
    final durationLabel = duration == 1
        ? context.tr('subscription.month1')
        : context.tr('subscription.monthsN', [duration.toString()]);

    final localizedPlanName =
        pickPlanName(context, name: plan.name, nameAr: plan.nameAr);

    String action;
    if (hasActiveSub) {
      final tierOrder = ['starter', 'professional', 'enterprise'];
      final currentIndex = tierOrder.indexOf(state.subscription!.planTier);
      final newIndex = tierOrder.indexOf(plan.tier);
      action = newIndex > currentIndex
          ? context.tr('subscription.upgradeTo', [localizedPlanName])
          : context.tr('subscription.downgradeTo', [localizedPlanName]);
    } else {
      action = context.tr('subscription.subscribeTo', [localizedPlanName]);
    }

    final confirmed = await showConfirmDialog(
      context,
      title: action,
      message: context.tr('subscription.confirmBody',
          [localizedPlanName, durationLabel, totalPrice]),
      confirmLabel: context.tr('common.continue_'),
      cancelLabel: context.tr('common.cancel'),
    );

    if (!confirmed || !mounted) return;

    final notifier = ref.read(subscriptionProvider.notifier);
    final bool success;

    if (hasActiveSub) {
      success = await notifier.changeSubscription(
        plan.tier,
        durationMonths: duration,
      );
    } else {
      success = await notifier.requestSubscription(
        plan.tier,
        durationMonths: duration,
      );
    }

    if (success && mounted) {
      context.push('/subscription/payment');
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'active':
        return AppColors.success;
      case 'pending':
      case 'pending_change':
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
        Text(
          label,
          style:
              AppTypography.subhead.copyWith(color: AppColors.textSecondary),
        ),
        const Spacer(),
        Text(
          value,
          style: AppTypography.subhead.copyWith(fontWeight: FontWeight.w600),
        ),
      ],
    );
  }
}
