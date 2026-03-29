import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/routers_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class SetupGuideScreen extends ConsumerStatefulWidget {
  final String routerId;

  const SetupGuideScreen({super.key, required this.routerId});

  @override
  ConsumerState<SetupGuideScreen> createState() => _SetupGuideScreenState();
}

class _SetupGuideScreenState extends ConsumerState<SetupGuideScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(
        () => ref.read(routersProvider.notifier).loadSetupGuide(widget.routerId));
  }

  void _copyToClipboard(String text) {
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Setup guide copied to clipboard')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(routersProvider);
    final guide = state.setupGuide;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Setup Guide'),
        actions: [
          if (guide != null)
            IconButton(
              icon: const Icon(Icons.copy),
              onPressed: () => _copyToClipboard(guide.setupGuide),
              tooltip: 'Copy to clipboard',
            ),
        ],
      ),
      body: state.isLoading && guide == null
          ? const Center(child: CircularProgressIndicator())
          : state.error != null && guide == null
              ? _buildError(state.error!)
              : guide == null
                  ? Center(
                      child: Text('Setup guide not available',
                          style: AppTypography.body
                              .copyWith(color: AppColors.textSecondary)),
                    )
                  : _buildGuide(guide),
    );
  }

  Widget _buildError(String error) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 64, color: AppColors.error),
            const SizedBox(height: AppSpacing.lg),
            Text(error, style: AppTypography.body, textAlign: TextAlign.center),
            const SizedBox(height: AppSpacing.xxl),
            SizedBox(
              height: 48,
              child: ElevatedButton(
                onPressed: () => ref
                    .read(routersProvider.notifier)
                    .loadSetupGuide(widget.routerId),
                child: const Text('Retry'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGuide(dynamic guide) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        // Header
        Text(guide.routerName, style: AppTypography.title2),
        const SizedBox(height: AppSpacing.sm),
        Text(
          'Follow these steps to connect your Mikrotik router to Wasel.',
          style: AppTypography.subhead.copyWith(color: AppColors.textSecondary),
        ),
        const SizedBox(height: AppSpacing.lg),

        // Info chips
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            if (guide.tunnelIp != null)
              Chip(
                avatar:
                    Icon(Icons.lan, size: 16, color: AppColors.textSecondary),
                label: Text(guide.tunnelIp!, style: AppTypography.caption1),
                backgroundColor: AppColors.background,
                side: BorderSide(color: AppColors.border),
              ),
            Chip(
              avatar: Icon(Icons.dns, size: 16, color: AppColors.textSecondary),
              label:
                  Text(guide.serverEndpoint, style: AppTypography.caption1),
              backgroundColor: AppColors.background,
              side: BorderSide(color: AppColors.border),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.xxl),

        // Setup guide text
        Container(
          padding: const EdgeInsets.all(AppSpacing.lg),
          decoration: BoxDecoration(
            color: AppColors.background,
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            border: Border.all(color: AppColors.border),
          ),
          child: SelectableText(
            guide.setupGuide,
            style: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 13,
              height: 1.5,
              color: AppColors.textPrimary,
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.xxl),

        // Copy button
        SizedBox(
          height: 48,
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: () => _copyToClipboard(guide.setupGuide),
            icon: const Icon(Icons.copy),
            label: const Text('Copy Setup Guide to Clipboard'),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
      ],
    );
  }
}
