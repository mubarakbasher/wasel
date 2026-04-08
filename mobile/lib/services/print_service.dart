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
  // Design colors
  // ---------------------------------------------------------------------------

  static final _headerDark = PdfColor.fromHex('#1a237e'); // Deep indigo
  static final _accentTeal = PdfColor.fromHex('#00897b'); // Teal
  static final _frameBrown = PdfColor.fromHex('#5d4037'); // Warm brown

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
    final double headerSize = (11 - (columns - 2) * 0.5).clamp(5.5, 13.0);
    final double labelSize = (7 - (columns - 2) * 0.3).clamp(3.5, 9.0);
    final double valueSize = (10 - (columns - 2) * 0.5).clamp(5.0, 12.0);
    final double pad = (5 - (columns - 2) * 0.25).clamp(2.0, 7.0);
    final double headerBandH = (height * 0.28).clamp(10.0, 30.0);

    return pw.Container(
      width: width,
      height: height,
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
            // Dark header band with business name
            pw.Container(
              height: headerBandH,
              color: _headerDark,
              alignment: pw.Alignment.center,
              padding: pw.EdgeInsets.symmetric(horizontal: pad),
              child: pw.Directionality(
                textDirection: pw.TextDirection.rtl,
                child: pw.Text(
                  businessName,
                  style: pw.TextStyle(
                    fontSize: headerSize,
                    fontWeight: pw.FontWeight.bold,
                    font: _arabicFont,
                    color: PdfColors.white,
                  ),
                  textAlign: pw.TextAlign.center,
                  maxLines: 1,
                ),
              ),
            ),

            // Body content
            pw.Expanded(
              child: pw.Padding(
                padding: pw.EdgeInsets.symmetric(
                    horizontal: pad, vertical: pad * 0.5),
                child: pw.Column(
                  mainAxisAlignment: pw.MainAxisAlignment.spaceEvenly,
                  crossAxisAlignment: pw.CrossAxisAlignment.stretch,
                  children: [
                    // Username row
                    pw.Directionality(
                      textDirection: pw.TextDirection.rtl,
                      child: pw.Column(
                        crossAxisAlignment: pw.CrossAxisAlignment.end,
                        children: [
                          pw.Text(
                            '\u0627\u0633\u0645 \u0627\u0644\u062f\u062e\u0648\u0644',
                            style: pw.TextStyle(
                              fontSize: labelSize,
                              font: _arabicFont,
                              color: PdfColors.grey600,
                            ),
                          ),
                          pw.SizedBox(height: pad * 0.15),
                          pw.Text(
                            v.username,
                            style: pw.TextStyle(
                              fontSize: valueSize,
                              fontWeight: pw.FontWeight.bold,
                              font: _arabicFont,
                              letterSpacing: 0.5,
                            ),
                            textAlign: pw.TextAlign.center,
                          ),
                        ],
                      ),
                    ),

                    // Accent divider
                    pw.Container(
                      height: 0.8,
                      color: _headerDark,
                      margin: pw.EdgeInsets.symmetric(
                          horizontal: width * 0.15),
                    ),

                    // Time/limit row
                    pw.Directionality(
                      textDirection: pw.TextDirection.rtl,
                      child: pw.Row(
                        mainAxisAlignment: pw.MainAxisAlignment.center,
                        children: [
                          pw.Text(
                            '\u0627\u0644\u0648\u0642\u062a: ',
                            style: pw.TextStyle(
                              fontSize: labelSize,
                              font: _arabicFont,
                              color: PdfColors.grey600,
                            ),
                          ),
                          pw.Text(
                            v.limitDisplayText,
                            style: pw.TextStyle(
                              fontSize: labelSize,
                              fontWeight: pw.FontWeight.bold,
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
    final double subtitleSize = (7 - (columns - 2) * 0.3).clamp(3.5, 9.0);
    final double labelSize = (6 - (columns - 2) * 0.25).clamp(3.0, 8.0);
    final double valueSize = (9 - (columns - 2) * 0.4).clamp(4.5, 11.0);
    final double pad = (5 - (columns - 2) * 0.25).clamp(2.0, 7.0);
    final double accentWidth = (3.0 - (columns - 2) * 0.15).clamp(1.5, 4.0);

    return pw.Container(
      width: width,
      height: height,
      decoration: pw.BoxDecoration(
        color: PdfColors.white,
        border: pw.Border(
          left: pw.BorderSide(color: _accentTeal, width: accentWidth),
          top: pw.BorderSide(color: PdfColors.grey300, width: 0.3),
          right: pw.BorderSide(color: PdfColors.grey300, width: 0.3),
          bottom: pw.BorderSide(color: PdfColors.grey300, width: 0.3),
        ),
      ),
      child: pw.Padding(
        padding: pw.EdgeInsets.only(
            left: pad, right: pad, top: pad * 0.6, bottom: pad * 0.4),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.stretch,
          children: [
            // Header: business name
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
                maxLines: 1,
              ),
            ),
            // Subtitle: plan/limit
            pw.Text(
              v.limitDisplayText,
              style: pw.TextStyle(
                fontSize: subtitleSize,
                color: _accentTeal,
                font: _arabicFont,
              ),
              textAlign: pw.TextAlign.center,
            ),
            pw.SizedBox(height: pad * 0.3),
            pw.Container(
              height: 0.5,
              color: PdfColors.grey300,
            ),
            pw.SizedBox(height: pad * 0.4),

            // Two-column: Username | Password
            pw.Expanded(
              child: pw.Row(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  // Username column
                  pw.Expanded(
                    child: pw.Column(
                      crossAxisAlignment: pw.CrossAxisAlignment.start,
                      children: [
                        pw.Text(
                          'USERNAME',
                          style: pw.TextStyle(
                            fontSize: labelSize,
                            color: PdfColors.grey500,
                            fontWeight: pw.FontWeight.bold,
                            letterSpacing: 0.5,
                          ),
                        ),
                        pw.SizedBox(height: pad * 0.2),
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
                  // Vertical separator
                  pw.Container(
                    width: 0.4,
                    height: height * 0.25,
                    color: PdfColors.grey300,
                    margin: pw.EdgeInsets.symmetric(horizontal: pad * 0.3),
                  ),
                  // Password column
                  pw.Expanded(
                    child: pw.Column(
                      crossAxisAlignment: pw.CrossAxisAlignment.end,
                      children: [
                        pw.Text(
                          'PASSWORD',
                          style: pw.TextStyle(
                            fontSize: labelSize,
                            color: PdfColors.grey500,
                            fontWeight: pw.FontWeight.bold,
                            letterSpacing: 0.5,
                          ),
                        ),
                        pw.SizedBox(height: pad * 0.2),
                        pw.Text(
                          v.password ?? '--------',
                          style: pw.TextStyle(
                            fontSize: valueSize,
                            fontWeight: pw.FontWeight.bold,
                            font: _arabicFont,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // Footer: price if available
            if (v.price != null && v.price! > 0)
              pw.Text(
                '${v.price!.toStringAsFixed(0)} \u062c\u0646\u064a\u0647',
                style: pw.TextStyle(
                  fontSize: labelSize,
                  color: PdfColors.grey500,
                  font: _arabicFont,
                ),
                textAlign: pw.TextAlign.right,
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
    final double headerSize = (10 - (columns - 2) * 0.5).clamp(5.0, 12.0);
    final double codeSize = (13 - (columns - 2) * 0.6).clamp(6.5, 15.0);
    final double footerSize = (7 - (columns - 2) * 0.3).clamp(3.5, 9.0);
    final double dotSize = (4 - (columns - 2) * 0.2).clamp(1.5, 5.0);
    final double gap = (3 - (columns - 2) * 0.15).clamp(1.0, 4.0);
    final double pad = (6 - (columns - 2) * 0.3).clamp(2.5, 8.0);

    return pw.Container(
      width: width,
      height: height,
      // Outer frame
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: _frameBrown, width: 0.8),
      ),
      child: pw.Stack(
        children: [
          // Inner frame with gap
          pw.Positioned(
            left: gap,
            top: gap,
            right: gap,
            bottom: gap,
            child: pw.Container(
              decoration: pw.BoxDecoration(
                border: pw.Border.all(color: _frameBrown, width: 0.4),
              ),
            ),
          ),

          // Corner dots (between outer and inner frame)
          ..._buildCornerDots(width, height, gap, dotSize),

          // Card content
          pw.Positioned(
            left: gap + pad,
            top: gap + pad * 0.5,
            right: gap + pad,
            bottom: gap + pad * 0.5,
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
                      color: _frameBrown,
                    ),
                    textAlign: pw.TextAlign.center,
                    maxLines: 1,
                  ),
                ),
                pw.SizedBox(height: pad * 0.3),

                // Decorative dot divider
                pw.Row(
                  mainAxisAlignment: pw.MainAxisAlignment.center,
                  children: List.generate(
                    3,
                    (_) => pw.Container(
                      width: dotSize * 0.5,
                      height: dotSize * 0.5,
                      margin: pw.EdgeInsets.symmetric(horizontal: dotSize * 0.4),
                      decoration: pw.BoxDecoration(
                        color: _frameBrown,
                        shape: pw.BoxShape.circle,
                      ),
                    ),
                  ),
                ),
                pw.SizedBox(height: pad * 0.3),

                // Voucher code (large, centered)
                pw.Text(
                  v.username,
                  style: pw.TextStyle(
                    fontSize: codeSize,
                    fontWeight: pw.FontWeight.bold,
                    font: _arabicFont,
                    letterSpacing: 1,
                  ),
                  textAlign: pw.TextAlign.center,
                ),
                pw.SizedBox(height: pad * 0.4),

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
                            color: PdfColors.grey700,
                          ),
                        )
                      else
                        pw.SizedBox(),
                      pw.Text(
                        v.limitDisplayText,
                        style: pw.TextStyle(
                          fontSize: footerSize,
                          font: _arabicFont,
                          color: PdfColors.grey700,
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

  /// Build small filled circles at each corner between the double frame.
  List<pw.Widget> _buildCornerDots(
      double width, double height, double gap, double dotSize) {
    final double offset = gap / 2 - dotSize / 2;
    return [
      // Top-left
      pw.Positioned(
        left: offset,
        top: offset,
        child: pw.Container(
          width: dotSize,
          height: dotSize,
          decoration: pw.BoxDecoration(
              color: _frameBrown, shape: pw.BoxShape.circle),
        ),
      ),
      // Top-right
      pw.Positioned(
        right: offset,
        top: offset,
        child: pw.Container(
          width: dotSize,
          height: dotSize,
          decoration: pw.BoxDecoration(
              color: _frameBrown, shape: pw.BoxShape.circle),
        ),
      ),
      // Bottom-left
      pw.Positioned(
        left: offset,
        bottom: offset,
        child: pw.Container(
          width: dotSize,
          height: dotSize,
          decoration: pw.BoxDecoration(
              color: _frameBrown, shape: pw.BoxShape.circle),
        ),
      ),
      // Bottom-right
      pw.Positioned(
        right: offset,
        bottom: offset,
        child: pw.Container(
          width: dotSize,
          height: dotSize,
          decoration: pw.BoxDecoration(
              color: _frameBrown, shape: pw.BoxShape.circle),
        ),
      ),
    ];
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
