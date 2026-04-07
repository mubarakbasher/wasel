import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:pdf/pdf.dart';
import 'package:printing/printing.dart';

import '../../models/voucher.dart';
import '../../services/print_service.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

enum _PrintLayout { thermal, a4, arabicGrid, tableGrid, decoratedCard }

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
  _PrintLayout _selectedLayout = _PrintLayout.arabicGrid;
  int _columnCount = 5;
  final PrintService _printService = PrintService();

  bool get _showColumnSelector =>
      _selectedLayout == _PrintLayout.arabicGrid ||
      _selectedLayout == _PrintLayout.tableGrid ||
      _selectedLayout == _PrintLayout.decoratedCard;

  Future<Uint8List> _generatePdf(PdfPageFormat format) async {
    switch (_selectedLayout) {
      case _PrintLayout.thermal:
        return _printService.generateThermalPdf(widget.vouchers);
      case _PrintLayout.a4:
        return _printService.generateA4Pdf(widget.vouchers);
      case _PrintLayout.arabicGrid:
        return _printService.generateArabicGridPdf(
          widget.vouchers,
          widget.routerName,
          columns: _columnCount,
        );
      case _PrintLayout.tableGrid:
        return _printService.generateTableGridPdf(
          widget.vouchers,
          widget.routerName,
          columns: _columnCount,
        );
      case _PrintLayout.decoratedCard:
        return _printService.generateDecoratedCardPdf(
          widget.vouchers,
          widget.routerName,
          columns: _columnCount,
        );
    }
  }

  String _layoutLabel(_PrintLayout layout) {
    switch (layout) {
      case _PrintLayout.thermal:
        return 'Thermal';
      case _PrintLayout.a4:
        return 'A4 Page';
      case _PrintLayout.arabicGrid:
        return 'Arabic Grid';
      case _PrintLayout.tableGrid:
        return 'Table Grid';
      case _PrintLayout.decoratedCard:
        return 'Decorated';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Print Vouchers'),
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Layout selector and info
          Container(
            color: AppColors.surface,
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.md,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Layout choice chips (horizontally scrollable)
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: _PrintLayout.values.map((layout) {
                      final isSelected = _selectedLayout == layout;
                      return Padding(
                        padding: const EdgeInsets.only(right: AppSpacing.sm),
                        child: ChoiceChip(
                          label: Text(_layoutLabel(layout)),
                          selected: isSelected,
                          onSelected: (selected) {
                            if (selected) {
                              setState(() {
                                _selectedLayout = layout;
                              });
                            }
                          },
                          selectedColor: AppColors.primaryLight,
                          labelStyle: TextStyle(
                            color: isSelected
                                ? AppColors.primary
                                : AppColors.textSecondary,
                            fontWeight: isSelected
                                ? FontWeight.w600
                                : FontWeight.normal,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius:
                                BorderRadius.circular(AppSpacing.radiusMd),
                            side: BorderSide(
                              color: isSelected
                                  ? AppColors.primary
                                  : AppColors.border,
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ),

                // Column count selector (only for configurable grid layouts)
                if (_showColumnSelector) ...[
                  const SizedBox(height: AppSpacing.sm),
                  Row(
                    children: [
                      Text(
                        'Columns: $_columnCount',
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
                            max: 10,
                            divisions: 8,
                            activeColor: AppColors.primary,
                            onChanged: (value) {
                              setState(() {
                                _columnCount = value.round();
                              });
                            },
                          ),
                        ),
                      ),
                    ],
                  ),
                ],

                const SizedBox(height: AppSpacing.xs),
                // Voucher count info
                Text(
                  '${widget.vouchers.length} voucher${widget.vouchers.length == 1 ? '' : 's'} ready to print',
                  style: AppTypography.footnote.copyWith(
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: AppColors.border),
          // PDF preview
          Expanded(
            child: PdfPreview(
              key: ValueKey('${_selectedLayout}_$_columnCount'),
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
