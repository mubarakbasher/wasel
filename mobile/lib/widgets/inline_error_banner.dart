import 'package:flutter/material.dart';
import '../theme/theme.dart';

/// Inline error banner for forms and auth screens — replaces the hand-rolled
/// red containers. Animates size changes when the message appears/changes.
class InlineErrorBanner extends StatelessWidget {
  const InlineErrorBanner({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return AnimatedSize(
      duration: AppMotion.base,
      curve: AppMotion.curve,
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: AppSpacing.lg),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.errorLight,
          borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.error_outline,
              color: AppColors.error,
              size: 20,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                message,
                style: AppTypography.footnote.copyWith(
                  color: AppColors.errorDark,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
