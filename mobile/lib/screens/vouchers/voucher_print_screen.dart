import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pdf/pdf.dart';
import 'package:printing/printing.dart';

import '../../i18n/app_localizations.dart';
import '../../i18n/status_format.dart';
import '../../i18n/voucher_format.dart';
import '../../models/print_settings.dart';
import '../../models/voucher.dart';
import '../../providers/print_settings_provider.dart';
import '../../services/print_service.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';
import '../../utils/serial_build_cache.dart';
import '../../widgets/column_slider_bar.dart';

/// Formats a [DateTime] as `yyMMdd-HHmm` (e.g. `261101-1430`) without the
/// `intl` package, which is not in this project's pubspec.
String _batchLabel(DateTime dt) {
  final local = dt.toLocal();
  final yy = local.year.toString().substring(2);
  final mm = local.month.toString().padLeft(2, '0');
  final dd = local.day.toString().padLeft(2, '0');
  final hh = local.hour.toString().padLeft(2, '0');
  final min = local.minute.toString().padLeft(2, '0');
  return '$yy$mm$dd-$hh$min';
}

class VoucherPrintScreen extends ConsumerStatefulWidget {
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
  ConsumerState<VoucherPrintScreen> createState() => _VoucherPrintScreenState();
}

class _VoucherPrintScreenState extends ConsumerState<VoucherPrintScreen> {
  /// Maximum number of pages rendered in the live preview.
  static const int _kMaxPreviewPages = 12;

  int _sliderColumns = 4;
  int _previewColumns = 4;
  int _generation = 0;

  /// Whether columns have been initialised from [PrintSettings.defaultColumns].
  bool _columnsInitialised = false;

  final SerialBuildCache<String, Uint8List> _buildCache = SerialBuildCache();

  late final PrintService _printService =
      widget.printService ?? PrintService();

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      final state = ref.read(printSettingsProvider);
      if (state.isEmpty) {
        ref.read(printSettingsProvider.notifier).load();
      }
    });
  }

  /// Called once after settings are available to seed the column slider from
  /// [PrintSettings.defaultColumns].
  void _maybeInitColumns(PrintSettings s) {
    if (_columnsInitialised) return;
    _columnsInitialised = true;
    final cols = s.defaultColumns.clamp(kMinPrintColumns, kMaxPrintColumns);
    if (cols != _sliderColumns) {
      // Schedule setState for next frame — we may be inside build.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          setState(() {
            _sliderColumns = cols;
            _previewColumns = cols;
          });
        }
      });
    }
  }

  Future<Uint8List> _generatePdf(PdfPageFormat format) {
    final columns = _previewColumns;
    final generation = _generation;
    final settings =
        ref.read(printSettingsProvider).settings ?? const PrintSettings();
    final cacheKey = '$columns|${settings.cacheKey}';
    final howTo = context.tr('print.howToDefault');

    return _buildCache.enqueue(
      key: cacheKey,
      isStale: () => !mounted || generation != _generation,
      build: () {
        final items = widget.vouchers
            .map((v) => VoucherPrintItem(
                  code: v.username,
                  limitText: voucherLimitTextOrNull(context, v),
                  validityText: voucherValidityText(context, v.validitySeconds),
                  priceText: v.price != null
                      ? localizedCurrency(context, v.price!)
                      : null,
                  batchLabel: _batchLabel(v.createdAt),
                ))
            .toList();
        return _printService.generateVouchersPdf(
          items,
          widget.routerName,
          columns: columns,
          docTitle: context.tr('vouchers.pdfDocTitle'),
          settings: settings,
          howToDefault: howTo,
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final settingsState = ref.watch(printSettingsProvider);
    final settings = settingsState.settings ?? const PrintSettings();

    _maybeInitColumns(settings);

    final isStrips = settings.templateId == VoucherTemplateId.strips;
    final totalPages = voucherPdfPageCountFor(
        widget.vouchers.length, _previewColumns, settings);
    final previewTruncated = totalPages > _kMaxPreviewPages;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: Text(context.tr('vouchers.printVouchers'))),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (isStrips)
            _StripsLabel(stripsPerPage: settings.knobs.stripsPerPage)
          else
            ColumnSliderBar(
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
              key: ValueKey('vouchers_${_previewColumns}_${settings.cacheKey}'),
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

/// One-line label shown instead of the column slider for Strips template.
class _StripsLabel extends StatelessWidget {
  final int stripsPerPage;
  const _StripsLabel({required this.stripsPerPage});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg, vertical: AppSpacing.md),
      child: Text(
        context.tr('vouchers.stripsPerPage', [stripsPerPage.toString()]),
        style: AppTypography.footnote.copyWith(color: AppColors.textSecondary),
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
