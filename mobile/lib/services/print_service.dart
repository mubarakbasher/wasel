import 'dart:typed_data';

import 'package:flutter/foundation.dart' show compute;
import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

// ---------------------------------------------------------------------------
// Grid layout constants — shared by [voucherGridLayoutFor] and the PDF builder.
// ---------------------------------------------------------------------------

const double _kMarginH = 16;
const double _kMarginV = 16;
const double _kGutterH = 4;
const double _kGutterV = 3;

// ---------------------------------------------------------------------------
// Public grid-math API
// ---------------------------------------------------------------------------

/// Computed voucher-card dimensions and row count for an A4 page with
/// [columns] columns, using the standard Wasel print margins (16 pt all sides)
/// and gutters (horizontal 4 pt, vertical 3 pt).
///
/// All measurements are in PDF user-space points (72 pt = 1 inch).
class VoucherGridLayout {
  /// Card width in points.
  final double cardW;

  /// Card height in points, clamped to the range [56, 150] pt.
  final double cardH;

  /// Number of card rows that fit on a single A4 page.
  final int rows;

  /// Column count used to construct this layout.
  final int columns;

  const VoucherGridLayout({
    required this.cardW,
    required this.cardH,
    required this.rows,
    required this.columns,
  });

  /// Number of voucher cards that fit on one A4 page.
  int get perPage => rows * columns;
}

/// Returns the [VoucherGridLayout] for an A4 page with [columns] columns and
/// the standard Wasel print margins and gutters.
///
/// This is the single source of truth for card/row math — both the preview
/// page-cap logic and the PDF builder call this function.
VoucherGridLayout voucherGridLayoutFor(int columns) {
  final pageFormat = PdfPageFormat.a4.copyWith(
    marginLeft: _kMarginH,
    marginRight: _kMarginH,
    marginTop: _kMarginV,
    marginBottom: _kMarginV,
  );

  final double usableW = pageFormat.availableWidth;
  final double usableH = pageFormat.availableHeight;

  final double cardW = (usableW - _kGutterH * (columns - 1)) / columns;
  final double cardH = (cardW * 0.62).clamp(56.0, 150.0);
  final int rows = ((usableH + _kGutterV) / (cardH + _kGutterV)).floor();

  return VoucherGridLayout(
    cardW: cardW,
    cardH: cardH,
    rows: rows,
    columns: columns,
  );
}

/// Returns the total number of A4 pages in a voucher PDF that contains
/// [itemCount] items arranged in [columns] columns.
///
/// Returns 0 when [itemCount] is zero or negative.
int voucherPdfPageCount(int itemCount, int columns) {
  if (itemCount <= 0) return 0;
  final perPage = voucherGridLayoutFor(columns).perPage;
  return (itemCount / perPage).ceil();
}

/// Immutable data transfer object passed to [PrintService.generateVouchersPdf].
///
/// Keeping the service context-free means callers resolve all l10n strings
/// before calling the service, and the service itself remains pure/testable.
class VoucherPrintItem {
  final String code;

  /// Localized limit string (e.g. '2 GB', '30 دقيقة', 'Basic').
  /// `null` means the voucher has no meaningful limit — the cell and its
  /// separator are omitted from the info row.
  final String? limitText;

  /// Localized validity string (e.g. '3 days', 'مفتوح').
  final String validityText;

  const VoucherPrintItem({
    required this.code,
    this.limitText,
    required this.validityText,
  });
}

/// Plain-data job passed to [compute] for isolate-offloaded PDF generation.
class VoucherPdfJob {
  final List<VoucherPrintItem> items;
  final String businessName;
  final int columns;
  final Uint8List cairoRegular;
  final Uint8List cairoBold;

  /// Optional PDF document title shown in viewer title bars and share sheets.
  /// Defaults to `'Wasel Vouchers'` when `null`.
  final String? docTitle;

  const VoucherPdfJob({
    required this.items,
    required this.businessName,
    required this.columns,
    required this.cairoRegular,
    required this.cairoBold,
    this.docTitle,
  });
}

