import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import '../../theme/theme.dart';

class ReportExportScreen extends StatelessWidget {
  final String reportType;
  final String exportData;

  const ReportExportScreen({
    super.key,
    required this.reportType,
    required this.exportData,
  });

  void _copyToClipboard(BuildContext context) {
    Clipboard.setData(ClipboardData(text: exportData));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Copied to clipboard'),
        behavior: SnackBarBehavior.floating,
        duration: Duration(seconds: 2),
      ),
    );
  }

  void _share() {
    Share.share(exportData);
  }

  @override
  Widget build(BuildContext context) {
    final lineCount = '\n'.allMatches(exportData).length + 1;

    return Scaffold(
      appBar: AppBar(
        title: Text('Export - $reportType'),
        actions: [
          IconButton(
            icon: const Icon(Icons.copy),
            tooltip: 'Copy to clipboard',
            onPressed: () => _copyToClipboard(context),
          ),
          IconButton(
            icon: const Icon(Icons.share),
            tooltip: 'Share',
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
                  'CSV data  ·  $lineCount lines',
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
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12,
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
                  label: const Text('Copy'),
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
                  label: const Text('Share'),
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
