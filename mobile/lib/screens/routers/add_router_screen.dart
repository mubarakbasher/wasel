import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../i18n/app_localizations.dart';
import '../../models/router_health.dart';
import '../../providers/routers_provider.dart';
import '../../services/api_client.dart';
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
              _CopyAllButton(
                onPressed: () => _copyAllCommands(),
              ),
              const SizedBox(height: AppSpacing.md),
              if (_steps != null && _steps!.isNotEmpty)
                ..._steps!.map((step) => _buildStepCard(step))
              else
                _buildNoStepsFallback(state),
              const SizedBox(height: AppSpacing.xxl),
              _VerifyConnectionPanel(routerId: _generatedRouterId!),
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
    final commands = (_steps ?? []).map((s) => s.command).join('\n\n');
    if (commands.isEmpty) return;
    Clipboard.setData(ClipboardData(text: commands));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(context.tr('routers.copyAllSnackbar'))),
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

  // Step 13 is the last firewall rule — the script is now self-contained; no
  // special "final step" semantics, but we give step 13 a green tint to signal
  // the operator that pasting is complete after this command.
  Widget _buildStepCard(SetupStep step) {
    final isFinal = step.step == 13;
    // Step 5 creates the wasel_auto API user — give it a subtle tint.
    final isApiUser = step.step == 5;

    final borderColor = isFinal
        ? AppColors.success.withValues(alpha: 0.5)
        : isApiUser
            ? AppColors.primary.withValues(alpha: 0.3)
            : AppColors.border;
    final badgeColor = isFinal ? AppColors.success : AppColors.primary;

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
        label: Text(context.tr('routers.copyAllCommands')),
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
// Verify connection panel — single on-demand health check, no polling
// ---------------------------------------------------------------------------

enum _VerifyState { idle, loading, online, tunnelOnly, noHandshake, error }

class _VerifyConnectionPanel extends StatefulWidget {
  final String routerId;

  const _VerifyConnectionPanel({required this.routerId});

  @override
  State<_VerifyConnectionPanel> createState() => _VerifyConnectionPanelState();
}

class _VerifyConnectionPanelState extends State<_VerifyConnectionPanel> {
  _VerifyState _verifyState = _VerifyState.idle;
  String? _errorMessage;

  Future<void> _verify() async {
    setState(() {
      _verifyState = _VerifyState.loading;
      _errorMessage = null;
    });

    try {
      final response = await ApiClient().get<Map<String, dynamic>>(
        '/routers/${widget.routerId}/health',
        queryParameters: {'refresh': 'true'},
      );
      final payload = response.data?['data'];
      if (payload is! Map<String, dynamic>) {
        throw Exception('Malformed health response');
      }
      final report = RouterHealthReport.fromJson(payload);

      if (!mounted) return;
      setState(() {
        if (report.isFullyOnline) {
          _verifyState = _VerifyState.online;
        } else if (report.isTunnelOnlyUp) {
          _verifyState = _VerifyState.tunnelOnly;
        } else {
          _verifyState = _VerifyState.noHandshake;
        }
      });
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() {
        _verifyState = _VerifyState.error;
        _errorMessage = _extractDioError(e);
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _verifyState = _VerifyState.error;
        _errorMessage = e.toString();
      });
    }
  }

  String _extractDioError(DioException e) {
    final data = e.response?.data;
    if (data is Map<String, dynamic>) {
      final error = data['error'];
      if (error is Map<String, dynamic> && error.containsKey('message')) {
        return error['message'] as String;
      }
      if (data.containsKey('message')) return data['message'] as String;
    }
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout) {
      return 'Connection timed out.';
    }
    if (e.type == DioExceptionType.connectionError) {
      return 'No internet connection.';
    }
    return e.message ?? e.toString();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _VerifyHeader(verifyState: _verifyState),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _VerifyStatusMessage(
                  verifyState: _verifyState,
                  errorMessage: _errorMessage,
                ),
                const SizedBox(height: AppSpacing.lg),
                _VerifyButton(
                  verifyState: _verifyState,
                  onVerify: _verify,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Verify panel sub-widgets
// ---------------------------------------------------------------------------

class _VerifyHeader extends StatelessWidget {
  final _VerifyState verifyState;

  const _VerifyHeader({required this.verifyState});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Row(
        children: [
          Expanded(
            child: Text(
              context.tr('routers.verifyConnection'),
              style: AppTypography.title3,
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          _VerifyChip(verifyState: verifyState),
        ],
      ),
    );
  }
}

class _VerifyChip extends StatelessWidget {
  final _VerifyState verifyState;

  const _VerifyChip({required this.verifyState});

  @override
  Widget build(BuildContext context) {
    final (label, color) = _chipData(context);
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: AppSpacing.xs),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppSpacing.radiusFull),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text(
        label,
        style: AppTypography.caption1
            .copyWith(color: color, fontWeight: FontWeight.w600),
      ),
    );
  }

  (String, Color) _chipData(BuildContext context) {
    switch (verifyState) {
      case _VerifyState.idle:
        return (context.tr('routers.verifyChipIdle'), AppColors.textTertiary);
      case _VerifyState.loading:
        return (context.tr('routers.verifyChipChecking'), AppColors.primary);
      case _VerifyState.online:
        return (context.tr('routers.verifyChipOnline'), AppColors.success);
      case _VerifyState.tunnelOnly:
        return (context.tr('routers.verifyChipTunnelOnly'), AppColors.warning);
      case _VerifyState.noHandshake:
        return (context.tr('routers.verifyChipNoHandshake'), AppColors.error);
      case _VerifyState.error:
        return (context.tr('routers.verifyChipError'), AppColors.error);
    }
  }
}

