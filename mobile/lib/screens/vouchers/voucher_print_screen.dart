import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:pdf/pdf.dart';
import 'package:printing/printing.dart';

import '../../i18n/app_localizations.dart';
import '../../models/voucher.dart';
import '../../services/print_service.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class VoucherPrintScreen extends StatefulWidget {
  final List<Voucher> vouchers;
  final String routerName;

  const VoucherPrintScreen({
    super.key,
    required this.vouchers,
    required this.routerName,
  });

  @override
  State<VoucherPrintScreen> createState() => _VoucherPrintScreenState();
}

class _VoucherPrintScreenState extends State<VoucherPrintScreen> {
  int _columnCount = 4;
  final PrintService _printService = PrintService();

  Future<Uint8List> _generatePdf(PdfPageFormat format) {
    return _printService.generateVouchersPdf(
      widget.vouchers,
      widget.routerName,
      columns: _columnCount,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: Text(context.tr('vouchers.printVouchers'))),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            color: AppColors.surface,
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.md,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Column slider
                Row(
                  children: [
                    Text(
                      context.tr('vouchers.columns', [_columnCount.toString()]),
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
                          value: _columnCount.toDouble(),
                          min: 2,
                          max: 6,
                          divisions: 4,
                          activeColor: AppColors.primary,
                          onChanged: (value) {
                            setState(() => _columnCount = value.round());
                          },
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  context.tr('vouchers.readyToPrint', [widget.vouchers.length.toString()]),
                  style: AppTypography.footnote.copyWith(
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: AppColors.border),
          Expanded(
            child: PdfPreview(
              key: ValueKey('vouchers_$_columnCount'),
              build: _generatePdf,
              canChangePageFormat: false,
              canChangeOrientation: false,
              canDebug: false,
              pdfFileName:
                  'wasel_vouchers_${DateTime.now().millisecondsSinceEpoch}.pdf',
            ),
          ),
        ],
      ),
    );
  }
}
