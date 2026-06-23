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
