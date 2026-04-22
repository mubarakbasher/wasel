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
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _scrollController = ScrollController();

  bool _isGenerating = false;
  String? _generatedRouterId;
  String? _generatedVpnIp;
  List<SetupStep>? _steps;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(routersProvider.notifier).clearError());
  }

  @override
  void dispose() {
    _nameController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  bool get _scriptGenerated => _generatedRouterId != null;

  Future<void> _generate() async {
    if (!_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();

    setState(() => _isGenerating = true);
    ref.read(routersProvider.notifier).clearError();

    final success = await ref
        .read(routersProvider.notifier)
        .createRouter(name: _nameController.text.trim());

    if (!mounted) return;

    if (success) {
      final state = ref.read(routersProvider);
      final router = state.selectedRouter;
      final guide = state.setupGuide;

      setState(() {
        _isGenerating = false;
        _generatedRouterId = router?.id;
        _generatedVpnIp = guide?.tunnelIp ?? router?.tunnelIp;
        _steps = guide?.steps;
      });

      // Scroll to reveal generated content after the frame is built.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scrollController.hasClients) {
          _scrollController.animateTo(
            _scrollController.position.maxScrollExtent,
            duration: const Duration(milliseconds: 500),
            curve: Curves.easeOut,
          );
        }
      });
    } else {
      setState(() => _isGenerating = false);
    }
  }

  void _finish() {
    if (_generatedRouterId != null) {
      context.pushReplacement('/routers/detail', extra: _generatedRouterId);
    } else {
      context.pop();
    }
  }

  Future<bool> _confirmLeave() async {
    if (!_scriptGenerated) return true;
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(context.tr('routers.leaveWarningTitle')),
        content: Text(context.tr('routers.leaveWarningBody')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(context.tr('common.cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(foregroundColor: AppColors.error),
            child: Text(context.tr('routers.leaveAnyway')),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(routersProvider);

    return PopScope(
      canPop: !_scriptGenerated,
      onPopInvokedWithResult: (didPop, _) async {
        if (!didPop) {
          final shouldLeave = await _confirmLeave();
          if (shouldLeave && mounted) {
            // ignore: use_build_context_synchronously
            context.pop();
          }
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(context.tr('routers.addRouter')),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () async {
              final shouldLeave = await _confirmLeave();
              if (shouldLeave && mounted) {
                // ignore: use_build_context_synchronously
                context.pop();
              }
            },
          ),
        ),
        body: ListView(
          controller: _scrollController,
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: [
            _NameSection(
              formKey: _formKey,
              nameController: _nameController,
              isGenerating: _isGenerating,
              scriptGenerated: _scriptGenerated,
              error: (!_scriptGenerated) ? state.error : null,
              onGenerate: _generate,
            ),
            if (_scriptGenerated) ...[
              const SizedBox(height: AppSpacing.xxl),
              _VpnBanner(vpnIp: _generatedVpnIp),
              const SizedBox(height: AppSpacing.lg),
              Text(
                context.tr('routers.scriptInstructions'),
                style: AppTypography.subhead
                    .copyWith(color: AppColors.textSecondary),
              ),
              const SizedBox(height: AppSpacing.lg),
              if (_steps != null && _steps!.isNotEmpty)
                ..._steps!.map((step) => _buildStepCard(step))
              else
                _buildNoStepsFallback(state),
              const SizedBox(height: AppSpacing.md),
              _CopyAllButton(
                onPressed: () => _copyAllCommands(),
              ),
              const SizedBox(height: AppSpacing.xxl),
              _AutoConfigPanel(routerId: _generatedRouterId!),
              const SizedBox(height: AppSpacing.lg),
              _DoneButton(onPressed: _finish),
              const SizedBox(height: AppSpacing.lg),
            ],
          ],
        ),
      ),
    );
  }

  void _copyAllCommands() {
    final commands = (_steps ?? []).map((s) => s.command).join('\n');
    if (commands.isEmpty) return;
    Clipboard.setData(ClipboardData(text: commands));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(context.tr('routers.guideCopied'))),
    );
  }

  Widget _buildNoStepsFallback(RoutersState state) {
    final guide = state.setupGuide;
    if (guide == null) return const SizedBox.shrink();
    return Container(
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
    );
  }

  // Step 7 is the final "notify Wasel" step — highlight it green.
  Widget _buildStepCard(SetupStep step) {
    final isFinal = step.step == 7;
    // Step 5 creates the wasel_auto API user — give it a subtle tint.
    final isApiUser = step.step == 5;

    final borderColor = isFinal
        ? AppColors.success.withValues(alpha: 0.5)
        : isApiUser
            ? AppColors.primary.withValues(alpha: 0.3)
            : AppColors.border;
    final badgeColor =
        isFinal ? AppColors.success : AppColors.primary;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(color: borderColor),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _StepCardHeader(
              step: step,
              badgeColor: badgeColor,
              isFinal: isFinal,
            ),
            _StepDescription(step: step),
            _StepCommand(
              step: step,
              onCopy: () {
                Clipboard.setData(ClipboardData(text: step.command));
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(
                        context.tr('routers.stepCopied', [step.step.toString()])),
                    duration: const Duration(seconds: 1),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Name + Generate section
// ---------------------------------------------------------------------------

class _NameSection extends StatelessWidget {
  final GlobalKey<FormState> formKey;
  final TextEditingController nameController;
  final bool isGenerating;
  final bool scriptGenerated;
  final String? error;
  final VoidCallback onGenerate;

  const _NameSection({
    required this.formKey,
    required this.nameController,
    required this.isGenerating,
    required this.scriptGenerated,
    required this.error,
    required this.onGenerate,
  });

  @override
  Widget build(BuildContext context) {
    return Form(
      key: formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: AppSpacing.lg),
          Text(context.tr('routers.addRouter'), style: AppTypography.title3),
          const SizedBox(height: AppSpacing.sm),
          Text(
            context.tr('routers.nameYourRouter'),
            style:
                AppTypography.subhead.copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: AppSpacing.xxl),
          if (error != null) ...[
            _ErrorBox(error: error!),
            const SizedBox(height: AppSpacing.lg),
          ],
          TextFormField(
            controller: nameController,
            enabled: !scriptGenerated,
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
          ),
          const SizedBox(height: AppSpacing.xl),
          if (!scriptGenerated)
            SizedBox(
              height: 48,
              width: double.infinity,
              child: ElevatedButton(
                onPressed: isGenerating ? null : onGenerate,
                child: isGenerating
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(context.tr('routers.generateScript')),
              ),
            ),
        ],
      ),
    );
  }
}

