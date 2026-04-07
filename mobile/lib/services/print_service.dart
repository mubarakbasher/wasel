import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../models/voucher.dart';

/// Service for generating printable PDF documents from vouchers.
///
/// Supports five layout modes:
/// - Thermal receipt (58mm width) for receipt printers
/// - A4 multi-voucher (8 per page) for standard printers
/// - Arabic Grid: dense grid with Arabic labels, configurable columns
/// - Table Grid: dense grid with Username/Password columns
/// - Decorated Card: ornamental corners with centered code
class PrintService {
  // ---------------------------------------------------------------------------
  // Arabic font loading (cached)
  // ---------------------------------------------------------------------------

  pw.Font? _arabicFont;

  Future<void> _ensureArabicFont() async {
    _arabicFont ??= pw.Font.ttf(
      await rootBundle.load('assets/fonts/Cairo-Regular.ttf'),
    );
  }

  // ---------------------------------------------------------------------------
  // Thermal receipt layout (58mm / 164pt width)
  // ---------------------------------------------------------------------------

  /// Generate a narrow PDF suitable for 58mm thermal receipt printers.
  ///
  /// Each voucher is rendered as a compact card stacked vertically on a
  /// continuous roll. A dashed separator is placed between vouchers.
  Future<Uint8List> generateThermalPdf(List<Voucher> vouchers) async {
    final doc = pw.Document(
      title: 'Wi-Fi Vouchers',
      author: 'Wasel',
    );

    const double pageWidth = 164; // 58mm in points
    const double hMargin = 8;
    const double vMargin = 8;

    // Estimate card height per voucher to size the page.
    // Header (title + divider) ~40pt, credentials ~50pt, meta ~30pt,
    // separator ~12pt, padding ~10pt => ~142pt per voucher.
    const double estimatedCardHeight = 142;
    final double pageHeight =
        (vouchers.length * estimatedCardHeight) + (2 * vMargin);

    final pageFormat = PdfPageFormat(
      pageWidth,
      pageHeight,
      marginLeft: hMargin,
      marginRight: hMargin,
      marginTop: vMargin,
      marginBottom: vMargin,
    );

    doc.addPage(
      pw.Page(
        pageFormat: pageFormat,
        build: (pw.Context context) {
          return pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.stretch,
            children: _buildThermalCards(vouchers),
          );
        },
      ),
    );

