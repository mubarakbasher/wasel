import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/models/plan.dart';

void main() {
  final validJson = {
    'tier': 'starter',
    'name': 'Starter',
    'price': 5,
    'currency': 'SDG',
    'maxRouters': 1,
    'monthlyVouchers': 500,
    'sessionMonitoring': 'Active only',
    'dashboard': 'Basic stats',
    'features': ['1 Router', '500 Vouchers/month'],
  };

  group('Plan', () {
    test('fromJson creates correct object', () {
      final plan = Plan.fromJson(validJson);
      expect(plan.tier, 'starter');
      expect(plan.name, 'Starter');
      expect(plan.price, 5.0);
      expect(plan.maxRouters, 1);
      expect(plan.monthlyVouchers, 500);
      expect(plan.features, hasLength(2));
    });

    test('isUnlimitedVouchers returns false for limited', () {
      expect(Plan.fromJson(validJson).isUnlimitedVouchers, false);
    });

    test('isUnlimitedVouchers returns true for -1', () {
      expect(Plan.fromJson({...validJson, 'monthlyVouchers': -1}).isUnlimitedVouchers, true);
    });

    test('priceLabel formats correctly', () {
      expect(Plan.fromJson(validJson).priceLabel('SDG'), 'SDG 5');
      expect(
          Plan.fromJson({...validJson, 'price': 12}).priceLabel('SDG'), 'SDG 12');
    });
  });
}
