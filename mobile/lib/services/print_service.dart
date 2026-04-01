import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../models/voucher.dart';

/// Service for generating printable PDF documents from vouchers.
///
/// Supports two layout modes:
/// - Thermal receipt (58mm width) for receipt printers
/// - A4 multi-voucher (8 per page) for standard printers
class PrintService {
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
