import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:pdf/pdf.dart';
import 'package:printing/printing.dart';

import '../../models/voucher.dart';
import '../../services/print_service.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

enum _PrintLayout { thermal, a4 }

class VoucherPrintScreen extends StatefulWidget {
  final List<Voucher> vouchers;

  const VoucherPrintScreen({super.key, required this.vouchers});

  @override
  State<VoucherPrintScreen> createState() => _VoucherPrintScreenState();
}

class _VoucherPrintScreenState extends State<VoucherPrintScreen> {
  _PrintLayout _selectedLayout = _PrintLayout.thermal;
  final PrintService _printService = PrintService();

  Future<Uint8List> _generatePdf(PdfPageFormat format) async {
    if (_selectedLayout == _PrintLayout.thermal) {
      return _printService.generateThermalPdf(widget.vouchers);
    } else {
      return _printService.generateA4Pdf(widget.vouchers);
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
                // Layout choice chips
                Row(
                  children: [
                    ChoiceChip(
                      label: const Text('Thermal Receipt'),
                      selected: _selectedLayout == _PrintLayout.thermal,
                      onSelected: (selected) {
                        if (selected) {
                          setState(() {
                            _selectedLayout = _PrintLayout.thermal;
                          });
                        }
                      },
                      selectedColor: AppColors.primaryLight,
                      labelStyle: TextStyle(
                        color: _selectedLayout == _PrintLayout.thermal
                            ? AppColors.primary
                            : AppColors.textSecondary,
                        fontWeight: _selectedLayout == _PrintLayout.thermal
                            ? FontWeight.w600
                            : FontWeight.normal,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(AppSpacing.radiusMd),
                        side: BorderSide(
                          color: _selectedLayout == _PrintLayout.thermal
                              ? AppColors.primary
                              : AppColors.border,
                        ),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    ChoiceChip(
                      label: const Text('A4 Page'),
                      selected: _selectedLayout == _PrintLayout.a4,
                      onSelected: (selected) {
                        if (selected) {
                          setState(() {
                            _selectedLayout = _PrintLayout.a4;
                          });
                        }
                      },
                      selectedColor: AppColors.primaryLight,
                      labelStyle: TextStyle(
                        color: _selectedLayout == _PrintLayout.a4
                            ? AppColors.primary
                            : AppColors.textSecondary,
                        fontWeight: _selectedLayout == _PrintLayout.a4
                            ? FontWeight.w600
                            : FontWeight.normal,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(AppSpacing.radiusMd),
                        side: BorderSide(
                          color: _selectedLayout == _PrintLayout.a4
                              ? AppColors.primary
                              : AppColors.border,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
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
              key: ValueKey(_selectedLayout),
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
