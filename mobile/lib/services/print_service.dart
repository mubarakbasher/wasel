import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

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

class PrintService {
  // Arabic Unicode block + Arabic Supplement + Arabic Extended-A + Arabic
  // Presentation Forms. If the string contains any of these, we must render it
  // RTL so the pdf package runs Arabic glyph shaping (joining initial/medial/
  // final forms). Without this, Arabic letters stay as isolated shapes.
  static final _arabicRegex =
      RegExp(r'[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]');

  pw.Font? _cairo;
  pw.Font? _cairoBold;

  bool _hasArabic(String s) => _arabicRegex.hasMatch(s);

  pw.TextDirection _direction(String s) =>
      _hasArabic(s) ? pw.TextDirection.rtl : pw.TextDirection.ltr;

  Future<void> _ensureFont() async {
    _cairo ??= pw.Font.ttf(
      await rootBundle.load('assets/fonts/Cairo-Regular.ttf'),
    );
    _cairoBold ??= pw.Font.ttf(
      await rootBundle.load('assets/fonts/Cairo-Bold.ttf'),
    );
  }

  /// Generate an A4 PDF with voucher cards arranged in a configurable grid.
  Future<Uint8List> generateVouchersPdf(
    List<VoucherPrintItem> items,
    String businessName, {
    int columns = 4,
  }) async {
    await _ensureFont();

    final doc = pw.Document(title: 'Wasel Vouchers', author: 'Wasel');

    const double marginH = 16;
    const double marginV = 16;
    const double gutterH = 4;
    const double gutterV = 3;

    final pageFormat = PdfPageFormat.a4.copyWith(
      marginLeft: marginH,
      marginRight: marginH,
      marginTop: marginV,
      marginBottom: marginV,
    );

    final double usableW = pageFormat.availableWidth;
    final double usableH = pageFormat.availableHeight;

    final double cardW = (usableW - gutterH * (columns - 1)) / columns;
    final double cardH = (cardW * 0.62).clamp(56.0, 150.0);

    final int rows = ((usableH + gutterV) / (cardH + gutterV)).floor();
    final int perPage = rows * columns;

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
            gutterH: gutterH,
            gutterV: gutterV,
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
                    font: _cairoBold,
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
                      fontFallback: [_cairo!],
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
                              font: _cairoBold,
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
                            font: _cairo,
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
