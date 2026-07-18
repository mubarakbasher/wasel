import 'package:flutter/material.dart';

import 'app_localizations.dart';

/// Returns a localized label for a status string.
///
/// Looks up `'$prefix.$status'` in the translation table.
/// If the key is missing (unknown status), falls back to a title-cased version
/// of the raw status string so the UI always shows something human-readable.
String trStatus(BuildContext c, String prefix, String status) {
  if (status.isEmpty) return status;
  final key = '$prefix.$status';
  final v = c.tr(key);
  return v == key ? status[0].toUpperCase() + status.substring(1) : v;
}

/// Maps a RADIUS terminate-cause value to a localized label.
///
/// Recognised causes are mapped to existing `sessions.*` keys.
/// Unknown causes fall back to [cause] verbatim (preserving the raw RADIUS
/// attribute value for debugging).
String localizedTerminateCause(BuildContext c, String cause) {
  final key = switch (cause) {
    'User-Request' => 'sessions.userRequest',
    'Session-Timeout' => 'sessions.sessionTimeout',
    'Idle-Timeout' => 'sessions.idleTimeout',
    'Admin-Reset' => 'sessions.adminReset',
    'NAS-Reboot' => 'sessions.nasReboot',
    'Port-Error' => 'sessions.portError',
    'Lost-Carrier' => 'sessions.lostCarrier',
    _ => null,
  };
  return key != null ? c.tr(key) : cause;
}

/// Formats [seconds] as a localized duration string using the voucher unit
/// keys (`vouchers.unitMinShort`, `vouchers.unitHrShort`, `vouchers.unitDayShort`).
///
/// - null or 0 → "0s" (bare numeric fallback, no unit key needed)
/// - < 3600    → "{n} min"
/// - < 86400   → "{n}h {m}min"
/// - else      → "{n}d {h}h"
String localizedDuration(BuildContext c, int? seconds) {
  if (seconds == null || seconds == 0) return '0s';
  final h = seconds ~/ 3600;
  final m = (seconds % 3600) ~/ 60;
  final s = seconds % 60;
  if (h == 0 && m == 0) {
    return '${s}s';
  }
  final min = c.tr('vouchers.unitMinShort');
  final hr = c.tr('vouchers.unitHrShort');
  final day = c.tr('vouchers.unitDayShort');
  if (seconds < 3600) {
    return '$m$min ${s}s';
  }
  if (seconds < 86400) {
    return '$h$hr $m$min';
  }
  final d = seconds ~/ 86400;
  final rh = (seconds % 86400) ~/ 3600;
  return '$d$day $rh$hr';
}

/// Formats [bytes] using localized unit keys
/// (`vouchers.unitKb`, `vouchers.unitMb`, `vouchers.unitGb`).
///
/// Falls back to raw bytes with a bare "B" suffix for very small values.
String localizedBytes(BuildContext c, int? bytes) {
  if (bytes == null || bytes == 0) return '0B';
  if (bytes < 1024) return '${bytes}B';
  if (bytes < 1024 * 1024) {
    return '${(bytes / 1024).toStringAsFixed(1)} ${c.tr('vouchers.unitKb')}';
  }
  if (bytes < 1024 * 1024 * 1024) {
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} ${c.tr('vouchers.unitMb')}';
  }
  return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} ${c.tr('vouchers.unitGb')}';
}

/// Formats [amount] as a localized currency string.
///
/// The [code] parameter (e.g. `'SDG'`) is mapped to the `common.currencySymbol`
/// key when the code matches the app's configured symbol; unknown codes are
/// displayed verbatim.  When [code] is omitted the key is always used.
String localizedCurrency(BuildContext c, num amount, [String? code]) {
  final symbol = c.tr('common.currencySymbol');
  final displaySymbol = (code == null || code == 'SDG') ? symbol : code;
  final formatted = amount == amount.roundToDouble()
      ? amount.toStringAsFixed(0)
      : amount.toStringAsFixed(2);
  return '$displaySymbol $formatted';
}
