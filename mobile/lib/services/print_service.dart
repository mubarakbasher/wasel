import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../models/voucher.dart';

class PrintService {
  static final _headerColor = PdfColor.fromHex('#1a237e');
  static final _accentColor = PdfColor.fromHex('#00897b');
  static final _lightBg = PdfColor.fromHex('#f5f5f5');

  // Arabic Unicode block + Arabic Supplement + Arabic Extended-A + Arabic
  // Presentation Forms. If the string contains any of these, we must render it
  // RTL so the pdf package runs Arabic glyph shaping (joining initial/medial/
  // final forms). Without this, Arabic letters stay as isolated shapes.
  static final _arabicRegex = RegExp(r'[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]');

  pw.Font? _arabicFont;

  bool _hasArabic(String s) => _arabicRegex.hasMatch(s);

  pw.TextDirection _direction(String s) =>
      _hasArabic(s) ? pw.TextDirection.rtl : pw.TextDirection.ltr;

  Future<void> _ensureFont() async {
    _arabicFont ??= pw.Font.ttf(
      await rootBundle.load('assets/fonts/Cairo-Regular.ttf'),
    );
  }

  /// Generate A4 PDF with voucher cards in a configurable grid.
  Future<Uint8List> generateVouchersPdf(
    List<Voucher> vouchers,
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
    final double cardH = cardW * 0.55;

    final int rows = ((usableH + gutterV) / (cardH + gutterV)).floor();
    final int perPage = rows * columns;

    for (int p = 0; p * perPage < vouchers.length; p++) {
      final start = p * perPage;
      final end = (start + perPage).clamp(0, vouchers.length);
      final pageVouchers = vouchers.sublist(start, end);

      doc.addPage(
        pw.Page(
          pageFormat: pageFormat,
          build: (_) => _buildGrid(
            pageVouchers,
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
    List<Voucher> vouchers,
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
        if (idx < vouchers.length) {
          cards.add(pw.SizedBox(
            width: cardW,
            height: cardH,
            child: _buildCard(vouchers[idx], businessName, cardW, cardH, columns),
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
    Voucher v,
    String businessName,
    double w,
    double h,
    int columns,
  ) {
    // Responsive sizing
    final double headerFs = (10 - (columns - 2) * 0.5).clamp(5.0, 12.0);
    final double brandFs = (6 - (columns - 2) * 0.2).clamp(3.0, 7.0);
    final double codeFs = (12 - (columns - 2) * 0.6).clamp(6.0, 14.0);
    final double infoFs = (7 - (columns - 2) * 0.3).clamp(3.5, 9.0);
    final double pad = (5 - (columns - 2) * 0.25).clamp(2.0, 7.0);
    final double headerBandH = (h * 0.22).clamp(8.0, 24.0);

    final validityText = _formatValidity(v.validitySeconds);

    return pw.Container(
      width: w,
      height: h,
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: PdfColors.grey300, width: 0.4),
        borderRadius: pw.BorderRadius.circular(3),
      ),
      child: pw.ClipRRect(
        horizontalRadius: 3,
        verticalRadius: 3,
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.stretch,
          children: [
            // Header band: business name
            pw.Container(
              height: headerBandH,
              color: _headerColor,
              alignment: pw.Alignment.center,
              padding: pw.EdgeInsets.symmetric(horizontal: pad),
              child: pw.Directionality(
                textDirection: _direction(businessName),
                child: pw.Text(
                  businessName,
                  style: pw.TextStyle(
                    fontSize: headerFs,
                    fontWeight: pw.FontWeight.bold,
                    font: _arabicFont,
                    color: PdfColors.white,
                  ),
                  textAlign: pw.TextAlign.center,
                  maxLines: 1,
                ),
              ),
            ),

            // Body
            pw.Expanded(
              child: pw.Container(
                color: _lightBg,
                padding: pw.EdgeInsets.symmetric(
                  horizontal: pad,
                  vertical: pad * 0.4,
                ),
                child: pw.Column(
                  mainAxisAlignment: pw.MainAxisAlignment.spaceEvenly,
                  children: [
                    // Branding
                    pw.Text(
                      'Wasel',
                      style: pw.TextStyle(
                        fontSize: brandFs,
                        color: PdfColors.grey500,
                        fontWeight: pw.FontWeight.bold,
                        font: _arabicFont,
                        letterSpacing: 1.5,
                      ),
                      textAlign: pw.TextAlign.center,
                    ),

                    // Username (prominent)
                    pw.Text(
                      v.username,
                      style: pw.TextStyle(
                        fontSize: codeFs,
                        fontWeight: pw.FontWeight.bold,
                        font: pw.Font.courier(),
                        letterSpacing: 1,
                      ),
                      textAlign: pw.TextAlign.center,
                    ),

                    // Divider
                    pw.Container(
                      height: 0.6,
                      color: _accentColor,
                      margin: pw.EdgeInsets.symmetric(horizontal: w * 0.1),
                    ),

                    // Info row: limit + validity
                    pw.Row(
                      mainAxisAlignment: pw.MainAxisAlignment.spaceEvenly,
                      children: [
                        pw.Directionality(
                          textDirection: _direction(v.limitDisplayText),
                          child: pw.Text(
                            v.limitDisplayText,
                            style: pw.TextStyle(
                              fontSize: infoFs,
                              fontWeight: pw.FontWeight.bold,
                              font: _arabicFont,
                              color: _headerColor,
                            ),
                          ),
                        ),
                        pw.Container(
                          width: 0.5,
                          height: infoFs * 1.2,
                          color: PdfColors.grey400,
                        ),
                        pw.Directionality(
                          textDirection: _direction(validityText),
                          child: pw.Text(
                            validityText,
                            style: pw.TextStyle(
                              fontSize: infoFs,
                              font: _arabicFont,
                              color: PdfColors.grey700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatValidity(int? validitySeconds) {
    if (validitySeconds == null || validitySeconds <= 0) return 'Open';
    if (validitySeconds < 3600) return '${(validitySeconds / 60).round()} min';
    if (validitySeconds < 86400) return '${(validitySeconds / 3600).round()} hours';
    return '${(validitySeconds / 86400).round()} days';
  }
}
