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
  });
}
