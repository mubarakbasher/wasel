// mobile/lib/services/print/card_metrics.dart
//
// Classic type-ramp and shared pdf widget helpers used by all card templates.

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'grid_layout.dart';

// ---------------------------------------------------------------------------
// CardMetrics
// ---------------------------------------------------------------------------

/// Responsive font sizes and spacing derived from the column count.
/// Numbers are identical to the original _buildCard (L274–276 of print_service.dart).
class CardMetrics {
  /// Header font size in points.
  final double headerFs;

  /// Code font size in points.
  final double codeFs;

  /// Info-row font size in points.
  final double infoFs;

  /// Card padding in points.
  final double pad;

  /// Letter spacing for the voucher code in points.
  final double codeLetterSpacing;

  const CardMetrics({
    required this.headerFs,
    required this.codeFs,
    required this.infoFs,
    required this.pad,
    required this.codeLetterSpacing,
  });

  /// Compute metrics for the given [columns] count.
  factory CardMetrics.forColumns(int columns) {
    return CardMetrics(
      headerFs:          (11 - (columns - 2) * 1.0).clamp(7.0, 11.0),
      codeFs:            (16 - (columns - 2) * 1.5).clamp(10.0, 16.0),
      infoFs:            (9  - (columns - 2) * 0.6).clamp(6.6, 9.0),
      pad:               voucherCardPadding(columns),
      codeLetterSpacing: voucherCodeLetterSpacing(columns),
    );
  }
}

// ---------------------------------------------------------------------------
// Shared pdf widget helpers
// ---------------------------------------------------------------------------

final _arabicRegex =
    RegExp(r'[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]');

bool hasArabic(String s) => _arabicRegex.hasMatch(s);

pw.TextDirection textDirection(String s) =>
    hasArabic(s) ? pw.TextDirection.rtl : pw.TextDirection.ltr;

/// Hero voucher code rendered in Courier Bold with optional Arabic fallback font.
pw.Widget codeText(
  String code,
  double fontSize,
  double letterSpacing,
  pw.Font arabicFallback,
) {
  return pw.FittedBox(
    fit: pw.BoxFit.scaleDown,
    child: pw.Text(
      code,
      style: pw.TextStyle(
        fontSize: fontSize,
        font: pw.Font.courierBold(),
        fontWeight: pw.FontWeight.bold,
        letterSpacing: letterSpacing,
        fontFallback: [arabicFallback],
      ),
    ),
  );
}

/// `limit | validity` info row that scales as a single unit.
/// When [limitText] is null the separator and limit cell are omitted.
pw.Widget infoRow(
  String? limitText,
  String validityText,
  double fontSize,
  pw.Font cairo,
  pw.Font cairoBold,
) {
  return pw.FittedBox(
    fit: pw.BoxFit.scaleDown,
    child: pw.Row(
      mainAxisSize: pw.MainAxisSize.min,
      children: [
        if (limitText != null) ...[
          pw.Directionality(
            textDirection: textDirection(limitText),
            child: pw.Text(
              limitText,
              style: pw.TextStyle(
                fontSize: fontSize,
                font: cairoBold,
                fontWeight: pw.FontWeight.bold,
              ),
            ),
          ),
          pw.Container(
            width: 0.6,
            height: fontSize * 1.1,
            color: PdfColors.black,
            margin: pw.EdgeInsets.symmetric(horizontal: fontSize * 0.6),
          ),
        ],
        pw.Directionality(
          textDirection: textDirection(validityText),
          child: pw.Text(
            validityText,
            style: pw.TextStyle(fontSize: fontSize, font: cairo),
          ),
        ),
      ],
    ),
  );
}

/// Header text in a bounded SizedBox so FittedBox cannot balloon the height.
/// Height = [fs] * 2.4 exactly as the original _buildCard comment specifies.
pw.Widget boundedHeader(
  String text,
  double fs,
  pw.Font font, {
  PdfColor color = PdfColors.black,
  bool bold = true,
}) {
  return pw.SizedBox(
    height: fs * 2.4,
    child: pw.FittedBox(
      fit: pw.BoxFit.scaleDown,
      child: pw.Directionality(
        textDirection: textDirection(text),
        child: pw.Text(
          text,
          style: pw.TextStyle(
            fontSize: fs,
            font: font,
            fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
            color: color,
          ),
        ),
      ),
    ),
  );
}

/// QR code box sized to [maxSize] × [maxSize].
/// Encodes [data]; returns null when [data] is empty.
pw.Widget? qrBox(String data, double maxSize) {
  if (data.isEmpty) return null;
  return pw.SizedBox(
    width: maxSize,
    height: maxSize,
    child: pw.BarcodeWidget(
      barcode: pw.Barcode.qrCode(),
      data: data,
      drawText: false,
    ),
  );
}

/// A bordered rounded price pill, e.g. "10 USD".
/// Returns null when [priceText] is null.
pw.Widget? pricePill(String? priceText, double fontSize, pw.Font font) {
  if (priceText == null) return null;
  return pw.Container(
    padding: pw.EdgeInsets.symmetric(
      horizontal: fontSize * 0.6,
      vertical: fontSize * 0.2,
    ),
    decoration: pw.BoxDecoration(
      border: pw.Border.all(color: PdfColors.black, width: 0.5),
      borderRadius: pw.BorderRadius.circular(fontSize * 0.5),
    ),
    child: pw.Text(
      priceText,
      style: pw.TextStyle(fontSize: fontSize, font: font),
    ),
  );
}

/// A dashed horizontal rule implemented as a row of small containers
/// (pdf BorderStyle.dashed only works for Border.all, not per-side).
pw.Widget dashedRule({
  double height = 0.6,
  double dashW = 3,
  double gapW = 2,
  PdfColor color = PdfColors.black,
}) {
  return pw.LayoutBuilder(
    builder: (context, constraints) {
      final double totalW = constraints?.maxWidth ?? 500;
      final int count = (totalW / (dashW + gapW)).floor();
      return pw.Row(
        children: List.generate(count * 2 - 1, (i) {
          if (i.isOdd) return pw.SizedBox(width: gapW);
          return pw.Container(width: dashW, height: height, color: color);
        }),
      );
    },
  );
}
