import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/models/subscription.dart';

void main() {
  final validJson = {
    'id': 'sub-1',
    'planTier': 'starter',
    'planName': 'Starter',
    'status': 'active',
    'voucherQuota': 500,
    'vouchersUsed': 100,
    'daysRemaining': 25,
    'maxRouters': 1,
    'startDate': '2026-03-01T00:00:00.000Z',
    'endDate': '2026-03-31T00:00:00.000Z',
  };

  group('Subscription', () {
    test('fromJson creates correct object', () {
      final sub = Subscription.fromJson(validJson);
      expect(sub.id, 'sub-1');
      expect(sub.planTier, 'starter');
      expect(sub.voucherQuota, 500);
      expect(sub.vouchersUsed, 100);
      expect(sub.daysRemaining, 25);
    });

    test('status getters work correctly', () {
      expect(Subscription.fromJson(validJson).isActive, true);
      expect(Subscription.fromJson(validJson).isPending, false);
      expect(Subscription.fromJson({...validJson, 'status': 'pending'}).isPending, true);
      expect(Subscription.fromJson({...validJson, 'status': 'expired'}).isExpired, true);
    });

    test('vouchersRemaining calculates correctly', () {
      final sub = Subscription.fromJson(validJson);
      expect(sub.vouchersRemaining, 400);
    });

    test('vouchersRemaining returns -1 for unlimited', () {
      final sub = Subscription.fromJson({...validJson, 'voucherQuota': -1});
      expect(sub.vouchersRemaining, -1);
    });

    test('fromJson handles defaults for optional fields', () {
      final json = {
        'id': 'sub-1',
        'planTier': 'starter',
        'planName': 'Starter',
        'status': 'active',
        'voucherQuota': 500,
        'startDate': '2026-03-01T00:00:00.000Z',
        'endDate': '2026-03-31T00:00:00.000Z',
      };
      final sub = Subscription.fromJson(json);
      expect(sub.vouchersUsed, 0);
      expect(sub.daysRemaining, 0);
      expect(sub.maxRouters, 0);
    });
  });
}
