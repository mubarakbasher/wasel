import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/hotspot_template.dart';
import '../models/router_model.dart';
import '../services/router_service.dart';
import '../utils/error_messages.dart';
import 'routers_provider.dart';

// ---------------------------------------------------------------------------
// Templates list — fetched once, shared across the screen.
// ---------------------------------------------------------------------------

final hotspotTemplatesProvider =
    FutureProvider<List<HotspotTemplate>>((ref) async {
  return RouterService().getHotspotTemplates();
});

// ---------------------------------------------------------------------------
// Per-router apply state
// ---------------------------------------------------------------------------

enum HotspotApplyStatus { idle, applying, applied, failed }

class HotspotApplyState {
  final HotspotApplyStatus status;
  final String? error;

  const HotspotApplyState({
    this.status = HotspotApplyStatus.idle,
    this.error,
  });

  bool get isApplying => status == HotspotApplyStatus.applying;
  bool get isApplied => status == HotspotApplyStatus.applied;
  bool get isFailed => status == HotspotApplyStatus.failed;

  HotspotApplyState copyWith({
    HotspotApplyStatus? status,
    String? error,
    bool clearError = false,
  }) {
    return HotspotApplyState(
      status: status ?? this.status,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class HotspotTemplateNotifier extends Notifier<HotspotApplyState> {
  @override
  HotspotApplyState build() => const HotspotApplyState();

  Future<RouterModel?> applyTemplate(
    String routerId,
    String templateId, {
    String? accentColor,
  }) async {
    state = state.copyWith(
      status: HotspotApplyStatus.applying,
      clearError: true,
    );
    try {
      final updated = await RouterService().setHotspotTemplate(
        routerId,
        templateId,
        accentColor: accentColor,
      );

      // Propagate the updated router into the shared routers provider so the
      // detail screen subtitle and any other consumer stays in sync without a
      // full reload. RoutersNotifier exposes refreshRouter for exactly this.
      await ref.read(routersProvider.notifier).refreshRouter(updated);

      // The backend returns HTTP 200 even when the RouterOS push failed — it
      // persists hotspotTemplateStatus='failed' rather than throwing. Surface
      // that as a real failure so the operator sees the error instead of a
      // false "applied" (e.g. when the router can't be reached over the tunnel).
      if (updated.hotspotTemplateStatus == 'failed') {
        state = state.copyWith(
          status: HotspotApplyStatus.failed,
          error: (updated.hotspotTemplateError?.isNotEmpty ?? false)
              ? updated.hotspotTemplateError
              : 'routers.hotspotTemplate.applyFailed',
        );
        return updated;
      }

      state = state.copyWith(status: HotspotApplyStatus.applied);
      return updated;
    } catch (e) {
      state = state.copyWith(
        status: HotspotApplyStatus.failed,
        error: errorToDisplay(e),
      );
      return null;
    }
  }

  void reset() {
    state = const HotspotApplyState();
  }
}

final hotspotTemplateNotifierProvider =
    NotifierProvider<HotspotTemplateNotifier, HotspotApplyState>(
  HotspotTemplateNotifier.new,
);