class _ErrorBox extends StatelessWidget {
  final String error;
  const _ErrorBox({required this.error});

  @override
  Widget build(BuildContext context) {
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
// VPN IP banner
// ---------------------------------------------------------------------------

class _VpnBanner extends StatelessWidget {
  final String? vpnIp;
  const _VpnBanner({this.vpnIp});

  @override
  Widget build(BuildContext context) {
    if (vpnIp == null) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg, vertical: AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.success.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.success.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          const Icon(Icons.check_circle, color: AppColors.success, size: 20),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              context.tr('routers.vpnAssigned', [vpnIp!]),
              style: AppTypography.subhead
                  .copyWith(color: AppColors.success, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Step card sub-widgets
// ---------------------------------------------------------------------------

class _StepCardHeader extends StatelessWidget {
  final SetupStep step;
  final Color badgeColor;
  final bool isFinal;

  const _StepCardHeader({
    required this.step,
    required this.badgeColor,
    required this.isFinal,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.md, 0),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
                shape: BoxShape.circle, color: badgeColor),
            alignment: Alignment.center,
            child: isFinal
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
    );
  }
}

class _StepDescription extends StatelessWidget {
  final SetupStep step;
  const _StepDescription({required this.step});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.xs, AppSpacing.lg, AppSpacing.sm),
      child: Text(
        step.description,
        style:
            AppTypography.caption1.copyWith(color: AppColors.textSecondary),
      ),
    );
  }
}

class _StepCommand extends StatelessWidget {
  final SetupStep step;
  final VoidCallback onCopy;

  const _StepCommand({required this.step, required this.onCopy});

  @override
  Widget build(BuildContext context) {
    return Container(
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
            onTap: onCopy,
            child: const Icon(
              Icons.copy,
              size: 18,
              color: Color(0xFF9E9E9E),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Copy All + Done buttons
// ---------------------------------------------------------------------------

class _CopyAllButton extends StatelessWidget {
  final VoidCallback onPressed;
  const _CopyAllButton({required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      width: double.infinity,
      child: OutlinedButton.icon(
        onPressed: onPressed,
        icon: const Icon(Icons.copy),
        label: Text(context.tr('routers.copyAllClipboard')),
      ),
    );
  }
}

class _DoneButton extends StatelessWidget {
  final VoidCallback onPressed;
  const _DoneButton({required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      width: double.infinity,
      child: ElevatedButton(
        onPressed: onPressed,
        child: Text(context.tr('common.done')),
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
