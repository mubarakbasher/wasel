import 'dart:typed_data';

import 'package:flutter/foundation.dart' show compute;
import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

// Re-export grid helpers so existing callers keep working unchanged.
export 'print/grid_layout.dart'
    show
        VoucherGridLayout,
        voucherGridLayoutFor,
        voucherPdfPageCount,
        voucherCardPadding,
        voucherCodeLetterSpacing,
        kMinPrintColumns,
        kMaxPrintColumns;

import 'print/grid_layout.dart';
import 'print/card_template.dart';
import 'print/template_registry.dart';
import '../models/print_settings.dart';

// ---------------------------------------------------------------------------
// VoucherPrintItem — public DTO
// ---------------------------------------------------------------------------

/// Immutable data transfer object passed to [PrintService.generateVouchersPdf].
class VoucherPrintItem {
  final String code;

  /// Localized limit string; `null` omits the cell and its separator.
  final String? limitText;

  /// Localized validity string.
  final String validityText;

  /// Optional localized price string (e.g. "10 USD"). Shown when knob
  /// `showPrice` is true. If null, the price line/pill is hidden regardless
  /// of the knob.
  final String? priceText;

  /// Optional batch label derived from `createdAt` (e.g. "261101-1430").
  final String? batchLabel;

  const VoucherPrintItem({
    required this.code,
    this.limitText,
    required this.validityText,
    this.priceText,
    this.batchLabel,
  });
}

// ---------------------------------------------------------------------------
// VoucherPdfJob — plain-data job for compute()
// ---------------------------------------------------------------------------

/// Plain-data job passed to [compute] for isolate-offloaded PDF generation.
class VoucherPdfJob {
  final List<VoucherPrintItem> items;
  final String businessName;
  final int columns;
  final Uint8List cairoRegular;
  final Uint8List cairoBold;

  /// Optional PDF document title.
  final String? docTitle;

  /// Wire name of the template to use ('classic' | 'detailed' | 'strips').
  final String templateId;

  /// Raw knob values; parsed into [PrintKnobs] inside the isolate.
  final Map<String, dynamic> knobs;

  /// Localized default footer / how-to string.
  final String howToDefault;

  const VoucherPdfJob({
    required this.items,
    required this.businessName,
    required this.columns,
    required this.cairoRegular,
    required this.cairoBold,
    this.docTitle,
    this.templateId = 'classic',
    this.knobs = const {},
    this.howToDefault = '',
  });
}

// ---------------------------------------------------------------------------
// Top-level entry point for compute()
// ---------------------------------------------------------------------------

/// Top-level entry point for [compute] — must be a top-level function.
Future<Uint8List> buildVouchersPdfJob(VoucherPdfJob job) {
  final cairo = pw.Font.ttf(job.cairoRegular.buffer.asByteData(
    job.cairoRegular.offsetInBytes,
    job.cairoRegular.lengthInBytes,
  ));
  final cairoBold = pw.Font.ttf(job.cairoBold.buffer.asByteData(
    job.cairoBold.offsetInBytes,
    job.cairoBold.lengthInBytes,
  ));

  final knobs = PrintKnobs.fromJson(job.knobs);
  final templateId = VoucherTemplateId.fromWire(job.templateId);
  final template = templateFor(templateId);

  final style = PrintStyle(
    businessName: job.businessName,
    knobs: knobs,
    cairo: cairo,
    cairoBold: cairoBold,
    howToDefault: job.howToDefault,
  );

  final builder = _VouchersPdfBuilder(template: template, style: style);
  return builder.build(
    job.items,
    columns: job.columns,
    docTitle: job.docTitle,
    knobs: knobs,
  );
}

// ---------------------------------------------------------------------------
// SampleCardJob — single-card thumbnail PDF for compute()
// ---------------------------------------------------------------------------

/// Plain-data job for rendering one voucher card as its own tiny PDF page.
/// Used by [DefaultThumbnailRenderer] to produce crisp template thumbnails.
class SampleCardJob {
  final VoucherPrintItem item;
  final String businessName;
  final Uint8List cairoRegular;
  final Uint8List cairoBold;
  final String templateId;
  final Map<String, dynamic> knobs;
  final String howToDefault;

  const SampleCardJob({
    required this.item,
    required this.businessName,
    required this.cairoRegular,
    required this.cairoBold,
    this.templateId = 'classic',
    this.knobs = const {},
    this.howToDefault = '',
  });
}

