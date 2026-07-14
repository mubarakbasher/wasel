import 'package:flutter/material.dart';

/// Returns the localized plan name for the current UI locale.
///
/// Picks [nameAr] when the app is running in Arabic AND [nameAr] is
/// non-null / non-empty; otherwise returns the canonical English [name].
///
/// Locale detection matches the mechanism used throughout the app:
/// `Localizations.localeOf(context).languageCode` so it automatically
/// tracks the live language toggle without requiring a separate provider.
///
/// Usage:
/// ```dart
/// Text(pickPlanName(context, name: plan.name, nameAr: plan.nameAr))
/// Text(pickPlanName(context, name: sub.planName, nameAr: sub.planNameAr))
/// ```
String pickPlanName(
  BuildContext context, {
  required String name,
  String? nameAr,
}) {
  if (nameAr != null &&
      nameAr.isNotEmpty &&
      Localizations.localeOf(context).languageCode == 'ar') {
    return nameAr;
  }
  return name;
}
