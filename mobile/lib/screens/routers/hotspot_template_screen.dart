import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../i18n/app_localizations.dart';
import '../../models/hotspot_template.dart';
import '../../providers/hotspot_templates_provider.dart';
import '../../providers/routers_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';
import '../../widgets/widgets.dart';

class HotspotTemplateScreen extends ConsumerWidget {
  final String routerId;

  const HotspotTemplateScreen({super.key, required this.routerId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final templatesAsync = ref.watch(hotspotTemplatesProvider);
    final applyState = ref.watch(hotspotTemplateNotifierProvider);
    final router = ref.watch(routersProvider).selectedRouter;

    return Scaffold(
      appBar: AppBar(
        title: Text(context.tr('routers.hotspotTemplate.title')),
      ),
      body: templatesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _ErrorBody(
          message: context.trOrRaw(e.toString()),
          onRetry: () => ref.invalidate(hotspotTemplatesProvider),
        ),
        data: (templates) => _TemplateList(
          routerId: routerId,
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
  final List<HotspotTemplate> templates;
  final String? selectedTemplateId;
  final HotspotApplyState applyState;

  const _TemplateList({
    required this.routerId,
    required this.templates,
    required this.selectedTemplateId,
    required this.applyState,
  });

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
                : () => ref
                    .read(hotspotTemplateNotifierProvider.notifier)
                    .applyTemplate(routerId, t.id),
          ),
        ),
      ],
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
              _PreviewImage(url: template.previewUrl, name: template.name),
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
              child: Text(template.name, style: AppTypography.title3),
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
          template.description,
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