/// Top-level entry point for [compute] — builds a single-page PDF whose page
/// dimensions equal the card itself plus a 4-point margin on all sides.
Future<Uint8List> buildSampleCardJob(SampleCardJob job) async {
  final cairo = pw.Font.ttf(job.cairoRegular.buffer.asByteData(
    job.cairoRegular.offsetInBytes,
    job.cairoRegular.lengthInBytes,
  ));
  final cairoBold = pw.Font.ttf(job.cairoBold.buffer.asByteData(
    job.cairoBold.offsetInBytes,
    job.cairoBold.lengthInBytes,
  ));

  final knobs = PrintKnobs.fromJson(job.knobs);
  final templateId = VoucherTemplateId.fromWire(job.templateId);
  final template = templateFor(templateId);

  // Use 2 columns for Classic/Detailed; Strips uses its own layoutFor.
  const int thumbColumns = 2;
  final layout = template.layoutFor(thumbColumns, knobs);
  final double cardW = layout.cardW;
  final double cardH = layout.cardH;

  const double margin = 4;
  final pageFormat = PdfPageFormat(
    cardW + margin * 2,
    cardH + margin * 2,
    marginAll: margin,
  );

  final style = PrintStyle(
    businessName: job.businessName,
    knobs: knobs,
    cairo: cairo,
    cairoBold: cairoBold,
    howToDefault: job.howToDefault,
  );

  final ctx = CardContext(
    item: VoucherCardItem(
      code: job.item.code,
      limitText: job.item.limitText,
      validityText: job.item.validityText,
      priceText: job.item.priceText,
      batchLabel: job.item.batchLabel,
    ),
    style: style,
    w: cardW,
    h: cardH,
    columns: layout.columns,
  );

  final doc = pw.Document(title: 'Wasel Card Sample', author: 'Wasel');
  doc.addPage(
    pw.Page(
      pageFormat: pageFormat,
      build: (_) => template.buildCard(ctx),
    ),
  );

  return doc.save();
}

// ---------------------------------------------------------------------------
// Page-count helper (template-aware)
// ---------------------------------------------------------------------------

/// Returns the total number of A4 pages for [itemCount] items using the given
/// [settings]. For Classic/Detailed uses the standard grid; for Strips uses
/// stripsPerPage.
int voucherPdfPageCountFor(
  int itemCount,
  int columns,
  PrintSettings settings,
) {
  if (itemCount <= 0) return 0;
  final template = templateFor(settings.templateId);
  final layout = template.layoutFor(columns, settings.knobs);
  return (itemCount / layout.perPage).ceil();
}

// ---------------------------------------------------------------------------
// Internal PDF builder
// ---------------------------------------------------------------------------

class _VouchersPdfBuilder {
  final VoucherCardTemplate template;
  final PrintStyle style;

  _VouchersPdfBuilder({required this.template, required this.style});

  Future<Uint8List> build(
    List<VoucherPrintItem> items, {
    int columns = 4,
    String? docTitle,
    required PrintKnobs knobs,
  }) async {
    final doc = pw.Document(title: docTitle ?? 'Wasel Vouchers', author: 'Wasel');

    final pageFormat = PdfPageFormat.a4.copyWith(
      marginLeft: kPrintMarginH,
      marginRight: kPrintMarginH,
      marginTop: kPrintMarginV,
      marginBottom: kPrintMarginV,
    );

    final layout = template.layoutFor(columns, knobs);
    final double cardW = layout.cardW;
    final double cardH = layout.cardH;
    final int rows = layout.rows;
    final int perPage = layout.perPage;
    final int effectiveColumns = layout.columns;

    for (int p = 0; p * perPage < items.length; p++) {
      final start = p * perPage;
      final end = (start + perPage).clamp(0, items.length);
      final pageItems = items.sublist(start, end);

      doc.addPage(
        pw.Page(
          pageFormat: pageFormat,
          build: (_) => _buildGrid(
            pageItems,
            columns: effectiveColumns,
            rows: rows,
            cardW: cardW,
            cardH: cardH,
            gutterH: kPrintGutterH,
            gutterV: kPrintGutterV,
          ),
        ),
      );
    }

    return doc.save();
  }

