import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../i18n/app_localizations.dart';
import '../../providers/routers_provider.dart';
import '../../services/clipboard_service.dart';
import '../../services/router_service.dart';
import '../../services/secure_window.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';
import '../../widgets/widgets.dart';

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
  bool _didScrollToInitialStep = false;

  @override
  void dispose() {
    _scrollController.dispose();
    if (Platform.isAndroid) SecureWindow.disable();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    // The setup script embeds the WireGuard private key, RADIUS secret and
    // router admin password — block screenshots while it's on screen.
    if (Platform.isAndroid) SecureWindow.enable();
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

  String _joinedScript(RouterSetupGuide guide) =>
      guide.steps.isNotEmpty
          ? guide.steps.map((s) => s.command).join('\n')
          : guide.setupGuide;

  void _copyAll(RouterSetupGuide guide) {
    // Longer auto-clear window than the 30s default: the setup script contains
    // secrets the operator pastes into RouterOS, which can take a while.
    ClipboardService.instance.copyWithAutoClear(
      _joinedScript(guide),
      duration: const Duration(minutes: 2),
    );
    AppSnackbar.success(context, context.tr('routers.setupCommandCopied'));
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
              onPressed: () => _copyAll(guide),
              tooltip: context.tr('routers.copyTooltip'),
            ),
        ],
      ),
      body: state.isLoading && guide == null
          ? const Center(child: CircularProgressIndicator())
          : state.error != null && guide == null
              ? ErrorState(
                  message: state.error!,
                  onRetry: () => ref
                      .read(routersProvider.notifier)
                      .loadSetupGuide(widget.routerId),
                  retryLabel: context.tr('common.retry'),
                )
              : guide == null
                  ? Center(
                      child: Text(context.tr('routers.setupNotAvailable'),
                          style: AppTypography.body
                              .copyWith(color: AppColors.textSecondary)),
                    )
                  : _buildGuide(guide),
    );
  }

  Widget _buildGuide(RouterSetupGuide guide) {
    if (widget.initialStep != null && !_didScrollToInitialStep) {
      _didScrollToInitialStep = true;
      WidgetsBinding.instance.addPostFrameCallback(
          (_) => _scrollToInitialStep());
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
                avatar: Icon(Icons.lan,
                    size: 16, color: AppColors.textSecondary),
                label: Text(guide.tunnelIp!, style: AppTypography.caption1),
              ),
            Chip(
              avatar: Icon(Icons.dns,
                  size: 16, color: AppColors.textSecondary),
              label:
                  Text(guide.serverEndpoint, style: AppTypography.caption1),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        if (guide.steps.isNotEmpty) ...[
          Text(
            context.tr('routers.scriptInstructions'),
            style: AppTypography.subhead
                .copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: AppSpacing.lg),
          SetupScriptBlock(steps: guide.steps),
          const SizedBox(height: AppSpacing.lg),
          ExpansionTile(
            title: Text(context.tr('routers.showIndividualSteps')),
            initiallyExpanded: widget.initialStep != null,
            onExpansionChanged: (expanded) {
              if (expanded && widget.initialStep != null) {
                WidgetsBinding.instance
                    .addPostFrameCallback((_) => _scrollToInitialStep());
              }
            },
            children: guide.steps
                .map((step) =>
                    _buildStepCard(step, key: _keyForStep(step.step)))
                .toList(),
          ),
        ] else
          Container(
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: BoxDecoration(
              color: AppColors.surfaceMuted,
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              border: Border.all(color: AppColors.border),
            ),
            child: SelectableText(
              guide.setupGuide,
              style: AppTypography.monoSmall.copyWith(height: 1.5),
            ),
          ),
        const SizedBox(height: AppSpacing.lg),
      ],
    );
  }

  Widget _buildStepCard(SetupStep step, {Key? key}) {
    return Padding(
      key: key,
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: AppCard(
        padding: EdgeInsets.zero,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        shadows: const [],
        color: AppColors.surface,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            border: Border.all(color: AppColors.border),
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
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppColors.primary,
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        '${step.step}',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textInverse,
                        ),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        context.tr('routers.setup.step${step.step}.title'),
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
                  context.tr('routers.setup.step${step.step}.desc'),
                  style: AppTypography.caption1
                      .copyWith(color: AppColors.textSecondary),
                ),
              ),
              Container(
                margin: const EdgeInsets.fromLTRB(
                    AppSpacing.sm, 0, AppSpacing.sm, AppSpacing.sm),
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.surfaceMuted,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: SelectableText(
                        step.command,
                        style: AppTypography.monoSmall.copyWith(height: 1.5),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.xs),
                    InkWell(
                      onTap: () {
                        ClipboardService.instance.copyWithAutoClear(
                            step.command,
                            duration: const Duration(minutes: 2));
                        AppSnackbar.success(
                          context,
                          context.tr('routers.stepCopied',
                              [step.step.toString()]),
                        );
                      },
                      child: Icon(
                        Icons.copy,
                        size: 18,
                        color: AppColors.textTertiary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