/// Top-level entry point for [compute] — must be a top-level function.
Future<Uint8List> buildVouchersPdfJob(VoucherPdfJob job) {
  final builder = _VouchersPdfBuilder(
    cairo: pw.Font.ttf(job.cairoRegular.buffer.asByteData(
      job.cairoRegular.offsetInBytes,
      job.cairoRegular.lengthInBytes,
    )),
    cairoBold: pw.Font.ttf(job.cairoBold.buffer.asByteData(
      job.cairoBold.offsetInBytes,
      job.cairoBold.lengthInBytes,
    )),
  );
  return builder.build(job.items, job.businessName, columns: job.columns, docTitle: job.docTitle);
}

// Arabic Unicode block + Arabic Supplement + Arabic Extended-A + Arabic
// Presentation Forms. If the string contains any of these, we must render it
// RTL so the pdf package runs Arabic glyph shaping (joining initial/medial/
// final forms). Without this, Arabic letters stay as isolated shapes.
final _arabicRegex =
    RegExp(r'[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]');

class _VouchersPdfBuilder {
  final pw.Font cairo;
  final pw.Font cairoBold;

  _VouchersPdfBuilder({required this.cairo, required this.cairoBold});

  bool _hasArabic(String s) => _arabicRegex.hasMatch(s);

  pw.TextDirection _direction(String s) =>
      _hasArabic(s) ? pw.TextDirection.rtl : pw.TextDirection.ltr;

  Future<Uint8List> build(
    List<VoucherPrintItem> items,
    String businessName, {
    int columns = 4,
    String? docTitle,
  }) async {
    final doc = pw.Document(title: docTitle ?? 'Wasel Vouchers', author: 'Wasel');

    final pageFormat = PdfPageFormat.a4.copyWith(
      marginLeft: _kMarginH,
      marginRight: _kMarginH,
      marginTop: _kMarginV,
      marginBottom: _kMarginV,
    );

    final layout = voucherGridLayoutFor(columns);
    final double cardW = layout.cardW;
    final double cardH = layout.cardH;
    final int rows = layout.rows;
    final int perPage = layout.perPage;

    for (int p = 0; p * perPage < items.length; p++) {
      final start = p * perPage;
      final end = (start + perPage).clamp(0, items.length);
      final pageItems = items.sublist(start, end);

      doc.addPage(
        pw.Page(
          pageFormat: pageFormat,
          build: (_) => _buildGrid(
            pageItems,
            businessName,
            columns: columns,
            rows: rows,
            cardW: cardW,
            cardH: cardH,
            gutterH: _kGutterH,
            gutterV: _kGutterV,
          ),
        ),
      );
    }

    return doc.save();
  }

