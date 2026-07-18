import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../i18n/app_localizations.dart';
import '../../models/hotspot_template.dart';
import '../../providers/hotspot_templates_provider.dart';
import '../../providers/routers_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';
import '../../utils/error_messages.dart';
import '../../widgets/widgets.dart';

// Returns the Arabic string when the current locale is Arabic and `ar` is
// non-empty; falls back to English. Mirrors AccentPreset's locale handling.
String _loc(BuildContext c, String en, String ar) =>
    Localizations.localeOf(c).languageCode == 'ar' && ar.isNotEmpty ? ar : en;

class HotspotTemplateScreen extends ConsumerWidget {
  final String routerId;
  final String routerName;
  final String? currentAccent;

  const HotspotTemplateScreen({
    super.key,
    required this.routerId,
    this.routerName = '',
    this.currentAccent,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final templatesAsync = ref.watch(hotspotTemplatesProvider);
    final applyState = ref.watch(hotspotTemplateNotifierProvider);
    final router = ref.watch(routersProvider).selectedRouter;

    // Confirm a successful apply — the "Selected" badge is the only other
    // success signal, so a snackbar makes the action feel acknowledged.
    ref.listen<HotspotApplyState>(hotspotTemplateNotifierProvider,
        (prev, next) {
      if (prev?.status != next.status &&
          next.status == HotspotApplyStatus.applied) {
        AppSnackbar.success(
            context, context.tr('routers.hotspotTemplate.applySuccess'));
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: Text(context.tr('routers.hotspotTemplate.title')),
      ),
      body: templatesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _ErrorBody(
          message: context.trOrRaw(errorToDisplay(e)),
          onRetry: () => ref.invalidate(hotspotTemplatesProvider),
        ),
        data: (templates) => _TemplateList(
          routerId: routerId,
          routerName: routerName,
          currentAccent: currentAccent,
          templates: templates,
          selectedTemplateId: router?.hotspotTemplateId,
          applyState: applyState,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Template list
// ---------------------------------------------------------------------------

class _TemplateList extends ConsumerWidget {
  final String routerId;
  final String routerName;
  final String? currentAccent;
  final List<HotspotTemplate> templates;
  final String? selectedTemplateId;
  final HotspotApplyState applyState;

  const _TemplateList({
    required this.routerId,
    required this.routerName,
    required this.currentAccent,
    required this.templates,
    required this.selectedTemplateId,
    required this.applyState,
  });

  String _resolveInitialAccent(HotspotTemplate template) {
    final current = currentAccent;
    if (current != null &&
        template.accentPresets.any((p) => p.hex == current)) {
      return current;
    }
    return template.defaultAccent;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        Text(
          context.tr('routers.hotspotTemplate.subtitle'),
          style:
              AppTypography.subhead.copyWith(color: AppColors.textSecondary),
        ),
        const SizedBox(height: AppSpacing.lg),
        if (applyState.isFailed && applyState.error != null) ...[
          _ApplyErrorBanner(
            message: context.trOrRaw(applyState.error!),
            onRetry: null, // retry is per-card tap
          ),
          const SizedBox(height: AppSpacing.lg),
        ],
        ...templates.map(
          (t) => _TemplateCard(
            template: t,
            isSelected: t.id == selectedTemplateId,
            isApplying: applyState.isApplying,
            onTap: applyState.isApplying
                ? null
                : () => _showAccentPickerSheet(
                      context,
                      ref,
                      template: t,
                      initialAccent: _resolveInitialAccent(t),
                    ),
          ),
        ),
      ],
    );
  }

  void _showAccentPickerSheet(
    BuildContext context,
    WidgetRef ref, {
    required HotspotTemplate template,
    required String initialAccent,
  }) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(AppSpacing.radiusXl),
        ),
      ),
      builder: (_) => _AccentPickerSheet(
        template: template,
        routerName: routerName,
        initialAccent: initialAccent,
        onApply: (hex) {
          ref
              .read(hotspotTemplateNotifierProvider.notifier)
              .applyTemplate(routerId, template.id, accentColor: hex);
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Accent picker bottom sheet
// ---------------------------------------------------------------------------

class _AccentPickerSheet extends StatefulWidget {
  final HotspotTemplate template;
  final String routerName;
  final String initialAccent;
  final void Function(String accentColor) onApply;

  const _AccentPickerSheet({
    required this.template,
    required this.routerName,
    required this.initialAccent,
    required this.onApply,
  });

  @override
  State<_AccentPickerSheet> createState() => _AccentPickerSheetState();
}

class _AccentPickerSheetState extends State<_AccentPickerSheet> {
  late String _selectedHex;

  @override
  void initState() {
    super.initState();
    _selectedHex = widget.initialAccent;
  }

  Color _parseHex(String hex) {
    final value = int.parse(hex.replaceAll('#', ''), radix: 16);
    return Color(0xFF000000 | value);
  }

  @override
  Widget build(BuildContext context) {
    final presets = widget.template.accentPresets;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.xl,
          AppSpacing.lg,
          AppSpacing.xl,
          AppSpacing.xl,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Drag handle
            Center(
              child: Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(bottom: AppSpacing.lg),
                decoration: BoxDecoration(
                  color: AppColors.border,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusFull),
                ),
              ),
            ),
            // Template name
            Text(
              _loc(context, widget.template.nameEn, widget.template.nameAr),
              style: AppTypography.title2,
            ),
            const SizedBox(height: AppSpacing.sm),
            // "Guests will see: <router name>"
            if (widget.routerName.isNotEmpty) ...[
              RichText(
                text: TextSpan(
                  style: AppTypography.subhead
                      .copyWith(color: AppColors.textSecondary),
                  children: [
                    TextSpan(
                        text:
                            '${context.tr('routers.hotspotTemplate.guestsSee')} '),
                    TextSpan(
                      text: widget.routerName,
                      style: AppTypography.subhead.copyWith(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
            ],
            // Rename caption
            Text(
              context.tr('routers.hotspotTemplate.renameCaption'),
              style: AppTypography.caption1,
            ),
            if (presets.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.xl),
              Text(
                context.tr('routers.hotspotTemplate.accentColor'),
                style: AppTypography.callout,
              ),
              const SizedBox(height: AppSpacing.md),
              _SwatchRow(
                presets: presets,
                selectedHex: _selectedHex,
                parseHex: _parseHex,
                onSelect: (hex) => setState(() => _selectedHex = hex),
              ),
            ],
            const SizedBox(height: AppSpacing.xl),
            // Apply button
            FilledButton(
              onPressed: () {
                Navigator.of(context).pop();
                widget.onApply(_selectedHex);
              },
              child: Text(context.tr('routers.hotspotTemplate.applyDesign')),
            ),
            const SizedBox(height: AppSpacing.sm),
            // Cancel button
            OutlinedButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text(context.tr('common.cancel')),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Swatch row — extracted to keep _AccentPickerSheetState.build short
// ---------------------------------------------------------------------------

class _SwatchRow extends StatelessWidget {
  final List<AccentPreset> presets;
  final String selectedHex;
  final Color Function(String) parseHex;
  final void Function(String) onSelect;

  const _SwatchRow({
    required this.presets,
    required this.selectedHex,
    required this.parseHex,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppSpacing.md,
      runSpacing: AppSpacing.md,
      children: presets
          .map((p) => _Swatch(
                preset: p,
                isSelected: p.hex == selectedHex,
                color: parseHex(p.hex),
                onTap: () => onSelect(p.hex),
              ))
          .toList(),
    );
  }
}

class _Swatch extends StatelessWidget {
  final AccentPreset preset;
  final bool isSelected;
  final Color color;
  final VoidCallback onTap;

  const _Swatch({
    required this.preset,
    required this.isSelected,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: Directionality.of(context) == TextDirection.rtl
          ? preset.nameAr
          : preset.nameEn,
      selected: isSelected,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: color,
            border: isSelected
                ? Border.all(color: Colors.white, width: 3)
                : null,
            boxShadow: isSelected
                ? [
                    BoxShadow(
                      color: color.withValues(alpha: 0.5),
                      blurRadius: 8,
                      spreadRadius: 2,
                    )
                  ]
                : null,
          ),
          child: isSelected
              ? const Icon(Icons.check, color: Colors.white, size: 20)
              : null,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Individual template card
// ---------------------------------------------------------------------------

class _TemplateCard extends StatelessWidget {
  final HotspotTemplate template;
  final bool isSelected;
  final bool isApplying;
  final VoidCallback? onTap;

  const _TemplateCard({
    required this.template,
    required this.isSelected,
    required this.isApplying,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppSpacing.radiusXl),
          border: Border.all(
            color: isSelected ? AppColors.primary : AppColors.border,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: AppCard(
          padding: EdgeInsets.zero,
          borderRadius: BorderRadius.circular(AppSpacing.radiusXl - 1),
          onTap: onTap,
          shadows: const [],
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _PreviewImage(
                url: template.previewUrl,
                name: _loc(context, template.nameEn, template.nameAr),
              ),
              Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: _CardBody(
                  template: template,
                  isSelected: isSelected,
                  isApplying: isApplying,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Preview image with shimmer + error fallback
// ---------------------------------------------------------------------------

class _PreviewImage extends StatelessWidget {
  final String url;
  final String name;

  const _PreviewImage({required this.url, required this.name});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: const BorderRadius.only(
        topLeft: Radius.circular(AppSpacing.radiusXl - 1),
        topRight: Radius.circular(AppSpacing.radiusXl - 1),
      ),
      child: AspectRatio(
        aspectRatio: 16 / 9,
        child: Image.network(
          url,
          fit: BoxFit.cover,
          loadingBuilder: (_, child, progress) {
            if (progress == null) return child;
            return const _ImageShimmer();
          },
          errorBuilder: (context, error, stackTrace) =>
              _ImageFallback(name: name),
        ),
      ),
    );
  }
}

class _ImageShimmer extends StatelessWidget {
  const _ImageShimmer();

  @override
  Widget build(BuildContext context) {
    return const Skeleton(
      height: double.infinity,
      width: double.infinity,
      radius: 0,
    );
  }
}

class _ImageFallback extends StatelessWidget {
  final String name;

  const _ImageFallback({required this.name});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.surfaceMuted,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.web, size: 40, color: AppColors.textTertiary),
            const SizedBox(height: AppSpacing.sm),
            Text(
              name,
              style: AppTypography.caption1,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Card body: name + description + badge
// ---------------------------------------------------------------------------

class _CardBody extends StatelessWidget {
  final HotspotTemplate template;
  final bool isSelected;
  final bool isApplying;

  const _CardBody({
    required this.template,
    required this.isSelected,
    required this.isApplying,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                _loc(context, template.nameEn, template.nameAr),
                style: AppTypography.title3,
              ),
            ),
            if (isSelected)
              StatusBadge(
                label: context.tr('routers.hotspotTemplate.selected'),
                color: AppColors.success,
              ),
            if (isApplying && !isSelected)
              const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
          ],
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          _loc(context, template.descriptionEn, template.descriptionAr),
          style:
              AppTypography.subhead.copyWith(color: AppColors.textSecondary),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Error states
// ---------------------------------------------------------------------------

class _ErrorBody extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;

  const _ErrorBody({required this.message, this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline,
                size: 48, color: AppColors.textTertiary),
            const SizedBox(height: AppSpacing.md),
            Text(
              message,
              style:
                  AppTypography.body.copyWith(color: AppColors.textSecondary),
              textAlign: TextAlign.center,
            ),
            if (onRetry != null) ...[
              const SizedBox(height: AppSpacing.lg),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: Text(context.tr('common.retry')),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ApplyErrorBanner extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;

  const _ApplyErrorBanner({required this.message, this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.errorLight,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline,
              size: 18, color: AppColors.errorDark),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: AppTypography.subhead
                  .copyWith(color: AppColors.errorDark),
            ),
          ),
          if (onRetry != null)
            TextButton(
              onPressed: onRetry,
              child: Text(context.tr('common.retry')),
            ),
        ],
      ),
    );
  }
}
