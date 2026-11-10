import 'dart:typed_data';

import 'package:printing/printing.dart';

import '../models/print_settings.dart';
import 'print_service.dart';

// ---------------------------------------------------------------------------
// Abstract interface
// ---------------------------------------------------------------------------

/// Renders a single-card thumbnail PNG for a given template.
///
/// The interface is injected so widget tests can supply a [FakeThumbnailRenderer]
/// that returns a canned 1×1 PNG without touching [Printing.raster] (which
/// throws [MissingPluginException] under `flutter test`).
abstract class ThumbnailRenderer {
  Future<Uint8List> render(
    VoucherTemplateId id,
    String routerName,
    PrintSettings sampleSettings,
    List<VoucherPrintItem> sampleItems,
  );
}

// ---------------------------------------------------------------------------
// Default production implementation
// ---------------------------------------------------------------------------

/// Renders a card-sized PDF with [PrintService.generateSampleCardPdf] (page
/// dimensions = card + 4pt margin), rasterises the first page at 144 dpi, and
/// returns the PNG bytes.
///
/// Using a card-sized page instead of a full A4 sheet means the thumbnail
/// shows the complete card at a readable size rather than a tiny card on a
/// mostly-blank A4 background.
class DefaultThumbnailRenderer implements ThumbnailRenderer {
  final PrintService _printService;

  DefaultThumbnailRenderer({PrintService? printService})
      : _printService = printService ?? PrintService();

  @override
  Future<Uint8List> render(
    VoucherTemplateId id,
    String routerName,
    PrintSettings sampleSettings,
    List<VoucherPrintItem> sampleItems,
  ) async {
    final item = sampleItems.isNotEmpty
        ? sampleItems.first
        : kThumbnailSampleItems.first;

    final thumbSettings = sampleSettings.copyWith(templateId: id);

    final pdfBytes = await _printService.generateSampleCardPdf(
      item,
      routerName,
      settings: thumbSettings,
    );

    // Rasterise the single card page at 144 dpi — cheap because the page is
    // the size of one card, not a full A4 sheet.
    final image = await Printing.raster(pdfBytes, pages: [0], dpi: 144).first;
    return image.toPng();
  }
}

// ---------------------------------------------------------------------------
// Sample items used by the renderer
// ---------------------------------------------------------------------------

const List<VoucherPrintItem> kThumbnailSampleItems = [
  VoucherPrintItem(
    code: '12345678',
    limitText: '1 GB',
    validityText: '7 days',
    priceText: null,
    batchLabel: '261101-1430',
  ),
  VoucherPrintItem(
    code: '87654321',
    limitText: '1 GB',
    validityText: '7 days',
    priceText: null,
    batchLabel: '261101-1430',
  ),
];
