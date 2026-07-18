import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../../i18n/app_localizations.dart';
import '../../services/clipboard_service.dart';
import '../../theme/theme.dart';
import '../../widgets/widgets.dart';

class ReportExportScreen extends StatelessWidget {
  final String reportType;
  final String exportData;

  const ReportExportScreen({
    super.key,
    required this.reportType,
    required this.exportData,
  });

  void _copyToClipboard(BuildContext context) {
    // Auto-clear the clipboard after the default window so a report's revenue /
    // voucher data doesn't linger in the system clipboard indefinitely.
    ClipboardService.instance.copyWithAutoClear(exportData);
    AppSnackbar.success(context, context.tr('reports.copiedToClipboard'));
  }

  void _share() {
    Share.share(exportData);
  }

  @override
  Widget build(BuildContext context) {
    final lineCount = '\n'.allMatches(exportData).length + 1;

    return Scaffold(
      appBar: AppBar(
        title: Text(context.tr('reports.exportTitle', [reportType])),
        actions: [
          IconButton(
            icon: const Icon(Icons.copy),
            tooltip: context.tr('reports.copyToClipboard'),
            onPressed: () => _copyToClipboard(context),
          ),
          IconButton(
            icon: const Icon(Icons.share),
            tooltip: context.tr('reports.share'),
            onPressed: _share,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Info bar
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.md,
            ),
            color: AppColors.primaryLight,
            child: Row(
              children: [
                const Icon(Icons.description_outlined,
                    size: 18, color: AppColors.primary),
                const SizedBox(width: AppSpacing.sm),
                Text(
                  context.tr('reports.csvDataLines', [lineCount.toString()]),
                  style: AppTypography.footnote.copyWith(
                    color: AppColors.primary,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),

          // CSV content
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              scrollDirection: Axis.vertical,
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: SelectableText(
                  exportData,
                  style: AppTypography.monoSmall.copyWith(
                    height: 1.6,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _copyToClipboard(context),
                  icon: const Icon(Icons.copy, size: 18),
                  label: Text(context.tr('reports.copy')),
                  style: OutlinedButton.styleFrom(
                    minimumSize:
                        const Size(0, AppSpacing.touchTargetMin),
                    side: const BorderSide(color: AppColors.border),
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _share,
                  icon: const Icon(Icons.share, size: 18),
                  label: Text(context.tr('reports.share')),
                  style: FilledButton.styleFrom(
                    minimumSize:
                        const Size(0, AppSpacing.touchTargetMin),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