class _VerifyStatusMessage extends StatelessWidget {
  final _VerifyState verifyState;
  final String? errorMessage;

  const _VerifyStatusMessage({
    required this.verifyState,
    this.errorMessage,
  });

  @override
  Widget build(BuildContext context) {
    switch (verifyState) {
      case _VerifyState.idle:
        return Text(
          context.tr('routers.verifyIdleHint'),
          style: AppTypography.subhead.copyWith(color: AppColors.textSecondary),
        );
      case _VerifyState.loading:
        return const Center(child: CircularProgressIndicator());
      case _VerifyState.online:
        return Text(
          context.tr('routers.verifyOnlineMessage'),
          style: AppTypography.subhead.copyWith(color: AppColors.success),
        );
      case _VerifyState.tunnelOnly:
        return Text(
          context.tr('routers.verifyTunnelOnlyMessage'),
          style: AppTypography.subhead.copyWith(color: AppColors.warning),
        );
      case _VerifyState.noHandshake:
        return Text(
          context.tr('routers.verifyNoHandshakeMessage'),
          style: AppTypography.subhead.copyWith(color: AppColors.error),
        );
      case _VerifyState.error:
        return Text(
          errorMessage ?? context.tr('routers.verifyErrorMessage'),
          style: AppTypography.subhead.copyWith(color: AppColors.error),
        );
    }
  }
}

class _VerifyButton extends StatelessWidget {
  final _VerifyState verifyState;
  final VoidCallback onVerify;

  const _VerifyButton({required this.verifyState, required this.onVerify});

  @override
  Widget build(BuildContext context) {
    final isLoading = verifyState == _VerifyState.loading;
    final label = (verifyState == _VerifyState.tunnelOnly ||
            verifyState == _VerifyState.noHandshake ||
            verifyState == _VerifyState.error)
        ? context.tr('routers.verifyRetry')
        : context.tr('routers.verifyButton');

    return SizedBox(
      height: 44,
      width: double.infinity,
      child: OutlinedButton(
        onPressed: isLoading ? null : onVerify,
        child: isLoading
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Text(label),
      ),
    );
  }
}
