import 'package:flutter/material.dart';

import '../i18n/app_localizations.dart';
import '../services/clipboard_service.dart';
import '../services/router_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import 'app_snackbar.dart';

/// Renders all setup-script commands joined by `\n` in a single selectable
/// monospace block, with a prominent one-tap copy button beneath it.
///
/// The operator pastes the entire block into the RouterOS terminal in one go —
/// no need to copy each of the 11 individual commands separately.
class SetupScriptBlock extends StatelessWidget {
  final List<SetupStep> steps;

  const SetupScriptBlock({super.key, required this.steps});

  String get _script => steps.map((s) => s.command).join('\n');

  @override
  Widget build(BuildContext context) {
    final script = _script;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ScriptBox(script: script),
        const SizedBox(height: AppSpacing.sm),
        Text(
          context.tr('routers.pasteHint'),
          style: AppTypography.caption1.copyWith(color: AppColors.textSecondary),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: AppSpacing.md),
        _CopyScriptButton(script: script),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Script text box
// ---------------------------------------------------------------------------

class _ScriptBox extends StatelessWidget {
  final String script;
  const _ScriptBox({required this.script});

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxHeight: 260),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.border),
      ),
      child: SingleChildScrollView(
        child: SelectableText(
          script,
          style: AppTypography.monoSmall.copyWith(height: 1.5),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

class _CopyScriptButton extends StatelessWidget {
  final String script;
  const _CopyScriptButton({required this.script});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: () => _copy(context),
        icon: const Icon(Icons.copy),
        label: Text(context.tr('routers.copySetupCommand')),
      ),
    );
  }

  Future<void> _copy(BuildContext context) async {
    await ClipboardService.instance.copyWithAutoClear(
      script,
      duration: const Duration(minutes: 2),
    );
    if (context.mounted) {
      AppSnackbar.success(context, context.tr('routers.setupCommandCopied'));
    }
  }
}
