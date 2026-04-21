import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../i18n/app_localizations.dart';
import '../../providers/routers_provider.dart';
import '../../services/router_service.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class SetupGuideScreen extends ConsumerStatefulWidget {
  final String routerId;
  final int? initialStep;

  const SetupGuideScreen({
    super.key,
    required this.routerId,
    this.initialStep,
  });

  @override
  ConsumerState<SetupGuideScreen> createState() => _SetupGuideScreenState();
}

class _SetupGuideScreenState extends ConsumerState<SetupGuideScreen> {
  final ScrollController _scrollController = ScrollController();
  final Map<int, GlobalKey> _stepKeys = {};

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    Future.microtask(
        () => ref.read(routersProvider.notifier).loadSetupGuide(widget.routerId));
  }

  void _scrollToInitialStep() {
    final step = widget.initialStep;
    if (step == null) return;
    final key = _stepKeys[step];
    if (key == null) return;
    final ctx = key.currentContext;
    if (ctx == null) return;
    Scrollable.ensureVisible(
      ctx,
      duration: const Duration(milliseconds: 400),
      curve: Curves.easeInOut,
      alignment: 0.0,
    );
  }

  GlobalKey _keyForStep(int step) {
    return _stepKeys.putIfAbsent(step, () => GlobalKey());
  }

  void _copyToClipboard(String text) {
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(context.tr('routers.guideCopied'))),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(routersProvider);
    final guide = state.setupGuide;

    return Scaffold(
      appBar: AppBar(
        title: Text(context.tr('routers.setupGuide')),
        actions: [
          if (guide != null)
            IconButton(
              icon: const Icon(Icons.copy),
              onPressed: () => _copyToClipboard(guide.setupGuide),
              tooltip: context.tr('routers.copyTooltip'),
            ),
        ],
      ),
      body: state.isLoading && guide == null
          ? const Center(child: CircularProgressIndicator())
          : state.error != null && guide == null
              ? _buildError(state.error!)
              : guide == null
                  ? Center(
                      child: Text(context.tr('routers.setupNotAvailable'),
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
                child: Text(context.tr('common.retry')),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGuide(RouterSetupGuide guide) {
    // Scroll to the target step after the list is laid out.
    if (widget.initialStep != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToInitialStep());
    }
    return ListView(
      controller: _scrollController,
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        Text(guide.routerName, style: AppTypography.title2),
        const SizedBox(height: AppSpacing.sm),
        Text(
          context.tr('routers.setupInstructions'),
          style: AppTypography.subhead.copyWith(color: AppColors.textSecondary),
        ),
        const SizedBox(height: AppSpacing.lg),
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
        if (guide.steps.isNotEmpty)
          ...guide.steps.map((step) => _buildStepCard(step, key: _keyForStep(step.step)))
        else
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
        SizedBox(
          height: 48,
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: () => _copyToClipboard(guide.setupGuide),
            icon: const Icon(Icons.copy),
            label: Text(context.tr('routers.copyAllClipboard')),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
      ],
    );
  }

  Widget _buildStepCard(SetupStep step, {Key? key}) {
    final isVerification = step.step >= 9;
    return Padding(
      key: key,
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(
            color: isVerification
                ? AppColors.success.withValues(alpha: 0.4)
                : AppColors.border,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.md, AppSpacing.md, 0),
              child: Row(
                children: [
                  Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isVerification
                          ? AppColors.success
                          : AppColors.primary,
                    ),
                    alignment: Alignment.center,
                    child: isVerification
                        ? const Icon(Icons.check, size: 16, color: Colors.white)
                        : Text(
                            '${step.step}',
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: Colors.white,
                            ),
                          ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      step.title,
                      style: AppTypography.headline.copyWith(fontSize: 15),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.xs, AppSpacing.lg, AppSpacing.sm),
              child: Text(
                step.description,
                style: AppTypography.caption1
                    .copyWith(color: AppColors.textSecondary),
              ),
            ),
            Container(
              margin: const EdgeInsets.fromLTRB(
                  AppSpacing.sm, 0, AppSpacing.sm, AppSpacing.sm),
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: const Color(0xFF1E1E1E),
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: SelectableText(
                      step.command,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 12,
                        height: 1.5,
                        color: Color(0xFFD4D4D4),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.xs),
                  InkWell(
                    onTap: () {
                      Clipboard.setData(ClipboardData(text: step.command));
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(context.tr('routers.stepCopied', [step.step.toString()])),
                          duration: const Duration(seconds: 1),
                        ),
                      );
                    },
                    child: const Icon(
                      Icons.copy,
                      size: 18,
                      color: Color(0xFF9E9E9E),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
