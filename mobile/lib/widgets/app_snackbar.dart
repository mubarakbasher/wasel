import 'package:flutter/material.dart';
import '../i18n/app_localizations.dart';
import '../theme/theme.dart';

/// The only sanctioned way to show snackbars — colored + iconed per variant
/// so success and error are distinguishable at a glance.
abstract final class AppSnackbar {
  static void success(BuildContext context, String message) =>
      _show(context, message, AppColors.success, Icons.check_circle_outline);

  static void error(BuildContext context, String message) =>
      _show(context, context.trOrRaw(message), AppColors.error, Icons.error_outline);

  static void info(BuildContext context, String message) =>
      _show(context, message, AppColors.textPrimary, Icons.info_outline);

  static void _show(
    BuildContext context,
    String message,
    Color background,
    IconData icon,
  ) {
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        backgroundColor: background,
        duration: const Duration(seconds: 3),
        content: Row(
          children: [
            Icon(icon, color: AppColors.textInverse, size: 20),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                message,
                style: AppTypography.subhead.copyWith(
                  color: AppColors.textInverse,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
