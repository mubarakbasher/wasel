import 'package:flutter/material.dart';

import '../models/voucher.dart';
import 'app_localizations.dart';

/// Maps a voucher status value to a localized display label.
///
/// Recognised values: active / unused / expired / disabled / used.
/// Unknown values are title-cased as a human-readable fallback.
String localizedVoucherStatus(BuildContext c, String status) {
  final key = switch (status.toLowerCase()) {
    'active' => 'vouchers.active',
    'unused' => 'common.unused',
    'expired' => 'vouchers.expired',
    'disabled' => 'vouchers.disabled',
    'used' => 'vouchers.used',
    _ => null,
  };
  if (key != null) return c.tr(key);
  if (status.isEmpty) return status;
  return status[0].toUpperCase() + status.substring(1);
}

/// Returns a localized, human-readable limit string for [v], or `null` when
/// [v] has no limit type and no meaningful profile name.
///
/// When there is no limit, returns the trimmed [Voucher.profileName] if
/// non-empty, otherwise `null` (useful on print cards where 'Unknown' is
/// unhelpful).
///
/// Replicates the numeric normalization of [Voucher.limitDisplayText] but
/// emits translated unit labels instead of hard-coded English ones.
String? voucherLimitTextOrNull(BuildContext c, Voucher v) {
  if (v.limitType == null || v.limitValue == null || v.limitUnit == null) {
    final name = v.profileName?.trim();
    return (name != null && name.isNotEmpty) ? name : null;
  }

  int displayValue;
  String unitKey;

  switch (v.limitUnit) {
    case 'minutes':
      displayValue = v.limitValue! ~/ 60;
      unitKey = 'vouchers.minutes';
      break;
    case 'hours':
      displayValue = v.limitValue! ~/ 3600;
      unitKey = 'vouchers.hours';
      break;
    case 'days':
      displayValue = v.limitValue! ~/ 86400;
      unitKey = 'vouchers.days';
      break;
    case 'MB':
      displayValue = v.limitValue! ~/ (1024 * 1024);
      unitKey = 'vouchers.unitMb';
      break;
    case 'GB':
      displayValue = v.limitValue! ~/ (1024 * 1024 * 1024);
      unitKey = 'vouchers.unitGb';
      break;
    default:
      displayValue = v.limitValue!;
      unitKey = 'vouchers.unitMb'; // best-effort fallback
  }

  return '$displayValue ${c.tr(unitKey)}';
}

/// Returns a localized, human-readable limit string for [v].
///
/// Delegates to [voucherLimitTextOrNull]; falls back to the localized
/// 'Unknown' string when there is no limit and no profile name.
String voucherLimitText(BuildContext c, Voucher v) =>
    voucherLimitTextOrNull(c, v) ?? c.tr('vouchers.limitUnknown');

/// Returns a localized validity string for [validitySeconds].
///
/// - null or `<= 0` → `'Open'` / `'مفتوح'` (the `vouchers.validityOpen` key)
/// - `< 3600` → `'{n} minutes'` (rounded)
/// - `< 86400` → `'{n} hours'` (rounded)
/// - else      → `'{n} days'`  (rounded)
String voucherValidityText(BuildContext c, int? validitySeconds) {
  if (validitySeconds == null || validitySeconds <= 0) {
    return c.tr('vouchers.validityOpen');
  }
  if (validitySeconds < 3600) {
    return c.tr('vouchers.durationMinutes', [(validitySeconds / 60).round().toString()]);
  }
  if (validitySeconds < 86400) {
    return c.tr('vouchers.durationHours', [(validitySeconds / 3600).round().toString()]);
  }
  return c.tr('vouchers.durationDays', [(validitySeconds / 86400).round().toString()]);
}

/// Returns a localized usage string like "{used} of {limit} used", or null if
/// the voucher has no usage data.
///
/// Replicates [Voucher.usageDisplayText] with localized units.
String? voucherUsageText(BuildContext c, Voucher v) {
  if (v.limitType == null || v.limitValue == null || v.usedValue == null) {
    return null;
  }
  final usedDisplay = _formatValue(c, v.usedValue!, v.limitType!, v.limitUnit);
  final limitDisplay = _formatValue(c, v.limitValue!, v.limitType!, v.limitUnit);
  return c.tr('vouchers.usageOfUsed', [usedDisplay, limitDisplay]);
}

String _formatValue(BuildContext c, int value, String type, String? unit) {
  if (type == 'time') {
    switch (unit) {
      case 'minutes':
        return '${(value / 60).toStringAsFixed(1)} ${c.tr('vouchers.unitMinShort')}';
      case 'hours':
        return '${(value / 3600).toStringAsFixed(1)} ${c.tr('vouchers.unitHrShort')}';
      case 'days':
        return '${(value / 86400).toStringAsFixed(1)} ${c.tr('vouchers.unitDayShort')}';
      default:
        // Auto-format seconds
        if (value < 3600) {
          return '${(value / 60).toStringAsFixed(0)} ${c.tr('vouchers.unitMinShort')}';
        }
        if (value < 86400) {
          return '${(value / 3600).toStringAsFixed(1)} ${c.tr('vouchers.unitHrShort')}';
        }
        return '${(value / 86400).toStringAsFixed(1)} ${c.tr('vouchers.unitDayShort')}';
    }
  } else {
    // data
    switch (unit) {
      case 'MB':
        return '${(value / (1024 * 1024)).toStringAsFixed(1)} ${c.tr('vouchers.unitMb')}';
      case 'GB':
        return '${(value / (1024 * 1024 * 1024)).toStringAsFixed(2)} ${c.tr('vouchers.unitGb')}';
      default:
        if (value < 1024 * 1024) {
          return '${(value / 1024).toStringAsFixed(0)} ${c.tr('vouchers.unitKb')}';
        }
        if (value < 1024 * 1024 * 1024) {
          return '${(value / (1024 * 1024)).toStringAsFixed(1)} ${c.tr('vouchers.unitMb')}';
        }
        return '${(value / (1024 * 1024 * 1024)).toStringAsFixed(2)} ${c.tr('vouchers.unitGb')}';
    }
  }
}
