import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../i18n/app_localizations.dart';
import '../../models/router_health.dart';
import '../../providers/provision_poll_provider.dart';
import '../../providers/routers_provider.dart';
import '../../services/router_service.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class AddRouterScreen extends ConsumerStatefulWidget {
  const AddRouterScreen({super.key});

  @override
  ConsumerState<AddRouterScreen> createState() => _AddRouterScreenState();
}

class _AddRouterScreenState extends ConsumerState<AddRouterScreen> {
  List<String> _stepLabels(BuildContext context) => [
        context.tr('routers.stepInfo'),
        context.tr('routers.stepDetails'),
        context.tr('routers.setupGuide'),
      ];

  final _pageController = PageController();
  final _step1FormKey = GlobalKey<FormState>();
  final _step2FormKey = GlobalKey<FormState>();

  final _nameController = TextEditingController();
  final _modelController = TextEditingController();
  final _rosVersionController = TextEditingController();
  final _apiUserController = TextEditingController();
  final _apiPassController = TextEditingController();

  int _currentStep = 0;
  bool _obscurePassword = true;
  bool _isSubmitting = false;
  String? _createdRouterId;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(routersProvider.notifier).clearError());
  }

  @override
  void dispose() {
    _pageController.dispose();
    _nameController.dispose();
    _modelController.dispose();
    _rosVersionController.dispose();
    _apiUserController.dispose();
    _apiPassController.dispose();
    super.dispose();
  }

  void _goNext() {
    if (!_step1FormKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    _pageController.animateToPage(1,
        duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
    setState(() => _currentStep = 1);
  }

  void _goBack() {
    FocusScope.of(context).unfocus();
    _pageController.animateToPage(_currentStep - 1,
        duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
    setState(() => _currentStep--);
  }

  Future<void> _submitAndLoadGuide() async {
    if (!_step2FormKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() => _isSubmitting = true);
    ref.read(routersProvider.notifier).clearError();

    final success = await ref.read(routersProvider.notifier).createRouter(
          name: _nameController.text.trim(),
          model: _modelController.text.trim().isEmpty
              ? null
              : _modelController.text.trim(),
          rosVersion: _rosVersionController.text.trim().isEmpty
              ? null
              : _rosVersionController.text.trim(),
          apiUser: _apiUserController.text.trim().isEmpty
              ? null
              : _apiUserController.text.trim(),
          apiPass:
              _apiPassController.text.isEmpty ? null : _apiPassController.text,
        );

    if (!mounted) return;

    if (success) {
      final router = ref.read(routersProvider).selectedRouter;
      if (router != null) {
        _createdRouterId = router.id;
        await ref.read(routersProvider.notifier).loadSetupGuide(router.id);
      }
      if (mounted) {
        _pageController.animateToPage(2,
            duration: const Duration(milliseconds: 300),
            curve: Curves.easeInOut);
        setState(() {
          _currentStep = 2;
          _isSubmitting = false;
        });
      }
    } else {
      setState(() => _isSubmitting = false);
    }
  }

  void _finish() {
    if (_createdRouterId != null) {
      context.pushReplacement('/routers/detail', extra: _createdRouterId);
    } else {
      context.pop();
    }
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

    return PopScope(
      canPop: _currentStep == 0 || _currentStep == 2,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _currentStep == 1) _goBack();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(context.tr('routers.addRouter')),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () {
              if (_currentStep == 1) {
                _goBack();
              } else {
                context.pop();
              }
            },
          ),
        ),
        body: Column(
          children: [
            _buildProgressIndicator(),
            Expanded(
              child: PageView(
                controller: _pageController,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  _buildStep1RouterInfo(state),
                  _buildStep2RouterDetails(state),
                  _buildStep3SetupGuide(state),
                ],
              ),
            ),
            _buildBottomBar(state),
          ],
        ),
      ),
    );
  }

  Widget _buildProgressIndicator() {
    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.xxl, vertical: AppSpacing.lg),
      child: Row(
        children: List.generate(5, (index) {
          // 0, 2, 4 = circles; 1, 3 = connectors
          if (index.isEven) {
            final stepIndex = index ~/ 2;
            final isCompleted = stepIndex < _currentStep;
            final isActive = stepIndex == _currentStep;
            return _buildStepCircle(
              stepIndex: stepIndex,
              isCompleted: isCompleted,
              isActive: isActive,
            );
          } else {
            final leftStepIndex = index ~/ 2;
            final isCompleted = leftStepIndex < _currentStep;
            return Expanded(
              child: Container(
                height: 2,
                color: isCompleted ? AppColors.success : AppColors.border,
              ),
            );
          }
        }),
      ),
    );
  }

  Widget _buildStepCircle({
    required int stepIndex,
    required bool isCompleted,
    required bool isActive,
  }) {
    Color bgColor;
    Widget child;

    if (isCompleted) {
      bgColor = AppColors.success;
      child = const Icon(Icons.check, size: 16, color: Colors.white);
    } else if (isActive) {
      bgColor = AppColors.primary;
      child = Text(
        '${stepIndex + 1}',
        style: const TextStyle(
            fontSize: 13, fontWeight: FontWeight.w600, color: Colors.white),
      );
    } else {
      bgColor = AppColors.border;
      child = Text(
        '${stepIndex + 1}',
        style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.textSecondary),
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(shape: BoxShape.circle, color: bgColor),
          alignment: Alignment.center,
          child: child,
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          _stepLabels(context)[stepIndex],
          style: AppTypography.caption2.copyWith(
            color: isActive || isCompleted
                ? AppColors.textPrimary
                : AppColors.textTertiary,
            fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
          ),
        ),
      ],
    );
  }

  Widget _buildStep1RouterInfo(RoutersState state) {
    return Form(
      key: _step1FormKey,
      child: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          Text(context.tr('routers.basicInfo'), style: AppTypography.title3),
          const SizedBox(height: AppSpacing.sm),
          Text(
            context.tr('routers.basicInfoSubtitle'),
            style:
                AppTypography.subhead.copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: AppSpacing.xxl),
          if (state.error != null && _currentStep == 0) ...[
            _buildErrorBox(state.error!),
            const SizedBox(height: AppSpacing.lg),
          ],
          TextFormField(
            controller: _nameController,
            decoration: InputDecoration(
              labelText: '${context.tr('routers.routerName')} *',
              prefixIcon: const Icon(Icons.router),
              hintText: context.tr('routers.routerNameHint'),
            ),
            validator: (value) {
              if (value == null || value.trim().isEmpty) {
                return context.tr('routers.routerNameRequired');
              }
              if (value.trim().length < 2) {
                return context.tr('routers.nameMinLength');
              }
              if (value.trim().length > 100) {
                return context.tr('routers.nameMaxLength');
              }
              return null;
            },
            onChanged: (_) => ref.read(routersProvider.notifier).clearError(),
          ),
          const SizedBox(height: AppSpacing.lg),
          TextFormField(
            controller: _modelController,
            decoration: InputDecoration(
              labelText: context.tr('routers.model'),
              prefixIcon: const Icon(Icons.devices),
              hintText: context.tr('routers.modelHint'),
            ),
            validator: (value) {
              if (value != null && value.length > 100) {
                return context.tr('routers.modelMaxLength');
              }
              return null;
            },
          ),
        ],
      ),
    );
  }

  Widget _buildStep2RouterDetails(RoutersState state) {
    return Form(
      key: _step2FormKey,
      child: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          Text(context.tr('routers.technicalDetails'),
              style: AppTypography.title3),
          const SizedBox(height: AppSpacing.sm),
          Text(
            context.tr('routers.technicalDetailsSubtitle'),
            style:
                AppTypography.subhead.copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: AppSpacing.xxl),
          if (state.error != null && _currentStep == 1) ...[
            _buildErrorBox(state.error!),
            const SizedBox(height: AppSpacing.lg),
          ],
          TextFormField(
            controller: _rosVersionController,
            decoration: InputDecoration(
              labelText: context.tr('routers.rosVersion'),
              prefixIcon: const Icon(Icons.system_update),
              hintText: context.tr('routers.rosVersionHint'),
            ),
            validator: (value) {
              if (value != null && value.length > 20) {
                return context.tr('routers.versionMaxLength');
              }
              return null;
            },
          ),
          const SizedBox(height: AppSpacing.lg),
          TextFormField(
            controller: _apiUserController,
            decoration: InputDecoration(
              labelText: context.tr('routers.apiUsername'),
              prefixIcon: const Icon(Icons.person),
              hintText: context.tr('routers.apiUsernameHint'),
            ),
            validator: (value) {
              if (value != null && value.length > 100) {
                return context.tr('routers.usernameMaxLength');
              }
              return null;
            },
          ),
          const SizedBox(height: AppSpacing.lg),
          TextFormField(
            controller: _apiPassController,
            obscureText: _obscurePassword,
            decoration: InputDecoration(
              labelText: context.tr('routers.apiPassword'),
              prefixIcon: const Icon(Icons.lock),
              suffixIcon: IconButton(
                icon: Icon(
                  _obscurePassword ? Icons.visibility_off : Icons.visibility,
                ),
                onPressed: () =>
                    setState(() => _obscurePassword = !_obscurePassword),
              ),
            ),
            validator: (value) {
              if (value != null && value.length > 255) {
                return context.tr('routers.passwordMaxLength');
              }
              return null;
            },
          ),
        ],
      ),
    );
  }

  Widget _buildStep3SetupGuide(RoutersState state) {
    final guide = state.setupGuide;

    if (_isSubmitting || (state.isLoading && guide == null)) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.error != null && guide == null && _currentStep == 2) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xxxl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, size: 64, color: AppColors.error),
              const SizedBox(height: AppSpacing.lg),
              Text(state.error!,
                  style: AppTypography.body, textAlign: TextAlign.center),
              const SizedBox(height: AppSpacing.xxl),
              SizedBox(
                height: 48,
                child: ElevatedButton(
                  onPressed: () {
                    if (_createdRouterId != null) {
                      ref
                          .read(routersProvider.notifier)
                          .loadSetupGuide(_createdRouterId!);
                    }
                  },
                  child: Text(context.tr('common.retry')),
                ),
              ),
            ],
          ),
        ),
      );
    }

    if (guide == null) {
      return Center(
        child: Text(context.tr('routers.setupNotAvailable'),
            style: AppTypography.body
                .copyWith(color: AppColors.textSecondary)),
      );
    }

    return _buildGuideContent(guide);
  }

  Widget _buildGuideContent(RouterSetupGuide guide) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        Text(guide.routerName, style: AppTypography.title2),
        const SizedBox(height: AppSpacing.sm),
        Text(
          context.tr('routers.setupInstructions'),
          style:
              AppTypography.subhead.copyWith(color: AppColors.textSecondary),
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
              avatar:
                  Icon(Icons.dns, size: 16, color: AppColors.textSecondary),
              label:
                  Text(guide.serverEndpoint, style: AppTypography.caption1),
              backgroundColor: AppColors.background,
              side: BorderSide(color: AppColors.border),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.xxl),
        if (guide.steps.isNotEmpty)
          ...guide.steps.map((step) => _buildStepCard(step))
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
        // Auto-provisioning panel — only shown once the router is created.
        if (_createdRouterId != null) ...[
          const SizedBox(height: AppSpacing.xxl),
          _AutoConfigPanel(routerId: _createdRouterId!),
        ],
        const SizedBox(height: AppSpacing.lg),
      ],
    );
  }

  // Backend now returns 6 steps: 4 WG bootstrap + 2 verification.
  // Verification steps are step numbers 5 and 6.
  Widget _buildStepCard(SetupStep step) {
    final isVerification = step.step >= 5;
    return Padding(
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
                          content: Text(context.tr(
                              'routers.stepCopied', [step.step.toString()])),
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

  Widget _buildBottomBar(RoutersState state) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Row(
          children: [
            if (_currentStep == 1) ...[
              Expanded(
                child: SizedBox(
                  height: 48,
                  child: OutlinedButton(
                    onPressed: _isSubmitting ? null : _goBack,
                    child: Text(context.tr('common.back')),
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.lg),
            ],
            if (_currentStep == 0)
              Expanded(
                child: SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _goNext,
                    child: Text(context.tr('common.next')),
                  ),
                ),
              ),
            if (_currentStep == 1)
              Expanded(
                child: SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _isSubmitting ? null : _submitAndLoadGuide,
                    child: _isSubmitting
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(context.tr('routers.createRouter')),
                  ),
                ),
              ),
            if (_currentStep == 2)
              Expanded(
                child: SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _finish,
                    child: Text(context.tr('common.done')),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorBox(String error) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.error.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
      ),
      child: Text(
        error,
        style: AppTypography.subhead.copyWith(color: AppColors.error),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Auto-configuring panel — polls health and renders per-probe provisioning rows
// ---------------------------------------------------------------------------

/// Maps probe IDs to display labels in provisioning order.
const _kProbeLabels = <String, String>{
  'wgHandshakeRecent': 'WireGuard handshake',
  'routerOsApiReachable': 'RouterOS API reachable',
  'radiusClientConfigured': 'RADIUS client configured',
  'hotspotUsesRadius': 'Hotspot profile uses RADIUS',
  'firewallAllowsRadius': 'Firewall rules',
  'hotspotServerBound': 'Hotspot server bound',
  'synthRadiusAuth': 'Voucher auth works',
};

const _kProbeOrder = [
  'wgHandshakeRecent',
  'routerOsApiReachable',
  'radiusClientConfigured',
  'hotspotUsesRadius',
  'firewallAllowsRadius',
  'hotspotServerBound',
  'synthRadiusAuth',
];

class _AutoConfigPanel extends ConsumerWidget {
  final String routerId;

  const _AutoConfigPanel({required this.routerId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pollState = ref.watch(provisionPollProvider(routerId));

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _PanelHeader(pollState: pollState, routerId: routerId),
          const Divider(height: 1),
          if (pollState.report?.needsHotspotConfirmation == true)
            _HotspotConfirmCard(routerId: routerId, pollState: pollState),
          _ProbeChecklist(report: pollState.report),
          if (pollState.report?.provisionError?.isNotEmpty == true)
            _ProvisionErrorExpander(
                errors: pollState.report!.provisionError!),
          if (pollState.isTimedOut)
            _TimeoutBanner(routerId: routerId),
          if (pollState.error != null && !pollState.isTimedOut)
            _ErrorBanner(message: pollState.error!),
          const SizedBox(height: AppSpacing.sm),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Panel header — title + overall status chip
// ---------------------------------------------------------------------------

class _PanelHeader extends StatelessWidget {
  final ProvisionPollState pollState;
  final String routerId;

  const _PanelHeader({required this.pollState, required this.routerId});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Row(
        children: [
          Expanded(
            child: Text('Auto-configuring router',
                style: AppTypography.title3),
          ),
          const SizedBox(width: AppSpacing.sm),
          _StatusChip(pollState: pollState),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  final ProvisionPollState pollState;

  const _StatusChip({required this.pollState});

  @override
  Widget build(BuildContext context) {
    final (label, color) = _chipData();
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: AppSpacing.xs),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppSpacing.radiusFull),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text(label,
          style: AppTypography.caption1.copyWith(
              color: color, fontWeight: FontWeight.w600)),
    );
  }

  (String, Color) _chipData() {
    if (pollState.isTimedOut) return ('Timed out', AppColors.error);

    final status = pollState.report?.provisionStatus;
    final overall = pollState.report?.overall;

    if (status == null) return ('Waiting for tunnel', AppColors.textTertiary);
    if (status == ProvisionStatus.succeeded &&
        overall == OverallHealth.healthy) {
      return ('Done', AppColors.success);
    }
    if (status == ProvisionStatus.partial) {
      final errorCount =
          pollState.report?.provisionError?.length ?? 0;
      return ('Partial — $errorCount error${errorCount == 1 ? '' : 's'}',
          AppColors.warning);
    }
    if (status == ProvisionStatus.failed) {
      return ('Failed', AppColors.error);
    }
    if (status == ProvisionStatus.inProgress ||
        status == ProvisionStatus.pending) {
      return ('Configuring...', AppColors.primary);
    }
    return ('Configuring...', AppColors.primary);
  }
}

// ---------------------------------------------------------------------------
// Probe checklist
// ---------------------------------------------------------------------------

class _ProbeChecklist extends StatelessWidget {
  final RouterHealthReport? report;

  const _ProbeChecklist({this.report});

  @override
  Widget build(BuildContext context) {
    // Build an index of probe ID → result for O(1) lookup.
    final probeMap = <String, ProbeResult>{};
    if (report != null) {
      for (final p in report!.probes) {
        probeMap[p.id] = p;
      }
    }

    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg, vertical: AppSpacing.md),
      child: Column(
        children: _kProbeOrder.map((probeId) {
          final probe = probeMap[probeId];
          final label =
              _kProbeLabels[probeId] ?? probe?.label ?? probeId;
          return _ProbeCheckRow(
            label: label,
            probe: probe,
          );
        }).toList(),
      ),
    );
  }
}

class _ProbeCheckRow extends StatelessWidget {
  final String label;
  final ProbeResult? probe;

  const _ProbeCheckRow({required this.label, this.probe});

  @override
  Widget build(BuildContext context) {
    final status = probe?.status;

    Widget leading;
    Color labelColor = AppColors.textPrimary;

    if (status == ProbeStatus.pass) {
      leading = const Icon(Icons.check_circle, color: AppColors.success, size: 20);
    } else if (status == ProbeStatus.fail) {
      leading = const Icon(Icons.cancel, color: AppColors.error, size: 20);
      labelColor = AppColors.error;
    } else {
      // null (not yet reached) or skipped.
      if (probe == null) {
        leading = const SizedBox(
          width: 20,
          height: 20,
          child: CircularProgressIndicator(strokeWidth: 2),
        );
        labelColor = AppColors.textSecondary;
      } else {
        leading = Icon(Icons.remove_circle_outline,
            color: AppColors.textTertiary, size: 20);
        labelColor = AppColors.textTertiary;
      }
    }

    if (status == ProbeStatus.fail &&
        (probe!.remediation != null || probe!.setupStep != null)) {
      return _FailRow(label: label, probe: probe!);
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Row(
        children: [
          leading,
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(label,
                style: AppTypography.subhead.copyWith(color: labelColor)),
          ),
        ],
      ),
    );
  }
}

class _FailRow extends StatelessWidget {
  final String label;
  final ProbeResult probe;

  const _FailRow({required this.label, required this.probe});

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      leading: const Icon(Icons.cancel, color: AppColors.error, size: 20),
      title: Text(label,
          style: AppTypography.subhead.copyWith(color: AppColors.error)),
      tilePadding: EdgeInsets.zero,
      childrenPadding: const EdgeInsets.only(
          left: AppSpacing.xxl + AppSpacing.sm, bottom: AppSpacing.sm),
      children: [
        if (probe.remediation != null)
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              probe.remediation!,
              style: AppTypography.caption1
                  .copyWith(color: AppColors.textSecondary),
            ),
          ),
        if (probe.setupStep != null)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => context.push(
                '/routers/setup-guide',
                extra: {
                  'routerId': probe.id,
                  'initialStep': probe.setupStep,
                },
              ),
              icon: const Icon(Icons.open_in_new, size: 16),
              label: Text('Open setup step ${probe.setupStep}'),
              style: TextButton.styleFrom(
                padding: EdgeInsets.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Hotspot interface confirmation card
// ---------------------------------------------------------------------------

class _HotspotConfirmCard extends ConsumerStatefulWidget {
  final String routerId;
  final ProvisionPollState pollState;

  const _HotspotConfirmCard(
      {required this.routerId, required this.pollState});

  @override
  ConsumerState<_HotspotConfirmCard> createState() =>
      _HotspotConfirmCardState();
}

class _HotspotConfirmCardState extends ConsumerState<_HotspotConfirmCard> {
  String? _selectedInterface;

  static const _kAllowedTypes = {'ether', 'bridge', 'wlan', 'vlan'};

  List<RouterInterface> get _filteredInterfaces {
    final report = widget.pollState.report;
    if (report == null) return const [];
    return report.availableInterfaces
        .where((i) => _kAllowedTypes.contains(i.type))
        .toList();
  }

  @override
  void didUpdateWidget(_HotspotConfirmCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Pre-select suggested interface when it first arrives.
    if (_selectedInterface == null) {
      final suggested =
          widget.pollState.report?.suggestedHotspotInterface;
      if (suggested != null) {
        _selectedInterface = suggested;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final interfaces = _filteredInterfaces;
    final isConfirming = widget.pollState.isConfirmingInterface;

    // Ensure selected value is in the list (guard against stale state).
    final effectiveSelection =
        interfaces.any((i) => i.name == _selectedInterface)
            ? _selectedInterface
            : (interfaces.isNotEmpty ? interfaces.first.name : null);

    return Container(
      margin: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 0),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(
            color: AppColors.primary.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.wifi, color: AppColors.primary, size: 18),
              const SizedBox(width: AppSpacing.xs),
              Text('Choose the hotspot interface',
                  style: AppTypography.subhead
                      .copyWith(fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            "Wasel couldn't find an existing hotspot on your router. "
            'Pick the LAN interface where Wi-Fi clients connect.',
            style: AppTypography.caption1
                .copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: AppSpacing.md),
          if (interfaces.isEmpty)
            Text('No interfaces available',
                style: AppTypography.caption1
                    .copyWith(color: AppColors.textTertiary))
          else
            DropdownButtonFormField<String>(
              initialValue: effectiveSelection,
              decoration: const InputDecoration(
                contentPadding: EdgeInsets.symmetric(
                    horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                isDense: true,
              ),
              items: interfaces
                  .map((i) => DropdownMenuItem(
                        value: i.name,
                        child: Text('${i.name} (${i.type})'),
                      ))
                  .toList(),
              onChanged: isConfirming
                  ? null
                  : (v) => setState(() => _selectedInterface = v),
            ),
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            height: 40,
            width: double.infinity,
            child: ElevatedButton(
              onPressed: (isConfirming || effectiveSelection == null)
                  ? null
                  : () => ref
                      .read(provisionPollProvider(widget.routerId).notifier)
                      .confirmInterface(effectiveSelection),
              child: isConfirming
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Confirm'),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Provision step error expander
// ---------------------------------------------------------------------------

class _ProvisionErrorExpander extends StatelessWidget {
  final List<ProvisionStepError> errors;

  const _ProvisionErrorExpander({required this.errors});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: ExpansionTile(
        leading: Icon(Icons.warning_amber_rounded,
            color: AppColors.warning, size: 20),
        title: Text('Show errors (${errors.length})',
            style: AppTypography.caption1
                .copyWith(color: AppColors.warning)),
        tilePadding: EdgeInsets.zero,
        childrenPadding:
            const EdgeInsets.only(bottom: AppSpacing.sm),
        children: errors
            .map((e) => Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.xs),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 6,
                        height: 6,
                        margin: const EdgeInsets.only(top: 5),
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          color: AppColors.error,
                        ),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: Text(
                          '${e.step}: ${e.error}',
                          style: AppTypography.caption1
                              .copyWith(color: AppColors.textSecondary),
                        ),
                      ),
                    ],
                  ),
                ))
            .toList(),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Timeout banner
// ---------------------------------------------------------------------------

class _TimeoutBanner extends ConsumerWidget {
  final String routerId;

  const _TimeoutBanner({required this.routerId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      margin: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 0),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.error.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border:
            Border.all(color: AppColors.error.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.timer_off, color: AppColors.error, size: 18),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              'Auto-configuration timed out after 10 minutes.',
              style: AppTypography.caption1
                  .copyWith(color: AppColors.error),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          TextButton(
            onPressed: () => ref
                .read(provisionPollProvider(routerId).notifier)
                .reprovision(),
            style: TextButton.styleFrom(
              foregroundColor: AppColors.error,
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('Try again'),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Generic error banner (non-fatal poll errors)
// ---------------------------------------------------------------------------

class _ErrorBanner extends StatelessWidget {
  final String message;

  const _ErrorBanner({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 0),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.error.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border:
            Border.all(color: AppColors.error.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.warning_amber_rounded,
              color: AppColors.warning, size: 18),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: AppTypography.caption1
                  .copyWith(color: AppColors.textSecondary),
            ),
          ),
        ],
      ),
    );
  }
}
