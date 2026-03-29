import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/models/voucher.dart';

void main() {
  final validJson = {
    'id': 'v-1',
    'userId': 'u-1',
    'routerId': 'r-1',
    'username': 'testuser',
    'password': 'pass123',
    'profileName': 'Basic Plan',
    'groupProfile': 'basic-plan',
    'comment': 'Test voucher',
    'status': 'active',
    'expiration': 'January 01 2027 00:00:00',
    'simultaneousUse': 1,
    'createdAt': '2026-03-01T00:00:00.000Z',
    'updatedAt': '2026-03-01T00:00:00.000Z',
  };

  group('Voucher', () {
    test('fromJson creates correct object', () {
      final voucher = Voucher.fromJson(validJson);
      expect(voucher.id, 'v-1');
      expect(voucher.username, 'testuser');
      expect(voucher.password, 'pass123');
      expect(voucher.profileName, 'Basic Plan');
      expect(voucher.status, 'active');
      expect(voucher.simultaneousUse, 1);
    });

    test('status getters work correctly', () {
      expect(Voucher.fromJson(validJson).isActive, true);
      expect(Voucher.fromJson(validJson).isDisabled, false);
      expect(Voucher.fromJson({...validJson, 'status': 'disabled'}).isDisabled, true);
      expect(Voucher.fromJson({...validJson, 'status': 'expired'}).isExpired, true);
      expect(Voucher.fromJson({...validJson, 'status': 'used'}).isUsed, true);
    });

    test('fromJson handles null optional fields', () {
      final json = {
        'id': 'v-1',
        'userId': 'u-1',
        'routerId': 'r-1',
        'username': 'user',
        'profileName': 'Plan',
        'groupProfile': 'plan',
        'createdAt': '2026-01-01T00:00:00.000Z',
        'updatedAt': '2026-01-01T00:00:00.000Z',
      };
      final voucher = Voucher.fromJson(json);
      expect(voucher.password, isNull);
      expect(voucher.comment, isNull);
      expect(voucher.expiration, isNull);
      expect(voucher.simultaneousUse, isNull);
      expect(voucher.status, 'active');
    });

    test('toJson roundtrip preserves data', () {
      final voucher = Voucher.fromJson(validJson);
      final json = voucher.toJson();
      expect(json['username'], 'testuser');
      expect(json['status'], 'active');
      expect(json['simultaneousUse'], 1);
    });
  });
}
