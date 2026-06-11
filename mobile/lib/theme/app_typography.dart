import 'package:flutter/material.dart';
import 'app_colors.dart';

/// Wasel type scale — Cairo (Arabic + Latin) app-wide.
///
/// Cairo's default line box is very tall (it clears Arabic marks), so every
/// style sets an explicit `height`; sizes are 1-2px below the old SF scale to
/// compensate for Cairo's larger x-height. Letter-spacing is 0 everywhere —
/// the previous values were tuned for SF Pro.
///
/// Component roles: card title = [title3], card subtitle = [footnote],
/// badge text = [caption1] at w600, machine strings (voucher codes, MACs,
/// IPs, RouterOS commands) = [mono]/[monoSmall].
class AppTypography {
  AppTypography._();

  static const String fontFamily = 'Cairo';

  static const TextStyle largeTitle = TextStyle(
    fontFamily: fontFamily, fontSize: 28, fontWeight: FontWeight.w700, height: 1.3, letterSpacing: 0, color: AppColors.textPrimary,
  );
  static const TextStyle title1 = TextStyle(
    fontFamily: fontFamily, fontSize: 22, fontWeight: FontWeight.w700, height: 1.3, letterSpacing: 0, color: AppColors.textPrimary,
  );
  static const TextStyle title2 = TextStyle(
    fontFamily: fontFamily, fontSize: 18, fontWeight: FontWeight.w700, height: 1.35, letterSpacing: 0, color: AppColors.textPrimary,
  );
  static const TextStyle title3 = TextStyle(
    fontFamily: fontFamily, fontSize: 16, fontWeight: FontWeight.w600, height: 1.35, letterSpacing: 0, color: AppColors.textPrimary,
  );
  static const TextStyle headline = TextStyle(
    fontFamily: fontFamily, fontSize: 15, fontWeight: FontWeight.w600, height: 1.4, letterSpacing: 0, color: AppColors.textPrimary,
  );
  static const TextStyle body = TextStyle(
    fontFamily: fontFamily, fontSize: 15, fontWeight: FontWeight.w400, height: 1.45, letterSpacing: 0, color: AppColors.textPrimary,
  );
  static const TextStyle callout = TextStyle(
    fontFamily: fontFamily, fontSize: 14, fontWeight: FontWeight.w500, height: 1.4, letterSpacing: 0, color: AppColors.textPrimary,
  );
  static const TextStyle subhead = TextStyle(
    fontFamily: fontFamily, fontSize: 14, fontWeight: FontWeight.w400, height: 1.4, letterSpacing: 0, color: AppColors.textPrimary,
  );
  static const TextStyle footnote = TextStyle(
    fontFamily: fontFamily, fontSize: 13, fontWeight: FontWeight.w400, height: 1.4, letterSpacing: 0, color: AppColors.textSecondary,
  );
  static const TextStyle caption1 = TextStyle(
    fontFamily: fontFamily, fontSize: 12, fontWeight: FontWeight.w400, height: 1.35, letterSpacing: 0, color: AppColors.textSecondary,
  );
  static const TextStyle caption2 = TextStyle(
    fontFamily: fontFamily, fontSize: 11, fontWeight: FontWeight.w500, height: 1.3, letterSpacing: 0, color: AppColors.textTertiary,
  );

  // Machine strings stay monospace by design — unambiguous O/0 for voucher
  // codes, and a deliberate "this is data" affordance for MACs/IPs/commands.
  static const TextStyle mono = TextStyle(
    fontFamily: 'monospace', fontSize: 14, fontWeight: FontWeight.w500, height: 1.4, letterSpacing: 0, color: AppColors.textPrimary,
  );
  static const TextStyle monoSmall = TextStyle(
    fontFamily: 'monospace', fontSize: 12, fontWeight: FontWeight.w400, height: 1.4, letterSpacing: 0, color: AppColors.textPrimary,
  );
}
