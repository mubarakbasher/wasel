import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:pdf/pdf.dart';
import 'package:printing/printing.dart';

import '../../i18n/app_localizations.dart';
import '../../i18n/voucher_format.dart';
import '../../models/voucher.dart';
import '../../services/print_service.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';
import '../../utils/serial_build_cache.dart';

class VoucherPrintScreen extends StatefulWidget {
  final List<Voucher> vouchers;
  final String routerName;

  /// Optional [PrintService] override used by widget tests to inject a fake
  /// service without spawning real isolates.
  final PrintService? printService;

  const VoucherPrintScreen({
    super.key,
    required this.vouchers,
    required this.routerName,
    this.printService,
  });

  @override
  State<VoucherPrintScreen> createState() => _VoucherPrintScreenState();
}

class _VoucherPrintScreenState extends State<VoucherPrintScreen> {
  /// Maximum number of pages rendered in the live preview.  Pages beyond this
  /// cap are omitted from [PdfPreview] to avoid the native rasteriser allocating
  /// ~12 MB per page for a 300-page PDF.  Print/share are unaffected — the full
  /// PDF is handed directly to the OS without in-app rasterisation.
  static const int _kMaxPreviewPages = 12;

  /// Live value shown by the slider thumb and the label next to it.
  /// Updated on every drag tick via [onChanged] so the UI feels responsive.
  int _sliderColumns = 4;

  /// Committed value that drives the [PdfPreview] [ValueKey] and the PDF build.
  /// Only updated on [onChangeEnd] to avoid triggering a new preview render on
  /// every drag tick.
  int _previewColumns = 4;

  /// Monotonically-increasing generation counter.  Incremented whenever
  /// [_previewColumns] changes so in-flight builds from the previous
  /// generation are detected as stale and throw [StaleBuildException].
  int _generation = 0;

  /// Serialises PDF builds and caches the last result by column count.
  final SerialBuildCache<int, Uint8List> _buildCache = SerialBuildCache();

  late final PrintService _printService =
      widget.printService ?? PrintService();

  /// Stable tear-off passed to [PdfPreview.build].
  ///
  /// Captures [_previewColumns] and [_generation] synchronously so the closure
  /// always targets the column/generation that was live when the method was
  /// called — not whatever values happen to be current when the enqueue'd build
  /// eventually runs.
  ///
  /// The [format] parameter is accepted to satisfy [PdfPreview]'s callback
  /// signature but is intentionally ignored: [PrintService] hardcodes A4, and
  /// the cache must be format-agnostic so print/share callbacks (which pass the
  /// actual page format) still cache-hit against the preview build.
  Future<Uint8List> _generatePdf(PdfPageFormat format) {
    final columns = _previewColumns;
    final generation = _generation;
    return _buildCache.enqueue(
      key: columns,
      isStale: () => !mounted || generation != _generation,
      build: () {
        final items = widget.vouchers
            .map((v) => VoucherPrintItem(
                  code: v.username,
                  limitText: voucherLimitTextOrNull(context, v),
                  validityText: voucherValidityText(context, v.validitySeconds),
                ))
            .toList();
        return _printService.generateVouchersPdf(
          items,
          widget.routerName,
          columns: columns,
          docTitle: context.tr('vouchers.pdfDocTitle'),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final totalPages =
        voucherPdfPageCount(widget.vouchers.length, _previewColumns);
    final previewTruncated = totalPages > _kMaxPreviewPages;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: Text(context.tr('vouchers.printVouchers'))),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ColumnSliderBar(
            sliderColumns: _sliderColumns,
            voucherCount: widget.vouchers.length,
            onChanged: (v) => setState(() => _sliderColumns = v),
            onChangeEnd: (v) {
              if (v == _previewColumns) return;
              setState(() {
                _previewColumns = v;
                _generation++;
              });
            },
          ),
          if (previewTruncated)
            _PreviewPageCapNote(
              firstPages: _kMaxPreviewPages,
              totalPages: totalPages,
            ),
          const Divider(height: 1, color: AppColors.border),
          Expanded(
            child: PdfPreview(
              key: ValueKey('vouchers_$_previewColumns'),
              build: _generatePdf,
              canChangePageFormat: false,
              canChangeOrientation: false,
              canDebug: false,
              pdfFileName:
                  'wasel_vouchers_${DateTime.now().millisecondsSinceEpoch}.pdf',
              pages: previewTruncated
                  ? List<int>.generate(_kMaxPreviewPages, (i) => i)
                  : null,
            ),
          ),
        ],
      ),
    );
  }
}

/// One-line footnote shown between the column-slider bar and the PDF preview
/// when the preview is capped to the first [_kMaxPreviewPages] pages.
class _PreviewPageCapNote extends StatelessWidget {
  final int firstPages;
  final int totalPages;

  const _PreviewPageCapNote({
    required this.firstPages,
    required this.totalPages,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.sm),
      child: Text(
        context.tr('vouchers.previewFirstPages', [
          firstPages.toString(),
          totalPages.toString(),
        ]),
        style: AppTypography.footnote.copyWith(
          color: AppColors.textSecondary,
        ),
      ),
    );
  }
}

/// Extracted widget so [VoucherPrintScreenState.build] stays under ~50 lines.
class _ColumnSliderBar extends StatelessWidget {
  final int sliderColumns;
  final int voucherCount;
  final ValueChanged<int> onChanged;
  final ValueChanged<int> onChangeEnd;

  const _ColumnSliderBar({
    required this.sliderColumns,
    required this.voucherCount,
    required this.onChanged,
    required this.onChangeEnd,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                context.tr('vouchers.columns', [sliderColumns.toString()]),
                style: AppTypography.footnote.copyWith(
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: SliderTheme(
                  data: SliderTheme.of(context).copyWith(
                    trackHeight: 2,
                    thumbShape: const RoundSliderThumbShape(
                      enabledThumbRadius: 8,
                    ),
                  ),
                  child: Slider(
                    value: sliderColumns.toDouble(),
                    min: 2,
                    max: 6,
                    divisions: 4,
                    activeColor: AppColors.primary,
                    onChanged: (v) => onChanged(v.round()),
                    onChangeEnd: (v) => onChangeEnd(v.round()),
                  ),
                ),
              ),
            ],
          ),
          Text(
            context.tr('vouchers.readyToPrint', [voucherCount.toString()]),
            style: AppTypography.footnote.copyWith(
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}
