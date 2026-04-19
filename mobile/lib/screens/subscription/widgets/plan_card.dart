import 'package:flutter/material.dart';

import '../../../i18n/app_localizations.dart';
import '../../../models/plan.dart';
import '../../../theme/app_colors.dart';
import '../../../theme/app_spacing.dart';
import '../../../theme/app_typography.dart';

class PlanCard extends StatelessWidget {
  final Plan plan;
  final bool isCurrentPlan;
  final bool isLoading;
  final bool hasPendingChange;
  final int selectedDuration;
  final ValueChanged<int> onDurationChanged;
  final VoidCallback? onSelect;

  const PlanCard({
    super.key,
    required this.plan,
    required this.isCurrentPlan,
    required this.isLoading,
    required this.hasPendingChange,
    required this.selectedDuration,
    required this.onDurationChanged,
    this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final isPro = plan.tier == 'professional';

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        border: Border.all(
          color: isPro ? AppColors.primary : AppColors.border,
          width: isPro ? 2 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (isPro)
            Container(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
              decoration: const BoxDecoration(
                color: AppColors.primary,
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(AppSpacing.radiusLg - 1),
                  topRight: Radius.circular(AppSpacing.radiusLg - 1),
                ),
              ),
              child: Text(
                context.tr('subscription.mostPopular'),
                textAlign: TextAlign.center,
                style: AppTypography.caption1.copyWith(
                  color: AppColors.textInverse,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1,
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(plan.name, style: AppTypography.title2),
                    if (isCurrentPlan)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.sm,
                          vertical: AppSpacing.xs,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.successLight,
                          borderRadius:
                              BorderRadius.circular(AppSpacing.radiusSm),
                        ),
                        child: Text(
                          context.tr('subscription.currentPlanLabel'),
                          style: AppTypography.caption1.copyWith(
                            color: AppColors.success,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      plan.totalPriceLabel(
                          context.tr('common.currencySymbol'), selectedDuration),
                      style: AppTypography.largeTitle.copyWith(
                        color: AppColors.primary,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.xs),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text(
                        selectedDuration == 1
                            ? context.tr('subscription.perMonth')
                            : context.tr('subscription.perNMonths',
                                [selectedDuration.toString()]),
                        style: AppTypography.footnote,
                      ),
                    ),
                  ],
                ),
                if (plan.hasMultipleDurations) ...[
                  const SizedBox(height: AppSpacing.md),
                  SegmentedButton<int>(
                    segments: plan.allowedDurations
                        .map((d) => ButtonSegment<int>(
                              value: d,
                              label: Text('$d mo'),
                            ))
                        .toList(),
                    selected: {selectedDuration},
                    onSelectionChanged: (selected) {
                      onDurationChanged(selected.first);
                    },
                    style: SegmentedButton.styleFrom(
                      selectedBackgroundColor:
                          AppColors.primary.withValues(alpha: 0.12),
                      selectedForegroundColor: AppColors.primary,
                    ),
                  ),
                ],
                const SizedBox(height: AppSpacing.lg),
                const Divider(height: 1),
                const SizedBox(height: AppSpacing.lg),
                ...plan.features.map(
                  (feature) => Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                    child: Row(
                      children: [
                        const Icon(Icons.check_circle,
                            size: 18, color: AppColors.success),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: Text(feature, style: AppTypography.subhead),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),
                SizedBox(
                  height: 48,
                  child: isCurrentPlan
                      ? OutlinedButton(
                          onPressed: null,
                          child: Text(context.tr('subscription.currentPlan')),
                        )
                      : ElevatedButton(
                          onPressed: isLoading || hasPendingChange
                              ? null
                              : onSelect,
                          child: isLoading
                              ? const SizedBox(
                                  height: 20,
                                  width: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : Text(
                                  hasPendingChange
                                      ? context.tr('subscription.changePending')
                                      : context.tr('subscription.selectPlan',
                                          [plan.name]),
                                ),
                        ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
