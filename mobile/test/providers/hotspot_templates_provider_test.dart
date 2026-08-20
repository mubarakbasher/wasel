import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
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
  String? templateErrorCode,
  String? accentColor,
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
    hotspotTemplateErrorCode: templateErrorCode,
    hotspotAccentColor: accentColor,
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

  group('RouterModel hotspotAccentColor field', () {
    test('fromJson reads hotspotAccentColor', () {
      final json = {
        'id': 'r-1',
        'userId': 'u-1',
        'name': 'Test',
        'status': 'online',
        'createdAt': '2026-01-01T00:00:00.000Z',
        'updatedAt': '2026-01-01T00:00:00.000Z',
        'hotspotAccentColor': '#4f46e5',
      };
      final router = RouterModel.fromJson(json);
      expect(router.hotspotAccentColor, '#4f46e5');
    });

    test('_makeRouter helper propagates accentColor', () {
      final router = _makeRouter(accentColor: '#be123c');
      expect(router.hotspotAccentColor, '#be123c');
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

  // ── Error-code → i18n-key resolution logic ────────────────────────────────
  //
  // These tests mirror what HotspotTemplateNotifier.applyTemplate does in the
  // status == 'failed' branch. We exercise the derivation logic directly so we
  // don't need a live Dio/network layer.
  group('hotspot failed-apply error-key derivation', () {
    /// Replicates the key-selection logic from the notifier.
    String resolveError(RouterModel router) {
      final code = router.hotspotTemplateErrorCode;
      final key = (code != null && code.isNotEmpty) ? 'error.$code' : null;
      return (key != null && AppLocalizations.hasTranslationKey(key))
          ? key
          : 'routers.hotspotTemplate.applyFailed';
    }

    test('known code ROUTER_UNREACHABLE resolves to error.ROUTER_UNREACHABLE', () {
      final router = _makeRouter(
        templateStatus: 'failed',
        templateErrorCode: 'ROUTER_UNREACHABLE',
        templateError: 'Unable to reach the router — it may be offline or unreachable',
      );
      expect(resolveError(router), 'error.ROUTER_UNREACHABLE');
    });

    test('null code with English templateError resolves to applyFailed fallback', () {
      final router = _makeRouter(
        templateStatus: 'failed',
        templateErrorCode: null,
        templateError: 'Unable to reach the router — it may be offline or unreachable',
      );
      expect(resolveError(router), 'routers.hotspotTemplate.applyFailed');
    });

    test('unknown future code resolves to applyFailed fallback', () {
      final router = _makeRouter(
        templateStatus: 'failed',
        templateErrorCode: 'SOME_FUTURE_CODE',
        templateError: 'Some future error',
      );
      expect(resolveError(router), 'routers.hotspotTemplate.applyFailed');
    });

    test('HOTSPOT_TEMPLATE_FETCH_FAILED resolves to its i18n key', () {
      final router = _makeRouter(
        templateStatus: 'failed',
        templateErrorCode: 'HOTSPOT_TEMPLATE_FETCH_FAILED',
      );
      expect(resolveError(router), 'error.HOTSPOT_TEMPLATE_FETCH_FAILED');
    });

    test('HOTSPOT_NOT_CONFIGURED resolves to its i18n key', () {
      final router = _makeRouter(
        templateStatus: 'failed',
        templateErrorCode: 'HOTSPOT_NOT_CONFIGURED',
      );
      expect(resolveError(router), 'error.HOTSPOT_NOT_CONFIGURED');
    });

    test('HOTSPOT_TEMPLATE_APPLY_FAILED resolves to its i18n key', () {
      final router = _makeRouter(
        templateStatus: 'failed',
        templateErrorCode: 'HOTSPOT_TEMPLATE_APPLY_FAILED',
      );
      expect(resolveError(router), 'error.HOTSPOT_TEMPLATE_APPLY_FAILED');
    });

    test('resolved error keys are fully bilingual', () {
      final en = AppLocalizations(const Locale('en'));
      final ar = AppLocalizations(const Locale('ar'));

      for (final code in [
        'HOTSPOT_TEMPLATE_FETCH_FAILED',
        'HOTSPOT_NOT_CONFIGURED',
        'HOTSPOT_TEMPLATE_APPLY_FAILED',
      ]) {
        final key = 'error.$code';
        expect(AppLocalizations.hasTranslationKey(key), isTrue,
            reason: '$key missing from _en');
        expect(en.translate(key), isNot(equals(key)),
            reason: '$key falls back to key in English');
        expect(ar.translate(key), isNot(equals(key)),
            reason: '$key falls back to key in Arabic');
        expect(ar.translate(key), isNot(equals(en.translate(key))),
            reason: '$key has no distinct Arabic string — Arabic user sees English');
      }
    });
  });
}
