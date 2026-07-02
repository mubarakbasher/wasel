import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/models/router_model.dart';
import 'package:wasel/providers/hotspot_templates_provider.dart';
import 'package:wasel/providers/routers_provider.dart';

// ---------------------------------------------------------------------------
// Thin notifier tests — no Dio/network involved.
// ---------------------------------------------------------------------------

RouterModel _makeRouter({
  String id = 'r-1',
  String? templateId,
  String? templateStatus,
  String? templateError,
}) {
  return RouterModel(
    id: id,
    userId: 'u-1',
    name: 'Test Router',
    status: 'online',
    createdAt: DateTime(2026),
    updatedAt: DateTime(2026),
    hotspotTemplateId: templateId,
    hotspotTemplateStatus: templateStatus,
    hotspotTemplateError: templateError,
  );
}

void main() {
  group('HotspotApplyState', () {
    test('initial state is idle with no error', () {
      const s = HotspotApplyState();
      expect(s.status, HotspotApplyStatus.idle);
      expect(s.error, isNull);
      expect(s.isApplying, false);
      expect(s.isApplied, false);
      expect(s.isFailed, false);
    });

    test('copyWith transitions to applying', () {
      const s = HotspotApplyState();
      final applying =
          s.copyWith(status: HotspotApplyStatus.applying);
      expect(applying.isApplying, true);
      expect(applying.error, isNull);
    });

    test('copyWith transitions to failed with error', () {
      const s = HotspotApplyState();
      final failed = s.copyWith(
        status: HotspotApplyStatus.failed,
        error: 'Router unreachable',
      );
      expect(failed.isFailed, true);
      expect(failed.error, 'Router unreachable');
    });

    test('copyWith clearError removes error', () {
      const s = HotspotApplyState(
        status: HotspotApplyStatus.failed,
        error: 'something went wrong',
      );
      final cleared = s.copyWith(clearError: true);
      expect(cleared.error, isNull);
      expect(cleared.status, HotspotApplyStatus.failed);
    });

    test('transitions to applied', () {
      const s = HotspotApplyState(status: HotspotApplyStatus.applying);
      final applied = s.copyWith(status: HotspotApplyStatus.applied);
      expect(applied.isApplied, true);
      expect(applied.isFailed, false);
    });
  });

  group('RoutersState.copyWith', () {
    test('refreshRouter logic: updating list preserves unrelated routers', () {
      final original = _makeRouter(id: 'r-1');
      final other = _makeRouter(id: 'r-2');

      final state = RoutersState(
        routers: [original, other],
        selectedRouter: original,
      );

      final updated = _makeRouter(
        id: 'r-1',
        templateId: 'clean',
        templateStatus: 'applied',
      );

      final updatedList = state.routers.map((r) {
        return r.id == updated.id ? updated : r;
      }).toList();

      final newState = state.copyWith(
        routers: updatedList,
        selectedRouter: updated,
      );

      expect(newState.selectedRouter?.hotspotTemplateId, 'clean');
      expect(newState.selectedRouter?.hotspotTemplateStatus, 'applied');
      expect(newState.routers[0].hotspotTemplateId, 'clean');
      // r-2 stays untouched
      expect(newState.routers[1].hotspotTemplateId, isNull);
    });
  });

  group('RouterModel hotspot fields', () {
    test('fromJson reads camelCase hotspotTemplateId, status, error', () {
      // The backend serializes these in camelCase (see router.service.ts) —
      // the model must read the same keys, or the operator's selected design
      // is invisible in the picker + router detail.
      final json = {
        'id': 'r-1',
        'userId': 'u-1',
        'name': 'Test',
        'status': 'online',
        'createdAt': '2026-01-01T00:00:00.000Z',
        'updatedAt': '2026-01-01T00:00:00.000Z',
        'hotspotTemplateId': 'dark',
        'hotspotTemplateStatus': 'applied',
        'hotspotTemplateError': null,
      };
      final router = RouterModel.fromJson(json);
      expect(router.hotspotTemplateId, 'dark');
      expect(router.hotspotTemplateStatus, 'applied');
      expect(router.hotspotTemplateError, isNull);
    });

    test('fromJson defaults hotspot fields to null when absent', () {
      final json = {
        'id': 'r-1',
        'userId': 'u-1',
        'name': 'Test',
        'status': 'offline',
        'createdAt': '2026-01-01T00:00:00.000Z',
        'updatedAt': '2026-01-01T00:00:00.000Z',
      };
      final router = RouterModel.fromJson(json);
      expect(router.hotspotTemplateId, isNull);
      expect(router.hotspotTemplateStatus, isNull);
      expect(router.hotspotTemplateError, isNull);
    });

    test('toJson serialises hotspot fields', () {
      final router = _makeRouter(
        templateId: 'warm',
        templateStatus: 'pending',
        templateError: 'timeout',
      );
      final json = router.toJson();
      expect(json['hotspotTemplateId'], 'warm');
      expect(json['hotspotTemplateStatus'], 'pending');
      expect(json['hotspotTemplateError'], 'timeout');
    });
  });
}
