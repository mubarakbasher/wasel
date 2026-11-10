import 'package:flutter/material.dart';

import '../i18n/app_localizations.dart';
import '../services/print_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

/// Shared column-count slider used by [VoucherPrintScreen] and
/// [VoucherPrintingScreen].
///
/// Extracted so both screens stay under ~50 lines and the widget can be
/// widget-tested in isolation.
class ColumnSliderBar extends StatelessWidget {
  final int sliderColumns;
  final int voucherCount;
  final ValueChanged<int> onChanged;
  final ValueChanged<int> onChangeEnd;

  const ColumnSliderBar({
    super.key,
    required this.sliderColumns,
    required this.voucherCount,
    required this.onChanged,
    required this.onChangeEnd,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                context.tr('vouchers.columns', [sliderColumns.toString()]),
                style: AppTypography.footnote.copyWith(
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: SliderTheme(
                  data: SliderTheme.of(context).copyWith(
                    trackHeight: 2,
                    thumbShape: const RoundSliderThumbShape(
                      enabledThumbRadius: 8,
                    ),
                  ),
                  child: Slider(
                    value: sliderColumns.toDouble(),
                    min: kMinPrintColumns.toDouble(),
                    max: kMaxPrintColumns.toDouble(),
                    divisions: kMaxPrintColumns - kMinPrintColumns,
                    activeColor: AppColors.primary,
                    onChanged: (v) => onChanged(v.round()),
                    onChangeEnd: (v) => onChangeEnd(v.round()),
                  ),
                ),
              ),
            ],
          ),
          Text(
            context.tr('vouchers.readyToPrint', [voucherCount.toString()]),
            style: AppTypography.footnote.copyWith(
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}
