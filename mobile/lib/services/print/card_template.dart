// mobile/lib/services/print/card_template.dart
//
// Abstract contract and context types for voucher card templates.

import 'package:pdf/widgets.dart' as pw;
import 'package:wasel/models/print_settings.dart';
import 'grid_layout.dart';

// ---------------------------------------------------------------------------
// CardContext — data passed to buildCard
// ---------------------------------------------------------------------------

/// Runtime context available to every template's [VoucherCardTemplate.buildCard].
class CardContext {
  /// The voucher data to render.
  final VoucherCardItem item;

  /// Typography and knob state shared across the page.
  final PrintStyle style;

  /// Allocated card width in points.
  final double w;

  /// Allocated card height in points.
  final double h;

  /// Column count for the current page (drives CardMetrics).
  final int columns;

  const CardContext({
    required this.item,
    required this.style,
    required this.w,
    required this.h,
    required this.columns,
  });
}

// ---------------------------------------------------------------------------
// VoucherCardItem — slim voucher data view for the template engine
// ---------------------------------------------------------------------------

/// Slim voucher data the template engine needs to draw one card.
/// Richer than the old VoucherPrintItem — optional fields are null-safe.
class VoucherCardItem {
  final String code;
  final String? limitText;
  final String validityText;
  final String? priceText;
  final String? batchLabel;

  const VoucherCardItem({
    required this.code,
    this.limitText,
    required this.validityText,
    this.priceText,
    this.batchLabel,
  });
}

// ---------------------------------------------------------------------------
// PrintStyle — resolved fonts + knobs
// ---------------------------------------------------------------------------

/// Resolved print style: fonts loaded from assets + operator knobs.
class PrintStyle {
  /// The operator's business / router name, used as the fallback header.
  final String businessName;

  final PrintKnobs knobs;

  /// Cairo regular.
  final pw.Font cairo;

  /// Cairo bold.
  final pw.Font cairoBold;

  /// Localized default footer / how-to string (resolved on the UI thread
  /// before the isolate is spawned, since the isolate has no BuildContext).
  final String howToDefault;

  const PrintStyle({
    required this.businessName,
    required this.knobs,
    required this.cairo,
    required this.cairoBold,
    this.howToDefault = '',
  });

  /// Resolved header text: knob override or business name.
  String get headerText =>
      knobs.headerText.isEmpty ? businessName : knobs.headerText;

  /// Resolved footer text: knob override or localized default.
  String get footerText =>
      knobs.footerText.isEmpty ? howToDefault : knobs.footerText;

  /// Arabic-aware text direction for a string.
  pw.TextDirection direction(String s) {
    final arabic =
        RegExp(r'[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]');
    return arabic.hasMatch(s) ? pw.TextDirection.rtl : pw.TextDirection.ltr;
  }
}

// ---------------------------------------------------------------------------
// VoucherCardTemplate — abstract strategy
// ---------------------------------------------------------------------------

abstract class VoucherCardTemplate {
  const VoucherCardTemplate();

  VoucherTemplateId get id;

  /// Compute the grid layout for a page with [columns] columns.
  /// Override in templates that use a different layout (e.g. Strips).
  VoucherGridLayout layoutFor(int columns, PrintKnobs knobs) =>
      voucherGridLayoutFor(columns);

  /// Build one card widget for the given [ctx].
  pw.Widget buildCard(CardContext ctx);
}
