import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/models/voucher_batch.dart';

void main() {
  group('VoucherBatch.fromJson', () {
    test('parses a complete JSON with string numerics and µs batchKey', () {
      final json = {
        'batchKey': '2026-08-09T10:11:12.123456Z',
        'createdAt': '2026-08-09T10:11:12.123456Z',
        'count': '100',          // numeric string — defensive parse
        'limitType': 'time',
        'limitValue': '3600',    // numeric string — defensive parse
        'limitUnit': 'hours',
        'validitySeconds': '86400',
        'price': '1.5',
      };

      final batch = VoucherBatch.fromJson(json);

      expect(batch.batchKey, '2026-08-09T10:11:12.123456Z');
      expect(batch.count, 100);
      expect(batch.limitType, 'time');
      expect(batch.limitValue, 3600);
      expect(batch.limitUnit, 'hours');
      expect(batch.validitySeconds, 86400);
      expect(batch.price, closeTo(1.5, 0.001));
      expect(batch.createdAt,
          DateTime.parse('2026-08-09T10:11:12.123456Z'));
    });

    test('parses a JSON with int numerics (not strings)', () {
      final json = {
        'batchKey': '2026-08-09T10:11:12.123456Z',
        'createdAt': '2026-08-09T10:11:12.123456Z',
        'count': 200,
        'limitType': 'data',
        'limitValue': 1073741824,
        'limitUnit': 'GB',
        'validitySeconds': null,
        'price': 2.0,
      };

      final batch = VoucherBatch.fromJson(json);

      expect(batch.count, 200);
      expect(batch.limitValue, 1073741824);
      expect(batch.validitySeconds, isNull);
      expect(batch.price, closeTo(2.0, 0.001));
    });

    test('tolerates null limit and price fields', () {
      final json = {
        'batchKey': '2026-08-08T08:00:00.000000Z',
        'createdAt': '2026-08-08T08:00:00.000000Z',
        'count': 50,
        'limitType': null,
        'limitValue': null,
        'limitUnit': null,
        'validitySeconds': null,
        'price': null,
      };

      final batch = VoucherBatch.fromJson(json);

      expect(batch.limitType, isNull);
      expect(batch.limitValue, isNull);
      expect(batch.limitUnit, isNull);
      expect(batch.validitySeconds, isNull);
      expect(batch.price, isNull);
    });

  });
}
