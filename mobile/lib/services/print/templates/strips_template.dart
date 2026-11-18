// mobile/lib/services/print/templates/strips_template.dart
//
// Strips template: one voucher per full-width row, stripsPerPage rows per A4,
// stripsColumns columns per row (1–3).
//
// 1 column: full-width horizontal strip (name | code | price/batch).
// 2–3 columns: compact stacked card (name/batch · code · limit·validity/price).

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:wasel/models/print_settings.dart';
import '../card_metrics.dart';
import '../card_template.dart';
import '../grid_layout.dart';

class StripsTemplate extends VoucherCardTemplate {
  const StripsTemplate();

  @override
  VoucherTemplateId get id => VoucherTemplateId.strips;

  @override
  VoucherGridLayout layoutFor(int columns, PrintKnobs knobs) {
    final int rows = knobs.stripsPerPage; // 4..12
    final int cols = knobs.stripsColumns.clamp(kMinStripsColumns, kMaxStripsColumns);
    final pageFormat = PdfPageFormat.a4.copyWith(
      marginLeft: kPrintMarginH,
      marginRight: kPrintMarginH,
      marginTop: kPrintMarginV,
      marginBottom: kPrintMarginV,
    );
    final double usableW = pageFormat.availableWidth;
    final double usableH = pageFormat.availableHeight;
    final double cardH = (usableH - kPrintGutterV * (rows - 1)) / rows;
    final double cardW = (usableW - kPrintGutterH * (cols - 1)) / cols;
    return VoucherGridLayout(
      cardW: cardW,
      cardH: cardH,
      rows: rows,
      columns: cols,
    );
  }

  @override
  pw.Widget buildCard(CardContext ctx) {
    if (ctx.style.knobs.stripsColumns == 1) return _fullWidthStrip(ctx);
    return _compactStrip(ctx);
  }

  // ── 1-column full-width strip (unchanged from git HEAD) ───────────────────