  pw.Widget _buildGrid(
    List<VoucherPrintItem> items,
    String businessName, {
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
          cards.add(pw.SizedBox(
            width: cardW,
            height: cardH,
            child: _buildCard(items[idx], businessName, cardW, cardH, columns),
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

  pw.Widget _buildCard(
    VoucherPrintItem item,
    String businessName,
    double w,
    double h,
    int columns,
  ) {
    // Responsive sizing — legible at every column count (2–6).
    // At 6 cols: 7pt header / 10pt code / 6.6pt info (~50pt inner height).
    final double headerFs = (11 - (columns - 2) * 1.0).clamp(7.0, 11.0);
    final double codeFs = (16 - (columns - 2) * 1.5).clamp(10.0, 16.0);
    final double infoFs = (9 - (columns - 2) * 0.6).clamp(6.6, 9.0);
    final double pad = (6 - (columns - 2) * 0.5).clamp(4.0, 6.0);

    return pw.Container(
      width: w,
      height: h,
      padding: pw.EdgeInsets.symmetric(horizontal: pad, vertical: pad * 0.75),
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: PdfColors.black, width: 0.7),
        borderRadius: pw.BorderRadius.circular(3),
      ),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          // Header: bold business name, shrinks to fit — never clips.
          // The height must be bounded: the stretched column fixes this box's
          // width, and pdf's FittedBox sizes itself preserving the child's
          // aspect ratio — an unbounded short name would balloon the header
          // height and starve the body below it.
          pw.SizedBox(
            height: headerFs * 2.4,
            child: pw.FittedBox(
              fit: pw.BoxFit.scaleDown,
              child: pw.Directionality(
                textDirection: _direction(businessName),
                child: pw.Text(
                  businessName,
                  style: pw.TextStyle(
                    fontSize: headerFs,
                    font: cairoBold,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
              ),
            ),
          ),
          pw.SizedBox(height: pad * 0.4),
          pw.Container(height: 0.8, color: PdfColors.black), // rule under header
          pw.Expanded(
            child: pw.Column(
              mainAxisAlignment: pw.MainAxisAlignment.spaceEvenly,
              children: [
                // Hero code — bold monospace, shrinks to fit one line
                pw.FittedBox(
                  fit: pw.BoxFit.scaleDown,
                  child: pw.Text(
                    item.code,
                    style: pw.TextStyle(
                      fontSize: codeFs,
                      font: pw.Font.courierBold(),
                      fontWeight: pw.FontWeight.bold,
                      letterSpacing: 1,
                      fontFallback: [cairo],
                    ),
                  ),
                ),
                // Info line: [limit | ] validity — the whole row scales as one unit
                pw.FittedBox(
                  fit: pw.BoxFit.scaleDown,
                  child: pw.Row(
                    mainAxisSize: pw.MainAxisSize.min,
                    children: [
                      if (item.limitText != null) ...[
                        pw.Directionality(
                          textDirection: _direction(item.limitText!),
                          child: pw.Text(
                            item.limitText!,
                            style: pw.TextStyle(
                              fontSize: infoFs,
                              font: cairoBold,
                              fontWeight: pw.FontWeight.bold,
                            ),
                          ),
                        ),
                        pw.Container(
                          width: 0.6,
                          height: infoFs * 1.1,
                          color: PdfColors.black,
                          margin: pw.EdgeInsets.symmetric(
                            horizontal: infoFs * 0.6,
                          ),
                        ),
                      ],
                      pw.Directionality(
                        textDirection: _direction(item.validityText),
                        child: pw.Text(
                          item.validityText,
                          style: pw.TextStyle(
                            fontSize: infoFs,
                            font: cairo,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class PrintService {
  /// Optional [loadAsset] overrides the default [rootBundle.load], allowing
  /// tests to inject a spy that counts actual asset-load calls.
  PrintService({Future<ByteData> Function(String key)? loadAsset})
      : _loadAsset = loadAsset ?? rootBundle.load;

  final Future<ByteData> Function(String key) _loadAsset;

  Uint8List? _cairoBytes;
  Uint8List? _cairoBoldBytes;

  // Single in-flight Future so concurrent callers share one load and the
  // race-condition "check → await → assign → check" is impossible.
  Future<void>? _fontLoad;

  Future<void> _ensureFontBytes() {
    return _fontLoad ??= _loadFontBytes().catchError((Object e, StackTrace s) {
      // Transient asset failure stays retryable: clear the memo so the next
      // caller attempts the load again rather than replaying the cached error.
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

  /// Generate an A4 PDF with voucher cards arranged in a configurable grid.
  ///
  /// [docTitle] sets the PDF document title shown in viewer title bars and
  /// share-sheet previews. When `null` (the default), falls back to the static
  /// `'Wasel Vouchers'` string. Pass `context.tr('vouchers.pdfDocTitle')` from
  /// the calling screen so the title is localised.
  Future<Uint8List> generateVouchersPdf(
    List<VoucherPrintItem> items,
    String businessName, {
    int columns = 4,
    String? docTitle,
  }) async {
    await _ensureFontBytes();
    return compute(
      buildVouchersPdfJob,
      VoucherPdfJob(
        items: items,
        businessName: businessName,
        columns: columns,
        cairoRegular: _cairoBytes!,
        cairoBold: _cairoBoldBytes!,
        docTitle: docTitle,
      ),
      debugLabel: 'voucherPdf',
    );
  }
}
