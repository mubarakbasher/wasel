import 'package:flutter/material.dart';
import 'app_colors.dart';

class AppTypography {
  AppTypography._();

  static const TextStyle largeTitle = TextStyle(
    fontSize: 34, fontWeight: FontWeight.w700, letterSpacing: 0.37, color: AppColors.textPrimary,
  );
  static const TextStyle title1 = TextStyle(
    fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: 0.35, color: AppColors.textPrimary,
  );
  static const TextStyle title2 = TextStyle(
    fontSize: 20, fontWeight: FontWeight.w700, letterSpacing: 0.38, color: AppColors.textPrimary,
  );
  static const TextStyle title3 = TextStyle(
    fontSize: 17, fontWeight: FontWeight.w600, letterSpacing: -0.41, color: AppColors.textPrimary,
  );
  static const TextStyle headline = TextStyle(
    fontSize: 17, fontWeight: FontWeight.w600, letterSpacing: -0.41, color: AppColors.textPrimary,
  );
  static const TextStyle body = TextStyle(
    fontSize: 17, fontWeight: FontWeight.w400, letterSpacing: -0.41, color: AppColors.textPrimary,
  );
  static const TextStyle callout = TextStyle(
    fontSize: 16, fontWeight: FontWeight.w400, letterSpacing: -0.32, color: AppColors.textPrimary,
  );
  static const TextStyle subhead = TextStyle(
    fontSize: 15, fontWeight: FontWeight.w400, letterSpacing: -0.24, color: AppColors.textPrimary,
  );
  static const TextStyle footnote = TextStyle(
    fontSize: 13, fontWeight: FontWeight.w400, letterSpacing: -0.08, color: AppColors.textSecondary,
  );
  static const TextStyle caption1 = TextStyle(
    fontSize: 12, fontWeight: FontWeight.w400, letterSpacing: 0.0, color: AppColors.textSecondary,
  );
  static const TextStyle caption2 = TextStyle(
    fontSize: 11, fontWeight: FontWeight.w400, letterSpacing: 0.07, color: AppColors.textTertiary,
  );
}