    return doc.save();
  }

  List<pw.Widget> _buildThermalCards(List<Voucher> vouchers) {
    final List<pw.Widget> widgets = [];

    for (int i = 0; i < vouchers.length; i++) {
      final v = vouchers[i];

      widgets.add(
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.stretch,
          children: [
            // Header
            pw.Text(
              'Wi-Fi Voucher',
              style: pw.TextStyle(
                fontSize: 12,
                fontWeight: pw.FontWeight.bold,
              ),
              textAlign: pw.TextAlign.center,
            ),
            pw.SizedBox(height: 4),
            pw.Divider(thickness: 0.8),
            pw.SizedBox(height: 6),

            // Username
            pw.Text(
              'Username:',
              style: const pw.TextStyle(fontSize: 7, color: PdfColors.grey700),
            ),
            pw.Text(
              v.username,
              style: pw.TextStyle(
                fontSize: 13,
                fontWeight: pw.FontWeight.bold,
                font: pw.Font.courier(),
              ),
            ),
            pw.SizedBox(height: 4),

            // Password
            pw.Text(
              'Password:',
              style: const pw.TextStyle(fontSize: 7, color: PdfColors.grey700),
            ),
            pw.Text(
              v.password ?? '--------',
              style: pw.TextStyle(
                fontSize: 13,
                fontWeight: pw.FontWeight.bold,
                font: pw.Font.courier(),
              ),
            ),
            pw.SizedBox(height: 6),

            // Profile / Plan
            pw.Text(
              'Plan: ${v.profileName}',
              style: const pw.TextStyle(fontSize: 8),
            ),

            // Expiration (if set)
            if (v.expiration != null) ...[
              pw.SizedBox(height: 2),
              pw.Text(
                'Expires: ${v.expiration}',
                style: const pw.TextStyle(
                    fontSize: 7, color: PdfColors.grey600),
              ),
            ],

            pw.SizedBox(height: 6),
          ],
        ),
      );

      // Dashed separator between vouchers (not after the last one)
      if (i < vouchers.length - 1) {
        widgets.add(_dashedLine(pageWidth: 148)); // 164 - 2*8 margins
        widgets.add(pw.SizedBox(height: 6));
      }
    }

    return widgets;
  }

  // ---------------------------------------------------------------------------
  // A4 multi-voucher layout (2 columns x 4 rows = 8 per page)
  // ---------------------------------------------------------------------------

  /// Generate an A4 PDF with voucher cards arranged in a 2x4 grid.
  ///
  /// Each card is credit-card sized with a border, suitable for cutting.
  /// Pages are added automatically as needed.
  Future<Uint8List> generateA4Pdf(List<Voucher> vouchers) async {
    final doc = pw.Document(
      title: 'Wi-Fi Vouchers',
      author: 'Wasel',
    );

    const int perPage = 8;
    const int columns = 2;
    const int rows = 4;

    // Page margins
    const double marginH = 28; // left/right
    const double marginV = 28; // top/bottom

    final pageFormat = PdfPageFormat.a4.copyWith(
      marginLeft: marginH,
      marginRight: marginH,
      marginTop: marginV,
      marginBottom: marginV,
    );

    // Usable dimensions
    final double usableWidth = pageFormat.availableWidth;
    final double usableHeight = pageFormat.availableHeight;

    // Gutter between cards
    const double gutterH = 10;
    const double gutterV = 8;

    final double cardWidth = (usableWidth - gutterH * (columns - 1)) / columns;
    final double cardHeight = (usableHeight - gutterV * (rows - 1)) / rows;

    // Split vouchers into pages of 8
    for (int pageIdx = 0;
        pageIdx * perPage < vouchers.length;
        pageIdx++) {
      final int start = pageIdx * perPage;
      final int end = (start + perPage > vouchers.length)
          ? vouchers.length
          : start + perPage;
      final pageVouchers = vouchers.sublist(start, end);

      doc.addPage(
        pw.Page(
          pageFormat: pageFormat,
          build: (pw.Context context) {
            return _buildA4Grid(
              pageVouchers,
              columns: columns,
              rows: rows,
              cardWidth: cardWidth,
              cardHeight: cardHeight,
              gutterH: gutterH,
              gutterV: gutterV,
            );
          },
        ),
      );
    }

    return doc.save();
  }

  pw.Widget _buildA4Grid(
    List<Voucher> vouchers, {
    required int columns,
    required int rows,
    required double cardWidth,
    required double cardHeight,
    required double gutterH,
    required double gutterV,
  }) {
    final List<pw.Widget> rowWidgets = [];

    for (int r = 0; r < rows; r++) {
      final List<pw.Widget> rowCards = [];

      for (int c = 0; c < columns; c++) {
        final int idx = r * columns + c;

        if (idx < vouchers.length) {
          rowCards.add(
            pw.SizedBox(
              width: cardWidth,
              height: cardHeight,
              child: _buildA4Card(vouchers[idx], cardWidth, cardHeight),
            ),
          );
        } else {
          // Empty placeholder to maintain grid alignment
          rowCards.add(pw.SizedBox(width: cardWidth, height: cardHeight));
        }

        // Horizontal gutter (not after last column)
        if (c < columns - 1) {
          rowCards.add(pw.SizedBox(width: gutterH));
        }
      }

      rowWidgets.add(pw.Row(children: rowCards));

      // Vertical gutter (not after last row)
      if (r < rows - 1) {
        rowWidgets.add(pw.SizedBox(height: gutterV));
      }
    }

    return pw.Column(children: rowWidgets);
  }

  pw.Widget _buildA4Card(Voucher v, double width, double height) {
    return pw.Container(
      width: width,
      height: height,
      padding: const pw.EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: PdfColors.grey600, width: 0.8),
        borderRadius: const pw.BorderRadius.all(pw.Radius.circular(4)),
      ),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          // Header
          pw.Text(
            'Wi-Fi Voucher',
            style: pw.TextStyle(
              fontSize: 13,
              fontWeight: pw.FontWeight.bold,
            ),
            textAlign: pw.TextAlign.center,
          ),
          pw.SizedBox(height: 4),
          pw.Divider(thickness: 0.6, color: PdfColors.grey400),
          pw.SizedBox(height: 6),

          // Username
          pw.Text(
            'Username',
            style: const pw.TextStyle(fontSize: 7, color: PdfColors.grey700),
          ),
          pw.SizedBox(height: 1),
          pw.Text(
            v.username,
            style: pw.TextStyle(
              fontSize: 12,
              fontWeight: pw.FontWeight.bold,
              font: pw.Font.courier(),
            ),
          ),
          pw.SizedBox(height: 6),

          // Password
          pw.Text(
            'Password',
            style: const pw.TextStyle(fontSize: 7, color: PdfColors.grey700),
          ),
          pw.SizedBox(height: 1),
          pw.Text(
            v.password ?? '--------',
            style: pw.TextStyle(
              fontSize: 12,
              fontWeight: pw.FontWeight.bold,
              font: pw.Font.courier(),
            ),
          ),
          pw.SizedBox(height: 6),

          // Plan
          pw.Text(
            'Plan: ${v.profileName}',
            style: const pw.TextStyle(fontSize: 8),
          ),
          pw.SizedBox(height: 3),

          // Expiration
          pw.Text(
            v.expiration != null ? 'Expires: ${v.expiration}' : 'No expiry',
            style: const pw.TextStyle(fontSize: 8, color: PdfColors.grey600),
          ),

          pw.Spacer(),

          // Footer: creation date
          pw.Text(
            'Created: ${_formatDate(v.createdAt)}',
            style: const pw.TextStyle(fontSize: 6, color: PdfColors.grey500),
            textAlign: pw.TextAlign.right,
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Shared configurable grid helper
  // ---------------------------------------------------------------------------

  /// Generate a paginated A4 PDF with voucher cards in a configurable grid.
  ///
  /// [columns] determines the number of columns per row.
  /// Rows are calculated automatically based on available height and card height.
  Future<Uint8List> _generateGridPdf({
    required List<Voucher> vouchers,
    required int columns,
    required pw.Widget Function(Voucher v, double cardWidth, double cardHeight)
        cardBuilder,
    double marginH = 16,
    double marginV = 16,
    double gutterH = 4,
    double gutterV = 3,
  }) async {
    final doc = pw.Document(
      title: 'Wi-Fi Vouchers',
      author: 'Wasel',
    );

    final pageFormat = PdfPageFormat.a4.copyWith(
      marginLeft: marginH,
      marginRight: marginH,
      marginTop: marginV,
      marginBottom: marginV,
    );

    final double usableWidth = pageFormat.availableWidth;
    final double usableHeight = pageFormat.availableHeight;

    final double cardWidth =
        (usableWidth - gutterH * (columns - 1)) / columns;

    // Determine card height: scale based on columns for appropriate aspect ratio
    // Fewer columns = taller cards, more columns = shorter cards
    final double cardHeight = cardWidth * 0.55;

    // Calculate how many rows fit
    final int rows = ((usableHeight + gutterV) / (cardHeight + gutterV)).floor();
    final int perPage = rows * columns;

    // Generate pages
    for (int pageIdx = 0; pageIdx * perPage < vouchers.length; pageIdx++) {
      final int start = pageIdx * perPage;
      final int end = (start + perPage > vouchers.length)
          ? vouchers.length
          : start + perPage;
      final pageVouchers = vouchers.sublist(start, end);

      doc.addPage(
        pw.Page(
          pageFormat: pageFormat,
          build: (pw.Context context) {
            return _buildConfigurableGrid(
              pageVouchers,
              columns: columns,
              rows: rows,
              cardWidth: cardWidth,
              cardHeight: cardHeight,
              gutterH: gutterH,
              gutterV: gutterV,
              cardBuilder: cardBuilder,
            );
          },
        ),
      );
    }

    return doc.save();
  }

  pw.Widget _buildConfigurableGrid(
    List<Voucher> vouchers, {
    required int columns,
    required int rows,
    required double cardWidth,
    required double cardHeight,
    required double gutterH,
    required double gutterV,
    required pw.Widget Function(Voucher v, double cardWidth, double cardHeight)
        cardBuilder,
  }) {
    final List<pw.Widget> rowWidgets = [];

    for (int r = 0; r < rows; r++) {
      final List<pw.Widget> rowCards = [];

      for (int c = 0; c < columns; c++) {
        final int idx = r * columns + c;

        if (idx < vouchers.length) {
          rowCards.add(
            pw.SizedBox(
              width: cardWidth,
              height: cardHeight,
              child: cardBuilder(vouchers[idx], cardWidth, cardHeight),
            ),
          );
        } else {
          rowCards.add(pw.SizedBox(width: cardWidth, height: cardHeight));
        }

        if (c < columns - 1) {
          rowCards.add(pw.SizedBox(width: gutterH));
        }
      }

      rowWidgets.add(pw.Row(children: rowCards));

      if (r < rows - 1) {
        rowWidgets.add(pw.SizedBox(height: gutterV));
      }
    }

    return pw.Column(children: rowWidgets);
  }

  // ---------------------------------------------------------------------------
  // Layout 1: Arabic Grid
  // ---------------------------------------------------------------------------

  /// Generate A4 PDF with Arabic-labeled voucher cards in a configurable grid.
  ///
  /// Each card shows: business name (bold), voucher code, and time limit
  /// with Arabic labels. RTL text direction.
  Future<Uint8List> generateArabicGridPdf(
    List<Voucher> vouchers,
    String businessName, {
    int columns = 5,
  }) async {
    await _ensureArabicFont();

    return _generateGridPdf(
      vouchers: vouchers,
      columns: columns,
      cardBuilder: (v, w, h) =>
          _buildArabicGridCard(v, businessName, w, h, columns),
    );
  }

  pw.Widget _buildArabicGridCard(
    Voucher v,
    String businessName,
    double width,
    double height,
    int columns,
  ) {
    // Scale font sizes based on column count
    final double headerSize = (12 - (columns - 2) * 0.6).clamp(6.0, 14.0);
    final double labelSize = (8 - (columns - 2) * 0.4).clamp(4.0, 10.0);
    final double valueSize = (10 - (columns - 2) * 0.5).clamp(5.0, 12.0);
    final double pad = (6 - (columns - 2) * 0.3).clamp(2.0, 8.0);

    return pw.Container(
      width: width,
      height: height,
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: PdfColors.grey800, width: 0.6),
      ),
      child: pw.Padding(
        padding: pw.EdgeInsets.all(pad),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.stretch,
          children: [
            // Business name header
            pw.Directionality(
              textDirection: pw.TextDirection.rtl,
              child: pw.Text(
                businessName,
                style: pw.TextStyle(
                  fontSize: headerSize,
                  fontWeight: pw.FontWeight.bold,
                  font: _arabicFont,
                ),
                textAlign: pw.TextAlign.center,
              ),
            ),
            pw.SizedBox(height: pad * 0.3),
            pw.Divider(thickness: 0.5, color: PdfColors.grey600),
            pw.SizedBox(height: pad * 0.3),

            // Username row: code on left, label on right (RTL)
            pw.Directionality(
              textDirection: pw.TextDirection.rtl,
              child: pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                children: [
                  pw.Text(
                    '\u0627\u0633\u0645 \u0627\u0644\u062f\u062e\u0648\u0644',
                    style: pw.TextStyle(
                      fontSize: labelSize,
                      font: _arabicFont,
                      color: PdfColors.grey700,
                    ),
                  ),
                  pw.Text(
                    v.username,
                    style: pw.TextStyle(
                      fontSize: valueSize,
                      fontWeight: pw.FontWeight.bold,
                      font: _arabicFont,
                    ),
                  ),
                ],
              ),
            ),
            pw.SizedBox(height: pad * 0.3),

            // Time/limit row
            pw.Directionality(
              textDirection: pw.TextDirection.rtl,
              child: pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                children: [
                  pw.Text(
                    '\u0627\u0644\u0648\u0642\u062a',
                    style: pw.TextStyle(
                      fontSize: labelSize,
                      font: _arabicFont,
                      color: PdfColors.grey700,
                    ),
                  ),
                  pw.Text(
                    v.limitDisplayText,
                    style: pw.TextStyle(
                      fontSize: valueSize,
                      font: _arabicFont,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Layout 2: Table Grid
  // ---------------------------------------------------------------------------

  /// Generate A4 PDF with table-style voucher cards (Username/Password columns).
  ///
  /// Each card shows: business name + plan in header, then username and
  /// password side by side with English labels.
  Future<Uint8List> generateTableGridPdf(
    List<Voucher> vouchers,
    String businessName, {
    int columns = 5,
  }) async {
    await _ensureArabicFont();

    return _generateGridPdf(
      vouchers: vouchers,
      columns: columns,
      cardBuilder: (v, w, h) =>
          _buildTableGridCard(v, businessName, w, h, columns),
    );
  }

  pw.Widget _buildTableGridCard(
    Voucher v,
    String businessName,
    double width,
    double height,
    int columns,
  ) {
    final double headerSize = (10 - (columns - 2) * 0.5).clamp(5.0, 12.0);
    final double labelSize = (7 - (columns - 2) * 0.3).clamp(3.5, 9.0);
    final double valueSize = (9 - (columns - 2) * 0.4).clamp(4.5, 11.0);
    final double pad = (5 - (columns - 2) * 0.3).clamp(2.0, 7.0);

    final headerText = '$businessName ${v.limitDisplayText}';

    return pw.Container(
      width: width,
      height: height,
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: PdfColors.grey800, width: 0.6),
      ),
      child: pw.Padding(
        padding: pw.EdgeInsets.all(pad),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.stretch,
          children: [
            // Header: business name + plan
            pw.Directionality(
              textDirection: pw.TextDirection.rtl,
              child: pw.Text(
                headerText,
                style: pw.TextStyle(
                  fontSize: headerSize,
                  fontWeight: pw.FontWeight.bold,
                  font: _arabicFont,
                ),
                textAlign: pw.TextAlign.center,
              ),
            ),
            pw.SizedBox(height: pad * 0.3),
            pw.Divider(thickness: 0.4, color: PdfColors.grey500),
            pw.SizedBox(height: pad * 0.3),

            // Username + Password labels row
            pw.Row(
              children: [
                pw.Expanded(
                  child: pw.Text(
                    'Username',
                    style: pw.TextStyle(
                      fontSize: labelSize,
                      color: PdfColors.grey700,
                      font: _arabicFont,
                    ),
                  ),
                ),
                pw.Expanded(
                  child: pw.Text(
                    'Password',
                    style: pw.TextStyle(
                      fontSize: labelSize,
                      color: PdfColors.grey700,
                      font: _arabicFont,
                    ),
                    textAlign: pw.TextAlign.right,
                  ),
                ),
              ],
            ),
            pw.SizedBox(height: pad * 0.2),

            // Username + Password values row
            pw.Row(
              children: [
                pw.Expanded(
                  child: pw.Text(
                    v.username,
                    style: pw.TextStyle(
                      fontSize: valueSize,
                      fontWeight: pw.FontWeight.bold,
                      font: _arabicFont,
                    ),
                  ),
                ),
                pw.Expanded(
                  child: pw.Text(
                    v.password ?? '',
                    style: pw.TextStyle(
                      fontSize: valueSize,
                      fontWeight: pw.FontWeight.bold,
                      font: _arabicFont,
                    ),
                    textAlign: pw.TextAlign.right,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Layout 3: Decorated Card
  // ---------------------------------------------------------------------------

  /// Generate A4 PDF with decorated voucher cards featuring ornamental corners.
  ///
  /// Each card shows: decorative corner borders, business name, large centered
  /// voucher code, and price + time limit at bottom.
  Future<Uint8List> generateDecoratedCardPdf(
    List<Voucher> vouchers,
    String businessName, {
    int columns = 4,
  }) async {
    await _ensureArabicFont();

    return _generateGridPdf(
      vouchers: vouchers,
      columns: columns,
      gutterH: 6,
      gutterV: 4,
      cardBuilder: (v, w, h) =>
          _buildDecoratedCard(v, businessName, w, h, columns),
    );
  }

  pw.Widget _buildDecoratedCard(
    Voucher v,
    String businessName,
    double width,
    double height,
    int columns,
  ) {
    final double headerSize = (11 - (columns - 2) * 0.5).clamp(5.5, 13.0);
    final double codeSize = (14 - (columns - 2) * 0.7).clamp(7.0, 16.0);
    final double footerSize = (8 - (columns - 2) * 0.4).clamp(4.0, 10.0);
    final double cornerLen = (18 - (columns - 2) * 1.0).clamp(8.0, 22.0);
    final double pad = (8 - (columns - 2) * 0.4).clamp(3.0, 10.0);

    return pw.Container(
      width: width,
      height: height,
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: PdfColors.grey400, width: 0.3),
      ),
      child: pw.Stack(
        children: [
          // Corner decorations
          _buildCornerDecorations(width, height, cornerLen),

          // Card content
          pw.Positioned.fill(
            child: pw.Padding(
              padding: pw.EdgeInsets.all(pad + cornerLen * 0.3),
              child: pw.Column(
                mainAxisAlignment: pw.MainAxisAlignment.center,
                children: [
                  // Business name
                  pw.Directionality(
                    textDirection: pw.TextDirection.rtl,
                    child: pw.Text(
                      businessName,
                      style: pw.TextStyle(
                        fontSize: headerSize,
                        fontWeight: pw.FontWeight.bold,
                        font: _arabicFont,
                      ),
                      textAlign: pw.TextAlign.center,
                    ),
                  ),
                  pw.SizedBox(height: pad * 0.5),

                  // Voucher code (large, centered)
                  pw.Text(
                    v.username,
                    style: pw.TextStyle(
                      fontSize: codeSize,
                      fontWeight: pw.FontWeight.bold,
                      font: _arabicFont,
                    ),
                    textAlign: pw.TextAlign.center,
                  ),
                  pw.SizedBox(height: pad * 0.5),

                  // Bottom row: price + time
                  pw.Directionality(
                    textDirection: pw.TextDirection.rtl,
                    child: pw.Row(
                      mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                      children: [
                        if (v.price != null && v.price! > 0)
                          pw.Text(
                            '${v.price!.toStringAsFixed(0)} \u062c\u0646\u064a\u0647',
                            style: pw.TextStyle(
                              fontSize: footerSize,
                              font: _arabicFont,
                            ),
                          )
                        else
                          pw.SizedBox(),
                        pw.Text(
                          v.limitDisplayText,
                          style: pw.TextStyle(
                            fontSize: footerSize,
                            font: _arabicFont,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Draw elegant ornamental L-shaped corners with curled ends.
  pw.Widget _buildCornerDecorations(
      double width, double height, double cornerLen) {
    return pw.CustomPaint(
      size: PdfPoint(width, height),
      painter: (PdfGraphics canvas, PdfPoint size) {
        final w = size.x;
        final h = size.y;
        final len = cornerLen;
        final curl = len * 0.3;

        canvas.setColor(PdfColors.grey700);
        canvas.setLineWidth(0.8);

        // Top-left corner
        _drawCorner(canvas, 0, h, len, curl, 1, -1);
        // Top-right corner
        _drawCorner(canvas, w, h, len, curl, -1, -1);
        // Bottom-left corner
        _drawCorner(canvas, 0, 0, len, curl, 1, 1);
        // Bottom-right corner
        _drawCorner(canvas, w, 0, len, curl, -1, 1);

        // Inner decorative corners (smaller, offset)
        final innerOffset = len * 0.15;
        final innerLen = len * 0.6;
        final innerCurl = innerLen * 0.25;
        canvas.setLineWidth(0.5);

        _drawCorner(canvas, innerOffset, h - innerOffset, innerLen, innerCurl, 1, -1);
        _drawCorner(canvas, w - innerOffset, h - innerOffset, innerLen, innerCurl, -1, -1);
        _drawCorner(canvas, innerOffset, innerOffset, innerLen, innerCurl, 1, 1);
        _drawCorner(canvas, w - innerOffset, innerOffset, innerLen, innerCurl, -1, 1);
      },
    );
  }

  /// Draw a single corner with L-shape and curled ends.
  ///
  /// [x], [y] is the corner point.
  /// [sx], [sy] are direction multipliers (1 or -1) to mirror the corner.
  void _drawCorner(
    PdfGraphics canvas,
    double x,
    double y,
    double len,
    double curl,
    double sx,
    double sy,
  ) {
    // Vertical line from corner with curl at end
    canvas.moveTo(x + sx * curl * 0.5, y + sy * len);
    canvas.curveTo(
      x, y + sy * len,
      x, y + sy * len * 0.8,
      x, y + sy * len * 0.5,
    );
    canvas.lineTo(x, y);

    // Horizontal line from corner with curl at end
    canvas.lineTo(x + sx * len * 0.5, y);
    canvas.curveTo(
      x + sx * len * 0.8, y,
      x + sx * len, y,
      x + sx * len, y + sy * curl * 0.5,
    );
    canvas.strokePath();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /// Build a dashed horizontal line.
  pw.Widget _dashedLine({required double pageWidth}) {
    const double dashWidth = 4;
    const double dashGap = 3;
    final int dashCount = (pageWidth / (dashWidth + dashGap)).floor();

    return pw.Row(
      mainAxisAlignment: pw.MainAxisAlignment.center,
      children: List.generate(dashCount, (_) {
        return pw.Container(
          width: dashWidth,
          height: 0.6,
          margin: const pw.EdgeInsets.symmetric(horizontal: dashGap / 2),
          color: PdfColors.grey500,
        );
      }),
    );
  }

  /// Format a [DateTime] as "dd/MM/yyyy".
  String _formatDate(DateTime date) {
    final day = date.day.toString().padLeft(2, '0');
    final month = date.month.toString().padLeft(2, '0');
    final year = date.year.toString();
    return '$day/$month/$year';
  }
}
