import 'package:flutter/material.dart';

import '../models/plan.dart';
import 'app_localizations.dart';

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

/// Builds the localized feature bullets for a plan from its structured fields,
/// so the list is generated dynamically (nothing stored per-locale).
List<String> buildPlanFeatures(BuildContext context, Plan plan) {
  final out = <String>[];

  // Routers (singular vs plural, both localized)
  out.add(plan.maxRouters == 1
      ? context.tr('subscription.feat.routerOne')
      : context.tr('subscription.feat.routerMany', [plan.maxRouters.toString()]));

  // Vouchers (unlimited vs grouped count)
  out.add(plan.isUnlimitedVouchers
      ? context.tr('subscription.unlimitedVouchers')
      : context.tr('subscription.monthlyVouchers', [_groupThousands(plan.monthlyVouchers)]));

  // Session-monitoring capability (known level -> key; unknown -> raw text)
  if (plan.sessionMonitoring.isNotEmpty) {
    final k = _sessionMonitoringKey(plan.sessionMonitoring);
    out.add(k != null ? context.tr(k) : plan.sessionMonitoring);
  }

  // Dashboard capability
  if (plan.dashboard.isNotEmpty) {
    final k = _dashboardKey(plan.dashboard);
    out.add(k != null ? context.tr(k) : plan.dashboard);
  }

  return out;
}

String _groupThousands(int n) => n
    .toString()
    .replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');

String? _sessionMonitoringKey(String v) {
  switch (v.trim()) {
    case 'Active only':
      return 'subscription.feat.monitoring.active';
    case 'Active + history':
      return 'subscription.feat.monitoring.history';
    case 'Full + export':
      return 'subscription.feat.monitoring.full';
    default:
      return null; // custom text -> raw fallback
  }
}

String? _dashboardKey(String v) {
  switch (v.trim()) {
    case 'Basic stats':
      return 'subscription.feat.dashboard.basic';
    case 'Advanced analytics':
      return 'subscription.feat.dashboard.advanced';
    case 'Full analytics + reports':
      return 'subscription.feat.dashboard.full';
    default:
      return null;
  }
}
