import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../i18n/app_localizations.dart';
import '../../models/print_settings.dart';
import '../../providers/print_settings_provider.dart';
import '../../providers/routers_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';
import '../../widgets/widgets.dart';

class VoucherPrintingScreen extends ConsumerStatefulWidget {
  const VoucherPrintingScreen({super.key});

  @override
  ConsumerState<VoucherPrintingScreen> createState() =>
      _VoucherPrintingScreenState();
}

class _VoucherPrintingScreenState
    extends ConsumerState<VoucherPrintingScreen> {
  final _headerController = TextEditingController();
  final _footerController = TextEditingController();
  final _hotspotController = TextEditingController();

  Timer? _debounce;
  bool _syncingControllers = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      final notifier = ref.read(printSettingsProvider.notifier);
      if (ref.read(printSettingsProvider).isEmpty) {
        notifier.load();
      }
    });
  }

  @override
  void dispose() {
    _headerController.dispose();
    _footerController.dispose();
    _hotspotController.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _syncControllers(PrintSettings s) {
    _syncingControllers = true;
    if (_headerController.text != s.knobs.headerText) {
      _headerController.text = s.knobs.headerText;
    }
    if (_footerController.text != s.knobs.footerText) {
      _footerController.text = s.knobs.footerText;
    }
    if (_hotspotController.text != s.knobs.hotspotAddress) {
      _hotspotController.text = s.knobs.hotspotAddress;
    }
    _syncingControllers = false;
  }

  void _saveKnob(PrintSettingsState state, PrintKnobs Function(PrintKnobs) fn) {
    if (state.settings == null) return;
    final next =
        state.settings!.copyWith(knobs: fn(state.settings!.knobs));
    ref.read(printSettingsProvider.notifier).save(next);
  }

  /// Debounced save for the free-text knobs. When the timer fires it reads
  /// the CURRENT provider state (not the snapshot taken at keystroke time) and
  /// syncs all three text controllers at once, so a switch toggled during the
  /// debounce window is never overwritten by the stale snapshot (PUT replaces
  /// the whole document) and an edit in one field is never lost because a
  /// later edit in another field cancelled its timer.
  void _debounceSave(PrintSettingsState state, PrintKnobs Function(PrintKnobs) fn) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 600), () {
      if (!mounted) return;
      final fresh = ref.read(printSettingsProvider);
      _saveKnob(
        fresh,
        (k) => k.copyWith(
          headerText: _headerController.text.trim(),
          footerText: _footerController.text.trim(),
          hotspotAddress: _hotspotController.text.trim(),
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(printSettingsProvider);

    if (state.isLoading && state.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: Text(context.tr('settings.voucherPrinting'))),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    if (state.error != null && state.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: Text(context.tr('settings.voucherPrinting'))),
        body: ErrorState(
          message: state.error!,
          onRetry: () => ref.read(printSettingsProvider.notifier).load(),
          retryLabel: context.tr('common.retry'),
        ),
      );
    }

    final s = state.settings ?? const PrintSettings();
    _syncControllers(s);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: Text(context.tr('settings.voucherPrinting'))),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          if (state.error != null) ...[
            InlineErrorBanner(message: state.error!),
            const SizedBox(height: AppSpacing.sm),
          ],
          _buildCodeLengthSection(state, s),
          const SizedBox(height: AppSpacing.xl),
          _buildTemplateSection(s),
          const SizedBox(height: AppSpacing.xl),
          _buildKnobsSection(state, s),
          if (s.templateId != VoucherTemplateId.strips) ...[
            const SizedBox(height: AppSpacing.xl),
            _buildColumnsSection(state, s),
          ],
          const SizedBox(height: AppSpacing.xxl),
        ],
      ),
    );
  }

  // ── Code length section ──────────────────────────────────────────────────

  Widget _buildCodeLengthSection(PrintSettingsState state, PrintSettings s) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: context.tr('settings.codeLength')),
        const SizedBox(height: AppSpacing.sm),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  IconButton(
                    icon: const Icon(Icons.remove),
                    onPressed: s.codeLength <= 6
                        ? null
                        : () {
                            final next = s.copyWith(codeLength: s.codeLength - 1);
                            ref.read(printSettingsProvider.notifier).save(next);
                          },
                  ),
                  const SizedBox(width: AppSpacing.lg),
                  Text(
                    s.codeLength.toString(),
                    style: AppTypography.headline.copyWith(
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary),
                  ),
                  const SizedBox(width: AppSpacing.lg),
                  IconButton(
                    icon: const Icon(Icons.add),
                    onPressed: s.codeLength >= 12
                        ? null
                        : () {
                            final next = s.copyWith(codeLength: s.codeLength + 1);
                            ref.read(printSettingsProvider.notifier).save(next);
                          },
                  ),
                ],
              ),
              Text(
                context.tr('settings.codeLengthHint'),
                style: AppTypography.footnote
                    .copyWith(color: AppColors.textSecondary),
              ),
              if (s.codeLength < 8) ...[
                const SizedBox(height: AppSpacing.sm),
                Text(
                  context.tr('settings.codeLengthShortWarning'),
                  style: AppTypography.footnote
                      .copyWith(color: AppColors.warning),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  // ── Template section ─────────────────────────────────────────────────────

  Widget _buildTemplateSection(PrintSettings s) {
    final routersState = ref.watch(routersProvider);
    final routerName = routersState.routers.isNotEmpty
        ? routersState.routers.first.name
        : context.tr('common.appName');
    final locale = Localizations.localeOf(context).languageCode;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: context.tr('settings.cardTemplate')),
        const SizedBox(height: AppSpacing.sm),
        Row(
          children: VoucherTemplateId.values.map((id) {
            final isSelected = s.templateId == id;
            return Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xs),
                child: _TemplateTile(
                  templateId: id,
                  routerName: routerName,
                  locale: locale,
                  isSelected: isSelected,
                  onTap: () {
                    if (!isSelected) {
                      final next = s.copyWith(templateId: id);
                      ref.read(printSettingsProvider.notifier).save(next);
                    }
                  },
                ),
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  // ── Knobs section ────────────────────────────────────────────────────────

  Widget _buildKnobsSection(PrintSettingsState state, PrintSettings s) {
    final isDetailed = s.templateId == VoucherTemplateId.detailed;
    final isStrips = s.templateId == VoucherTemplateId.strips;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: context.tr('settings.templateOptions')),
        const SizedBox(height: AppSpacing.sm),
        AppCard(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              // Header text — all templates
              _TextKnobTile(
                label: context.tr('knob.headerText'),
                hint: context.tr('knob.headerTextHint'),
                controller: _headerController,
                maxLength: 60,
                onChanged: (_) {
                  if (_syncingControllers) return;
                  _debounceSave(state,
                      (k) => k.copyWith(headerText: _headerController.text));
                },
              ),
              const Divider(height: 1, color: AppColors.border),
              // Show price — all templates
              SwitchListTile(
                title: Text(context.tr('knob.showPrice'),
                    style: AppTypography.body),
                value: s.knobs.showPrice,
                contentPadding: const EdgeInsetsDirectional.symmetric(
                    horizontal: AppSpacing.lg),
                onChanged: (v) =>
                    _saveKnob(state, (k) => k.copyWith(showPrice: v)),
              ),
              if (isDetailed) ...[
                const Divider(height: 1, color: AppColors.border),
                _TextKnobTile(
                  label: context.tr('knob.footerText'),
                  hint: context.tr('print.howToDefault'),
                  controller: _footerController,
                  maxLength: 120,
                  onChanged: (_) {
                    if (_syncingControllers) return;
                    _debounceSave(state,
                        (k) => k.copyWith(footerText: _footerController.text));
                  },
                ),
                const Divider(height: 1, color: AppColors.border),
                SwitchListTile(
                  title: Text(context.tr('knob.showBatch'),
                      style: AppTypography.body),
                  value: s.knobs.showBatch,
                  contentPadding: const EdgeInsetsDirectional.symmetric(
                      horizontal: AppSpacing.lg),
                  onChanged: (v) =>
                      _saveKnob(state, (k) => k.copyWith(showBatch: v)),
                ),
                const Divider(height: 1, color: AppColors.border),
                SwitchListTile(
                  title: Text(context.tr('knob.showQr'),
                      style: AppTypography.body),
                  value: s.knobs.showQr,
                  contentPadding: const EdgeInsetsDirectional.symmetric(
                      horizontal: AppSpacing.lg),
                  onChanged: (v) =>
                      _saveKnob(state, (k) => k.copyWith(showQr: v)),
                ),
                if (s.knobs.showQr) ...[
                  const Divider(height: 1, color: AppColors.border),
                  _TextKnobTile(
                    label: context.tr('knob.hotspotAddress'),
                    hint: context.tr('knob.hotspotAddressHint'),
                    controller: _hotspotController,
                    maxLength: 100,
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(
                          RegExp(r'[A-Za-z0-9.\-_/:]')),
                    ],
                    onChanged: (_) {
                      if (_syncingControllers) return;
                      _debounceSave(
                          state,
                          (k) => k.copyWith(
                              hotspotAddress: _hotspotController.text));
                    },
                  ),
                ],
              ],
              if (isStrips) ...[
                const Divider(height: 1, color: AppColors.border),
                SwitchListTile(
                  title: Text(context.tr('knob.showBatch'),
                      style: AppTypography.body),
                  value: s.knobs.showBatch,
                  contentPadding: const EdgeInsetsDirectional.symmetric(
                      horizontal: AppSpacing.lg),
                  onChanged: (v) =>
                      _saveKnob(state, (k) => k.copyWith(showBatch: v)),
                ),
                const Divider(height: 1, color: AppColors.border),
                _StripsStepper(
                  value: s.knobs.stripsPerPage,
                  onDecrement: s.knobs.stripsPerPage <= 4
                      ? null
                      : () => _saveKnob(state,
                          (k) => k.copyWith(stripsPerPage: k.stripsPerPage - 1)),
                  onIncrement: s.knobs.stripsPerPage >= 12
                      ? null
                      : () => _saveKnob(state,
                          (k) => k.copyWith(stripsPerPage: k.stripsPerPage + 1)),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  // ── Default columns section ───────────────────────────────────────────────

  Widget _buildColumnsSection(PrintSettingsState state, PrintSettings s) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: context.tr('settings.defaultColumns')),
        const SizedBox(height: AppSpacing.sm),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    context.tr('vouchers.columns',
                        [s.defaultColumns.toString()]),
                    style: AppTypography.footnote
                        .copyWith(color: AppColors.textSecondary),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: SliderTheme(
                      data: SliderTheme.of(context).copyWith(
                        trackHeight: 2,
                        thumbShape: const RoundSliderThumbShape(
                            enabledThumbRadius: 8),
                      ),
                      child: Slider(
                        value: s.defaultColumns.toDouble(),
                        min: 2,
                        max: 9,
                        divisions: 7,
                        activeColor: AppColors.primary,
                        onChanged: (_) {},
                        onChangeEnd: (v) {
                          final next =
                              s.copyWith(defaultColumns: v.round());
                          ref
                              .read(printSettingsProvider.notifier)
                              .save(next);
                        },
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ── Template tile ────────────────────────────────────────────────────────────

class _TemplateTile extends ConsumerWidget {
  final VoucherTemplateId templateId;
  final String routerName;
  final String locale;
  final bool isSelected;
  final VoidCallback onTap;

  const _TemplateTile({
    required this.templateId,
    required this.routerName,
    required this.locale,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final key = (
      templateId: templateId,
      routerName: routerName,
      locale: locale,
    );
    final thumbAsync = ref.watch(templateThumbnailProvider(key));

    final border = isSelected
        ? Border.all(color: AppColors.primary, width: 2)
        : Border.all(color: AppColors.border);

    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppSpacing.radiusXl),
          border: border,
        ),
        padding: const EdgeInsets.all(AppSpacing.sm),
        child: Column(
          children: [
            AspectRatio(
              aspectRatio: 0.7,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppSpacing.sm),
                child: Container(
                  color: AppColors.surfaceMuted,
                  child: thumbAsync.when(
                  data: (bytes) => Image.memory(bytes, fit: BoxFit.contain),
                  loading: () => _SkeletonThumb(),
                  error: (e, s) => Center(
                    child: Text(
                      context.tr('template.${templateId.wireName}'),
                      style: AppTypography.caption2,
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              context.tr('template.${templateId.wireName}'),
              style: AppTypography.caption1.copyWith(
                fontWeight:
                    isSelected ? FontWeight.w700 : FontWeight.w500,
                color: isSelected
                    ? AppColors.primary
                    : AppColors.textPrimary,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            Text(
              context.tr('template.${templateId.wireName}Description'),
              style: AppTypography.caption2
                  .copyWith(color: AppColors.textSecondary),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _SkeletonThumb extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(color: AppColors.border);
  }
}

// ── Text knob tile ────────────────────────────────────────────────────────────

class _TextKnobTile extends StatelessWidget {
  final String label;
  final String hint;
  final TextEditingController controller;
  final int maxLength;
  final List<TextInputFormatter>? inputFormatters;
  final ValueChanged<String> onChanged;

  const _TextKnobTile({
    required this.label,
    required this.hint,
    required this.controller,
    required this.maxLength,
    required this.onChanged,
    this.inputFormatters,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
      child: TextField(
        controller: controller,
        maxLength: maxLength,
        maxLines: 1,
        inputFormatters: inputFormatters,
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          border: InputBorder.none,
          counterText: '',
        ),
        onChanged: onChanged,
      ),
    );
  }
}

// ── Strips per page stepper tile ──────────────────────────────────────────────

class _StripsStepper extends StatelessWidget {
  final int value;
  final VoidCallback? onDecrement;
  final VoidCallback? onIncrement;

  const _StripsStepper({
    required this.value,
    this.onDecrement,
    this.onIncrement,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
      child: Row(
        children: [
          Expanded(
            child: Text(context.tr('knob.stripsPerPage'),
                style: AppTypography.body),
          ),
          IconButton(icon: const Icon(Icons.remove), onPressed: onDecrement),
          Text(value.toString(),
              style: AppTypography.body
                  .copyWith(fontWeight: FontWeight.w600)),
          IconButton(icon: const Icon(Icons.add), onPressed: onIncrement),
        ],
      ),
    );
  }
}
