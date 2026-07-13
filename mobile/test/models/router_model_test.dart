import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/models/router_model.dart';

void main() {
  final validJson = {
    'id': 'r-1',
    'userId': 'u-1',
    'name': 'Office Router',
    'model': 'RB750Gr3',
    'rosVersion': '7.10',
    'apiUser': 'admin',
    'wgPublicKey': 'pubkey',
    'tunnelIp': '10.10.0.2',
    'nasIdentifier': 'office-r1',
    'status': 'online',
    'lastSeen': '2026-03-01T12:00:00.000Z',
    'createdAt': '2026-01-01T00:00:00.000Z',
    'updatedAt': '2026-03-01T12:00:00.000Z',
  };

  group('RouterModel', () {
    test('fromJson creates correct object', () {
      final router = RouterModel.fromJson(validJson);
      expect(router.id, 'r-1');
      expect(router.name, 'Office Router');
      expect(router.model, 'RB750Gr3');
      expect(router.status, 'online');
      expect(router.tunnelIp, '10.10.0.2');
    });

    test('status getters work correctly', () {
      expect(RouterModel.fromJson(validJson).isOnline, true);
      expect(RouterModel.fromJson(validJson).isOffline, false);
      expect(RouterModel.fromJson({...validJson, 'status': 'offline'}).isOffline, true);
      expect(RouterModel.fromJson({...validJson, 'status': 'degraded'}).isDegraded, true);
    });

    test('fromJson handles null optional fields', () {
      final json = {
        'id': 'r-1',
        'userId': 'u-1',
        'name': 'Router',
        'createdAt': '2026-01-01T00:00:00.000Z',
        'updatedAt': '2026-01-01T00:00:00.000Z',
      };
      final router = RouterModel.fromJson(json);
      expect(router.model, isNull);
      expect(router.lastSeen, isNull);
      expect(router.status, 'offline');
    });

    test('toJson produces correct map', () {
      final router = RouterModel.fromJson(validJson);
      final json = router.toJson();
      expect(json['id'], 'r-1');
      expect(json['name'], 'Office Router');
      expect(json['status'], 'online');
    });

    test('fromJson parses hotspot template fields from camelCase', () {
      // The backend serializes these in camelCase (like every other field).
      // Reading snake_case here would leave them null and hide the operator's
      // selected login-page design in the picker + router detail.
      final router = RouterModel.fromJson({
        ...validJson,
        'hotspotTemplateId': 'dark',
        'hotspotTemplateStatus': 'applied',
        'hotspotTemplateError': null,
      });
      expect(router.hotspotTemplateId, 'dark');
      expect(router.hotspotTemplateStatus, 'applied');
      expect(router.hotspotTemplateError, isNull);
    });

    test('toJson round-trips hotspot template fields', () {
      final router = RouterModel.fromJson({
        ...validJson,
        'hotspotTemplateId': 'warm',
        'hotspotTemplateStatus': 'failed',
        'hotspotTemplateError': 'unreachable',
      });
      final round = RouterModel.fromJson(router.toJson());
      expect(round.hotspotTemplateId, 'warm');
      expect(round.hotspotTemplateStatus, 'failed');
      expect(round.hotspotTemplateError, 'unreachable');
    });

    test('fromJson parses hotspotAccentColor', () {
      final router = RouterModel.fromJson({
        ...validJson,
        'hotspotAccentColor': '#4f46e5',
      });
      expect(router.hotspotAccentColor, '#4f46e5');
    });

    test('fromJson defaults hotspotAccentColor to null when absent', () {
      final router = RouterModel.fromJson(validJson);
      expect(router.hotspotAccentColor, isNull);
    });

    test('toJson round-trips hotspotAccentColor', () {
      final router = RouterModel.fromJson({
        ...validJson,
        'hotspotAccentColor': '#be123c',
      });
      final round = RouterModel.fromJson(router.toJson());
      expect(round.hotspotAccentColor, '#be123c');
    });

    test('copyWith preserves existing fields and updates hotspotAccentColor', () {
      final router = RouterModel.fromJson({
        ...validJson,
        'hotspotTemplateId': 'clean',
        'hotspotAccentColor': '#0f766e',
      });
      final updated = router.copyWith(hotspotAccentColor: '#4f46e5');
      expect(updated.id, router.id);
      expect(updated.name, router.name);
      expect(updated.hotspotTemplateId, 'clean');
      expect(updated.hotspotAccentColor, '#4f46e5');
    });
  });
}