  pw.Widget _fullWidthStrip(CardContext ctx) {
    final double h = ctx.h;
    final double w = ctx.w;

    // Type ramp derived from row height.
    final double codeFs   = (h * 0.32).clamp(12.0, 30.0);
    final double headerFs = (h * 0.16).clamp(8.0, 14.0);
    final double infoFs   = (h * 0.12).clamp(6.6, 10.0);
    // Pad and letter spacing from the columns=4 ramp for consistent margins.
    final double pad              = voucherCardPadding(4);
    final double codeLetterSpacing = voucherCodeLetterSpacing(4);

    final item = ctx.item;
    final style = ctx.style;
    final knobs = style.knobs;

    return pw.Container(
      width: w,
      height: h,
      padding: pw.EdgeInsets.symmetric(
        horizontal: pad,
        vertical: pad * 0.5,
      ),
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: PdfColors.black, width: 0.5),
      ),
      child: pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.center,
        children: [
          // Start block: header + small limit·validity
          pw.SizedBox(
            width: w * 0.25,
            child: pw.Column(
              mainAxisAlignment: pw.MainAxisAlignment.center,
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.SizedBox(
                  height: headerFs * 2.4,
                  child: pw.FittedBox(
                    fit: pw.BoxFit.scaleDown,
                    child: pw.Directionality(
                      textDirection: textDirection(style.headerText),
                      child: pw.Text(
                        style.headerText,
                        style: pw.TextStyle(
                          fontSize: headerFs,
                          font: style.cairoBold,
                          fontWeight: pw.FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                ),
                pw.SizedBox(
                  height: infoFs * 2.4,
                  child: pw.FittedBox(
                    fit: pw.BoxFit.scaleDown,
                    child: pw.Row(
                      mainAxisSize: pw.MainAxisSize.min,
                      children: [
                        if (item.limitText != null) ...[
                          pw.Directionality(
                            textDirection: textDirection(item.limitText!),
                            child: pw.Text(
                              item.limitText!,
                              style: pw.TextStyle(
                                fontSize: infoFs,
                                font: style.cairoBold,
                              ),
                            ),
                          ),
                          pw.Text(
                            ' · ',
                            style: pw.TextStyle(
                              fontSize: infoFs,
                              font: style.cairo,
                            ),
                          ),
                        ],
                        pw.Directionality(
                          textDirection: textDirection(item.validityText),
                          child: pw.Text(
                            item.validityText,
                            style: pw.TextStyle(
                              fontSize: infoFs,
                              font: style.cairo,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          pw.SizedBox(width: pad),
          pw.Container(width: 0.5, height: h * 0.6, color: PdfColors.grey400),
          pw.SizedBox(width: pad),
          // Middle: large code — FittedBox so very long codes still shrink.
          pw.Expanded(
            child: pw.Center(
              child: codeText(
                item.code,
                codeFs,
                codeLetterSpacing,
                style.cairo,
              ),
            ),
          ),
          // End block: price + batch label
          if (knobs.showPrice || (knobs.showBatch && item.batchLabel != null)) ...[
            pw.SizedBox(width: pad),
            pw.Container(width: 0.5, height: h * 0.6, color: PdfColors.grey400),
            pw.SizedBox(width: pad),
            pw.SizedBox(
              width: w * 0.15,
              child: pw.Column(
                mainAxisAlignment: pw.MainAxisAlignment.center,
                crossAxisAlignment: pw.CrossAxisAlignment.end,
                children: [
                  if (knobs.showPrice && item.priceText != null)
                    pw.SizedBox(
                      height: infoFs * 2.4,
                      child: pw.FittedBox(
                        fit: pw.BoxFit.scaleDown,
                        child: pw.Text(
                          item.priceText!,
                          style: pw.TextStyle(
                            fontSize: infoFs,
                            font: style.cairo,
                          ),
                        ),
                      ),
                    ),
                  if (knobs.showBatch && item.batchLabel != null)
                    pw.SizedBox(
                      height: infoFs * 2.4,
                      child: pw.FittedBox(
                        fit: pw.BoxFit.scaleDown,
                        child: pw.Text(
                          item.batchLabel!,
                          style: pw.TextStyle(
                            fontSize: infoFs * 0.85,
                            font: style.cairo,
                            color: PdfColors.grey600,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  // ── 2–3 column compact stacked card ───────────────────────────────────────

  /// A single scaled-down line inside a fixed-size box. Empty or blank [text]
  /// gives an empty box of the same size: a FittedBox around an empty Text
  /// asserts in the pdf engine.
  pw.Widget _scaledLine({
    required double width,
    required double height,
    required String text,
    required pw.Font font,
    required double fontSize,
    pw.Alignment alignment = pw.Alignment.centerLeft,
    PdfColor? color,
  }) {
    if (text.trim().isEmpty) return pw.SizedBox(width: width, height: height);
    return pw.SizedBox(
      width: width,
      height: height,
      child: pw.FittedBox(
        fit: pw.BoxFit.scaleDown,
        alignment: alignment,
        child: pw.Padding(
          padding: pw.EdgeInsets.symmetric(horizontal: fontSize * 0.12),
          child: pw.Directionality(
            textDirection: textDirection(text),
            child: pw.Text(
              text,
              style: pw.TextStyle(
                fontSize: fontSize,
                font: font,
                color: color,
              ),
            ),
          ),
        ),
      ),
    );
  }

  pw.Widget _compactStrip(CardContext ctx) {
    final double w = ctx.w;
    final double h = ctx.h;
    final int cols = ctx.columns;
    final item = ctx.item;
    final style = ctx.style;
    final knobs = style.knobs;

    // ── Geometry ──────────────────────────────────────────────────────────────
    final double padH = cols == 3 ? 4.0 : 5.0; // compact path: cols is 2 or 3
    final double padV = (h * 0.06).clamp(2.0, 8.0);
    final double iw = w - 2 * padH;
    final double ih = h - 2 * padV;

    double topH  = (ih * 0.22).clamp(9.0, 20.0);
    double codeH = (ih * 0.44).clamp(18.0, 46.0);
    double botH  = (ih * 0.22).clamp(9.0, 20.0);

    final double bandSum = topH + codeH + botH;
    if (bandSum > ih) {
      final double scale = ih / bandSum;
      topH  *= scale;
      codeH *= scale;
      botH  *= scale;
    }

    final double headerFs = topH / 1.9;
    final double infoFs   = botH / 1.9;
    final double codeFs   = (codeH / 1.2).clamp(8.0, 30.0);
    final double codeLetterSpacing = cols == 2 ? 1.0 : 0.6;
    const double gap = 4.0;

    bool present(String? s) => s != null && s.trim().isNotEmpty;
    final bool hasBatch = knobs.showBatch && present(item.batchLabel);
    final bool hasPrice = knobs.showPrice && present(item.priceText);
    final bool hasLimit = present(item.limitText);

    final double batchW = iw * 0.30;
    final double priceW = iw * 0.32;
    final double nameW  = hasBatch ? iw - batchW - gap : iw;
    final double infoW  = hasPrice ? iw - priceW - gap : iw;

    // ── Top row: name (left) + optional batch (right) ─────────────────────────
    final pw.Widget topRow = pw.Row(
      mainAxisSize: pw.MainAxisSize.max,
      children: [
        _scaledLine(
          width: nameW,
          height: topH,
          text: style.headerText,
          font: style.cairoBold,
          fontSize: headerFs,
          alignment: pw.Alignment.centerLeft,
        ),
        if (hasBatch) ...[
          pw.SizedBox(width: gap),
          _scaledLine(
            width: batchW,
            height: topH,
            text: item.batchLabel!,
            font: style.cairo,
            fontSize: headerFs * 0.8,
            alignment: pw.Alignment.centerRight,
            color: PdfColors.grey700,
          ),
        ],
      ],
    );

    // ── Middle row: code centred ───────────────────────────────────────────────
    final pw.Widget codeRow = pw.SizedBox(
      width: iw,
      height: codeH,
      child: pw.Center(
        child: codeText(item.code, codeFs, codeLetterSpacing, style.cairo),
      ),
    );

    // ── Bottom row: limit·validity (left) + optional price (right) ───────────
    // Limit + validity are a Row(min) of 2–3 Texts inside the same scaled box.
    final pw.Widget limitValidity = pw.Row(
      mainAxisSize: pw.MainAxisSize.min,
      children: [
        if (hasLimit) ...[
          pw.Directionality(
            textDirection: textDirection(item.limitText!),
            child: pw.Text(
              item.limitText!,
              style: pw.TextStyle(fontSize: infoFs, font: style.cairoBold),
            ),
          ),
          pw.Text(
            ' · ',
            style: pw.TextStyle(fontSize: infoFs, font: style.cairo),
          ),
        ],
        pw.Directionality(
          textDirection: textDirection(item.validityText),
          child: pw.Text(
            item.validityText,
            style: pw.TextStyle(fontSize: infoFs, font: style.cairo),
          ),
        ),
      ],
    );

    final pw.Widget botRow = pw.Row(
      mainAxisSize: pw.MainAxisSize.max,
      children: [
        pw.SizedBox(
          width: infoW,
          height: botH,
          child: pw.FittedBox(
            fit: pw.BoxFit.scaleDown,
            alignment: pw.Alignment.centerLeft,
            child: pw.Padding(
              padding: pw.EdgeInsets.symmetric(horizontal: infoFs * 0.12),
              child: limitValidity,
            ),
          ),
        ),
        if (hasPrice) ...[
          pw.SizedBox(width: gap),
          _scaledLine(
            width: priceW,
            height: botH,
            text: item.priceText!,
            font: style.cairo,
            fontSize: infoFs,
            alignment: pw.Alignment.centerRight,
          ),
        ],
      ],
    );

    return pw.Container(
      width: w,
      height: h,
      padding: pw.EdgeInsets.symmetric(horizontal: padH, vertical: padV),
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: PdfColors.black, width: 0.5),
      ),
      child: pw.Column(
        mainAxisAlignment: pw.MainAxisAlignment.center,
        children: [
          topRow,
          codeRow,
          botRow,
        ],
      ),
    );
  }
}
