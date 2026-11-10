// mobile/lib/services/print/templates/detailed_template.dart
//
// Detailed template: black header band, code, info row, price pill,
// thin-rule footer, optional QR box.
//
// Layout notes:
// - Outer Column uses crossAxisAlignment.stretch so all children fill the
//   card width automatically.
// - The body Column does NOT use crossAxisAlignment.stretch because that would
//   pass tight (zero) height constraints to FittedBox children, causing the
//   pdf engine to assert 'width > 0.0' on the transform.

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:wasel/models/print_settings.dart';
import '../card_metrics.dart';
import '../card_template.dart';

class DetailedTemplate extends VoucherCardTemplate {
  const DetailedTemplate();

  @override
  VoucherTemplateId get id => VoucherTemplateId.detailed;

  @override
  pw.Widget buildCard(CardContext ctx) {
    final m = CardMetrics.forColumns(ctx.columns);
    final item = ctx.item;
    final style = ctx.style;
    final w = ctx.w;
    final h = ctx.h;
    final knobs = style.knobs;

    // Header band height ≈ headerFs * 2.0.
    final double bandH = m.headerFs * 2.0;
    // Footer = rule (1pt) + gap (2pt) + text height + bottom padding.
    final double footerTextH = m.infoFs * 2.0;
    final double footerH = 1 + 2 + footerTextH + m.pad * 0.3;
    // Body fills the rest.
    final double bodyH = (h - bandH - footerH).clamp(10.0, h);

    // QR box sized ≤ h * 0.8.
    final double qrSize = (h * 0.8).clamp(10.0, bodyH - m.pad * 0.6);
    final qrData = (knobs.showQr && knobs.hotspotAddress.isNotEmpty)
        ? 'http://${knobs.hotspotAddress}/login'
            '?username=${item.code}&password=${item.code}'
        : null;
    final qr = qrData != null ? qrBox(qrData, qrSize) : null;

    return pw.Container(
      width: w,
      height: h,
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: PdfColors.black, width: 0.7),
        borderRadius: pw.BorderRadius.circular(3),
      ),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          // ---- Black header band ----
          pw.Container(
            width: w,
            height: bandH,
            color: PdfColors.black,
            padding: pw.EdgeInsets.symmetric(horizontal: m.pad * 0.75),
            child: pw.Row(
              mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
              crossAxisAlignment: pw.CrossAxisAlignment.center,
              children: [
                pw.Expanded(
                  child: boundedHeader(
                    style.headerText,
                    m.headerFs,
                    style.cairoBold,
                    color: PdfColors.white,
                    bold: true,
                  ),
                ),
                if (knobs.showBatch && item.batchLabel != null) ...[
                  pw.SizedBox(width: 4),
                  // Fixed-width block so FittedBox always gets positive width
                  // (the Expanded sibling consumes remaining space otherwise).
                  pw.SizedBox(
                    width: m.infoFs * 5,
                    height: m.headerFs * 2.4,
                    child: pw.FittedBox(
                      fit: pw.BoxFit.scaleDown,
                      child: pw.Text(
                        item.batchLabel!,
                        style: pw.TextStyle(
                          fontSize: m.infoFs,
                          font: style.cairo,
                          color: PdfColors.white,
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),

          // ---- Body ----
          // Always use the bounded layout: pre-assign proportional height
          // shares to each line so trailing widgets cannot be dropped by the
          // pdf Flex when available height is tight.
          pw.SizedBox(
            height: bodyH,
            child: pw.Padding(
              padding: pw.EdgeInsets.symmetric(
                horizontal: m.pad,
                vertical: m.pad * 0.3,
              ),
              child: _buildBody(
                item: item,
                style: style,
                m: m,
                innerH: (bodyH - m.pad * 0.6).clamp(10.0, bodyH),
                qr: qr,
              ),
            ),
          ),

          // ---- Footer: thin rule + how-to text ----
          pw.Padding(
            padding: pw.EdgeInsets.only(
              left: m.pad,
              right: m.pad,
              bottom: m.pad * 0.3,
            ),
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.stretch,
              children: [
                pw.Container(height: 1, color: PdfColors.grey400),
                pw.SizedBox(height: 2),
                // Only render footer text when non-empty: FittedBox wrapping
                // an empty Text has width=0 which asserts in the pdf engine.
                if (style.footerText.isNotEmpty)
                  pw.SizedBox(
                    height: footerTextH,
                    child: pw.FittedBox(
                      fit: pw.BoxFit.scaleDown,
                      child: pw.Directionality(
                        textDirection: textDirection(style.footerText),
                        child: pw.Text(
                          style.footerText,
                          style: pw.TextStyle(
                            fontSize: m.infoFs,
                            font: style.cairo,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Build the body Row: bounded proportional-height children in a Column so
  /// every line always renders regardless of available height.
  ///
  /// Shares with price: code 0.46, info 0.26, price 0.20, bottom-spacer 0.08.
  /// The 0.08 spacer creates clearance between the price pill and the footer
  /// rule so the rule does not appear to strike through the pill border.
  ///
  /// crossAxisAlignment.stretch on the inner Column is required so each
  /// SizedBox child resolves to the full available width rather than minWidth=0.
  pw.Widget _buildBody({
    required VoucherCardItem item,
    required PrintStyle style,
    required CardMetrics m,
    required double innerH,
    required pw.Widget? qr,
  }) {
    final knobs = style.knobs;
    final bool showPriceLine = knobs.showPrice && item.priceText != null;

    // Height shares (sum = 1.0 in both branches):
    //   without price: code 0.62, info 0.38
    //   with price:    code 0.46, info 0.26, price 0.20, spacer 0.08
    final double codeH    = innerH * (showPriceLine ? 0.46 : 0.62);
    final double infoH    = innerH * (showPriceLine ? 0.26 : 0.38);
    final double priceH   = innerH * 0.20;
    final double spacerH  = innerH * 0.08;

    // Size the pill font from the row height so it always fits, even at
    // tight columns. min(infoFs, priceH * 0.55) keeps the border+padding
    // proportional to the available row slice.
    final double pillFs = showPriceLine
        ? (priceH * 0.55).clamp(4.0, m.infoFs)
        : m.infoFs;

    return pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.center,
      children: [
        pw.Expanded(
          child: pw.Column(
            // stretch is required: without it, SizedBox children with no
            // explicit width resolve to minWidth=0 in the pdf Flex, making
            // FittedBox receive a zero-width box and draw nothing.
            crossAxisAlignment: pw.CrossAxisAlignment.stretch,
            children: [
              pw.SizedBox(
                height: codeH,
                child: pw.Center(
                  child: codeText(
                    item.code,
                    m.codeFs,
                    m.codeLetterSpacing,
                    style.cairo,
                  ),
                ),
              ),
              pw.SizedBox(
                height: infoH,
                child: pw.Center(
                  child: infoRow(
                    item.limitText,
                    item.validityText,
                    m.infoFs,
                    style.cairo,
                    style.cairoBold,
                  ),
                ),
              ),
              if (showPriceLine) ...[
                pw.SizedBox(
                  height: priceH,
                  child: pw.Center(
                    // FittedBox ensures the pill + its border+padding scale
                    // down proportionally when the row is tight.
                    child: pw.FittedBox(
                      fit: pw.BoxFit.scaleDown,
                      child: pricePill(item.priceText, pillFs, style.cairo)!,
                    ),
                  ),
                ),
                // Bottom spacer: separates price pill from the footer rule
                // so the rule does not strike through the pill border.
                pw.SizedBox(height: spacerH),
              ],
            ],
          ),
        ),
        if (qr != null) ...[
          pw.SizedBox(width: m.pad * 0.5),
          qr,
        ],
      ],
    );
  }
}
