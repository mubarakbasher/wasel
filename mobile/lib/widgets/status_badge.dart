import 'package:flutter/material.dart';
import '../theme/theme.dart';

/// Unified status badge — light tint background with a dark text shade so the
/// 12px label clears WCAG AA. Pass the semantic status color (e.g.
/// `AppColors.voucherStatus(status)` or `AppColors.routerStatus(status)`).
class StatusBadge extends StatelessWidget {
  const StatusBadge({
    super.key,
    required this.label,
    required this.color,
    this.dot = false,
  });

  final String label;
  final Color color;

  /// Show a small leading dot in the status color.
  final bool dot;

  // Tint/dark pairs for the semantic palette; anything unmapped falls back to
  // a 12% tint of the color itself with the color as text.
  static (Color, Color) _tintsFor(Color color) {
    if (color == AppColors.success) {
      return (AppColors.successLight, AppColors.successDark);
    }
    if (color == AppColors.warning) {
      return (AppColors.warningLight, AppColors.warningDark);
    }
    if (color == AppColors.error) {
      return (AppColors.errorLight, AppColors.errorDark);
    }
    if (color == AppColors.info) {
      return (AppColors.infoLight, AppColors.infoDark);
    }
    if (color == AppColors.primary) {
      return (AppColors.primaryLight, AppColors.primaryDark);
    }
    if (color == AppColors.secondary) {
      return (AppColors.secondaryLight, AppColors.secondaryDark);
    }
    if (color == AppColors.textSecondary) {
      return (AppColors.surfaceMuted, AppColors.textSecondary);
    }
    return (color.withValues(alpha: 0.12), color);
  }

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = _tintsFor(color);

    return Container(
      padding: const EdgeInsetsDirectional.symmetric(
        horizontal: AppSpacing.sm,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(AppSpacing.radiusFull),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot) ...[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: AppSpacing.xs),
          ],
          Text(
            label,
            style: AppTypography.caption1.copyWith(
              color: fg,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
