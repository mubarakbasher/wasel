// mobile/lib/services/print/templates/classic_template.dart
//
// Classic template: today's _buildCard body moved verbatim.
//
// Parity rule: when showPrice is false (the default) or priceText is null,
// the body must remain EXACTLY the original Column(spaceEvenly, [codeText,
// infoRow]) inside Expanded — producing byte-equivalent output to the
// pre-template print_service.dart.
//
// When showPrice is true AND priceText is non-null a third line must be drawn.
// The original spaceEvenly layout silently drops trailing children once the
// available height is exhausted, so we switch to a bounded layout: pre-compute
// bodyH, replace Expanded with SizedBox(bodyH), and give each line a
// proportional SizedBox(height: share * bodyH, child: Center(child: ...)) so
// all three lines always shrink to fit instead of being clipped.

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:wasel/models/print_settings.dart';
import '../card_metrics.dart';
import '../card_template.dart';

class ClassicTemplate extends VoucherCardTemplate {
  const ClassicTemplate();

  @override
  VoucherTemplateId get id => VoucherTemplateId.classic;

  @override
  pw.Widget buildCard(CardContext ctx) {
    final m = CardMetrics.forColumns(ctx.columns);
    final item = ctx.item;
    final style = ctx.style;
    final w = ctx.w;
    final h = ctx.h;

    final bool showPriceLine =
        style.knobs.showPrice && item.priceText != null;

    return pw.Container(
      width: w,
      height: h,
      padding: pw.EdgeInsets.symmetric(
        horizontal: m.pad,
        vertical: m.pad * 0.75,
      ),
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: PdfColors.black, width: 0.7),
        borderRadius: pw.BorderRadius.circular(3),
      ),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          // Header: bounded FittedBox — prevents balloon on short names.
          boundedHeader(style.headerText, m.headerFs, style.cairoBold),
          pw.SizedBox(height: m.pad * 0.4),
          pw.Container(height: 0.8, color: PdfColors.black),

          if (showPriceLine)
            // --- Bounded body (three lines, price path) ---
            // Use Expanded + pw.Flexible(fit: tight) instead of a pre-computed
            // SizedBox body. The Expanded pattern is proven to work (see parity
            // path below). Flexible(fit: tight) forces each child to fill its
            // proportional slice of the Expanded height so FittedBox always
            // receives bounded constraints and renders correctly.
            // crossAxisAlignment.stretch ensures children get the full card
            // width even though each child is a Flexible (not a SizedBox).
            pw.Expanded(
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.stretch,
                children: [
                  pw.Flexible(
                    flex: 50,
                    fit: pw.FlexFit.tight,
                    child: codeText(
                      item.code,
                      m.codeFs,
                      m.codeLetterSpacing,
                      style.cairo,
                    ),
                  ),
                  pw.Flexible(
                    flex: 28,
                    fit: pw.FlexFit.tight,
                    child: infoRow(
                      item.limitText,
                      item.validityText,
                      m.infoFs,
                      style.cairo,
                      style.cairoBold,
                    ),
                  ),
                  pw.Flexible(
                    flex: 22,
                    fit: pw.FlexFit.tight,
                    child: pw.FittedBox(
                      fit: pw.BoxFit.scaleDown,
                      child: pw.Directionality(
                        textDirection: textDirection(item.priceText!),
                        child: pw.Text(
                          item.priceText!,
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
            )
          else
            // --- Original body (parity path, two lines, spaceEvenly) ---
            pw.Expanded(
              child: pw.Column(
                mainAxisAlignment: pw.MainAxisAlignment.spaceEvenly,
                children: [
                  codeText(
                    item.code,
                    m.codeFs,
                    m.codeLetterSpacing,
                    style.cairo,
                  ),
                  infoRow(
                    item.limitText,
                    item.validityText,
                    m.infoFs,
                    style.cairo,
                    style.cairoBold,
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