  pw.Widget _buildGrid(
    List<VoucherPrintItem> items, {
    required int columns,
    required int rows,
    required double cardW,
    required double cardH,
    required double gutterH,
    required double gutterV,
  }) {
    final List<pw.Widget> rowWidgets = [];

    for (int r = 0; r < rows; r++) {
      final List<pw.Widget> cards = [];
      for (int c = 0; c < columns; c++) {
        final idx = r * columns + c;
        if (idx < items.length) {
          final item = items[idx];
          final ctx = CardContext(
            item: VoucherCardItem(
              code: item.code,
              limitText: item.limitText,
              validityText: item.validityText,
              priceText: item.priceText,
              batchLabel: item.batchLabel,
            ),
            style: style,
            w: cardW,
            h: cardH,
            columns: columns,
          );
          cards.add(pw.SizedBox(
            width: cardW,
            height: cardH,
            child: template.buildCard(ctx),
          ));
        } else {
          cards.add(pw.SizedBox(width: cardW, height: cardH));
        }
        if (c < columns - 1) cards.add(pw.SizedBox(width: gutterH));
      }
      rowWidgets.add(pw.Row(children: cards));
      if (r < rows - 1) rowWidgets.add(pw.SizedBox(height: gutterV));
    }

    return pw.Column(children: rowWidgets);
  }
}

// ---------------------------------------------------------------------------
// PrintService
// ---------------------------------------------------------------------------

class PrintService {
  /// Optional [loadAsset] overrides the default [rootBundle.load], allowing
  /// tests to inject a spy that counts actual asset-load calls.
  PrintService({Future<ByteData> Function(String key)? loadAsset})
      : _loadAsset = loadAsset ?? rootBundle.load;

  final Future<ByteData> Function(String key) _loadAsset;

  Uint8List? _cairoBytes;
  Uint8List? _cairoBoldBytes;

  // Single in-flight Future so concurrent callers share one load.
  Future<void>? _fontLoad;

  Future<void> _ensureFontBytes() {
    return _fontLoad ??= _loadFontBytes().catchError((Object e, StackTrace s) {
      _fontLoad = null;
      Error.throwWithStackTrace(e, s);
    });
  }

  Future<void> _loadFontBytes() async {
    final regular = await _loadAsset('assets/fonts/Cairo-Regular.ttf');
    final bold = await _loadAsset('assets/fonts/Cairo-Bold.ttf');
    _cairoBytes = regular.buffer
        .asUint8List(regular.offsetInBytes, regular.lengthInBytes);
    _cairoBoldBytes =
        bold.buffer.asUint8List(bold.offsetInBytes, bold.lengthInBytes);
  }

  /// Generate an A4 PDF with voucher cards.
  ///
  /// [settings] drives the template, knobs, and default columns. When `null`
  /// (the legacy default) the Classic template with default knobs is used —
  /// producing byte-identical output to the pre-template implementation when
  /// [priceText] and [batchLabel] are absent from every item.
  Future<Uint8List> generateVouchersPdf(
    List<VoucherPrintItem> items,
    String businessName, {
    int columns = 4,
    String? docTitle,
    PrintSettings? settings,
    String? howToDefault,
  }) async {
    await _ensureFontBytes();

    final s = settings ?? const PrintSettings();

    return compute(
      buildVouchersPdfJob,
      VoucherPdfJob(
        items: items,
        businessName: businessName,
        columns: columns,
        cairoRegular: _cairoBytes!,
        cairoBold: _cairoBoldBytes!,
        docTitle: docTitle,
        templateId: s.templateId.wireName,
        knobs: s.knobs.toJson(),
        howToDefault: howToDefault ?? '',
      ),
      debugLabel: 'voucherPdf',
    );
  }

  /// Generates a single-page PDF sized to exactly one voucher card.
  ///
  /// Intended for thumbnail rendering — the page dimensions match the card
  /// itself (plus a 4pt margin) so there is no blank A4 whitespace.
  Future<Uint8List> generateSampleCardPdf(
    VoucherPrintItem item,
    String businessName, {
    required PrintSettings settings,
    String? howToDefault,
  }) async {
    await _ensureFontBytes();

    return compute(
      buildSampleCardJob,
      SampleCardJob(
        item: item,
        businessName: businessName,
        cairoRegular: _cairoBytes!,
        cairoBold: _cairoBoldBytes!,
        templateId: settings.templateId.wireName,
        knobs: settings.knobs.toJson(),
        howToDefault: howToDefault ?? '',
      ),
      debugLabel: 'voucherCardSample',
    );
  }
}
