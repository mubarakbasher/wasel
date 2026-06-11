import 'package:flutter/material.dart';

/// Wasel palette — refined slate-blue ("Soft UI Evolution").
///
/// Naming contract: constant names are semantic and stable; values may evolve.
/// `secondary` is the CTA accent (orange) and is a FILL color only — never use
/// it for small text or icons on light backgrounds (contrast is below AA).
class AppColors {
  AppColors._();

  // Primary
  static const Color primary = Color(0xFF2563EB);
  static const Color primaryDark = Color(0xFF1D4ED8);
  static const Color primaryLight = Color(0xFFDBEAFE);

  // Secondary — CTA accent (FAB, key actions). Fills only.
  static const Color secondary = Color(0xFFF97316);
  static const Color secondaryDark = Color(0xFFEA580C);
  static const Color secondaryLight = Color(0xFFFFEDD5);

  // Status
  static const Color success = Color(0xFF16A34A);
  static const Color successLight = Color(0xFFDCFCE7);
  static const Color successDark = Color(0xFF166534);
  static const Color warning = Color(0xFFD97706);
  static const Color warningLight = Color(0xFFFEF3C7);
  static const Color warningDark = Color(0xFF92400E);
  static const Color error = Color(0xFFDC2626);
  static const Color errorLight = Color(0xFFFEE2E2);
  static const Color errorDark = Color(0xFF991B1B);
  static const Color info = Color(0xFF0284C7);
  static const Color infoLight = Color(0xFFE0F2FE);
  static const Color infoDark = Color(0xFF075985);

  // Router status
  static const Color online = success;
  static const Color offline = error;
  static const Color degraded = warning;

  // Neutrals (slate)
  static const Color background = Color(0xFFF8FAFC);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceMuted = Color(0xFFF1F5F9);
  static const Color border = Color(0xFFE2E8F0);
  static const Color divider = Color(0xFFE2E8F0);

  // Overlay scrim (slate-900 @ 40%)
  static const Color scrim = Color(0x660F172A);

  // Text (slate)
  static const Color textPrimary = Color(0xFF1E293B);
  static const Color textSecondary = Color(0xFF64748B);
  static const Color textTertiary = Color(0xFF94A3B8);
  static const Color textInverse = Color(0xFFFFFFFF);

  // Voucher status colors
  static const Color voucherActive = success;
  static const Color voucherDisabled = textSecondary;
  static const Color voucherExpired = error;
  static const Color voucherUsed = warning;

  /// Semantic color for a voucher status string.
  static Color voucherStatus(String status) {
    switch (status) {
      case 'unused':
        return primary;
      case 'active':
        return voucherActive;
      case 'used':
        return voucherUsed;
      case 'expired':
        return voucherExpired;
      case 'disabled':
        return voucherDisabled;
      default:
        return textSecondary;
    }
  }

  /// Semantic color for a router status string.
  static Color routerStatus(String status) {
    switch (status) {
      case 'online':
        return online;
      case 'degraded':
        return degraded;
      case 'offline':
        return offline;
      default:
        return textSecondary;
    }
  }
}
