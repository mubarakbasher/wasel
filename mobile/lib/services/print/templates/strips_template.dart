// mobile/lib/services/print/templates/strips_template.dart
//
// Strips template: one voucher per full-width row, stripsPerPage rows per A4.
//
// Type ramp is derived from the row height h rather than a fixed column count:
//   codeFs   = (h * 0.32).clamp(12, 30)
//   headerFs = (h * 0.16).clamp(8, 14)
//   infoFs   = (h * 0.12).clamp(6.6, 10)
// This keeps text readable at all strip counts (4 → ~200pt rows, 12 → ~65pt).

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
    final int n = knobs.stripsPerPage; // 4..12
    final pageFormat = PdfPageFormat.a4.copyWith(
      marginLeft: kPrintMarginH,
      marginRight: kPrintMarginH,
      marginTop: kPrintMarginV,
      marginBottom: kPrintMarginV,
    );
    final double usableW = pageFormat.availableWidth;
    final double usableH = pageFormat.availableHeight;
    final double cardH = (usableH - kPrintGutterV * (n - 1)) / n;
    return VoucherGridLayout(
      cardW: usableW,
      cardH: cardH,
      rows: n,
      columns: 1,
    );
  }

  @override
  pw.Widget buildCard(CardContext ctx) {
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
}
