// mobile/lib/services/print/template_registry.dart

import 'package:wasel/models/print_settings.dart';
import 'card_template.dart';
import 'templates/classic_template.dart';
import 'templates/detailed_template.dart';
import 'templates/strips_template.dart';

const List<VoucherCardTemplate> _all = [
  ClassicTemplate(),
  DetailedTemplate(),
  StripsTemplate(),
];

/// All registered templates, in display order.
List<VoucherCardTemplate> get allTemplates => _all;

/// Returns the template for [id]. Always succeeds (falls back to Classic).
VoucherCardTemplate templateFor(VoucherTemplateId id) {
  for (final t in _all) {
    if (t.id == id) return t;
  }
  return const ClassicTemplate();
}
