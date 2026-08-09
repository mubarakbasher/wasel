import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:wasel/models/voucher_batch.dart';
import 'package:wasel/providers/voucher_batches_provider.dart';
import 'package:wasel/services/voucher_service.dart';

class MockVoucherService extends Mock implements VoucherService {}

void main() {
  late MockVoucherService mockService;
  late VoucherBatchesNotifier notifier;

  final batch1 = VoucherBatch.fromJson({
    'batchKey': '2026-08-09T10:11:12.123456Z',
    'createdAt': '2026-08-09T10:11:12.123456Z',
    'count': 200,
    'limitType': 'time',
    'limitValue': 7200,
    'limitUnit': 'hours',
    'validitySeconds': null,
    'price': 2.0,
  });

  final batch2 = VoucherBatch.fromJson({
    'batchKey': '2026-08-08T08:00:00.000000Z',
    'createdAt': '2026-08-08T08:00:00.000000Z',
    'count': 50,
    'limitType': null,
    'limitValue': null,
    'limitUnit': null,
    'validitySeconds': null,
    'price': null,
  });

  setUp(() {
    mockService = MockVoucherService();
    notifier = VoucherBatchesNotifier(voucherService: mockService);
  });

  group('VoucherBatchesNotifier', () {
    test('initial state has empty batches', () {
      expect(notifier.state.batches, isEmpty);
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });

    test('load populates batches on success', () async {
      when(() => mockService.getVoucherBatches(
            'r-1',
            limit: any(named: 'limit'),
          )).thenAnswer((_) async => [batch1, batch2]);

      await notifier.load('r-1');

      expect(notifier.state.batches, hasLength(2));
      expect(notifier.state.batches[0].batchKey,
          '2026-08-09T10:11:12.123456Z');
      expect(notifier.state.batches[1].batchKey,
          '2026-08-08T08:00:00.000000Z');
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });

    test('load sets error and stops loading on failure', () async {
      when(() => mockService.getVoucherBatches(
            'r-1',
            limit: any(named: 'limit'),
          )).thenThrow(Exception('network error'));

      await notifier.load('r-1');

      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNotNull);
      expect(notifier.state.batches, isEmpty);
    });

    test('stale response is dropped when a newer load started', () async {
      // This test verifies the _requestSeq guard: if seq != _requestSeq on
      // return, the response is silently dropped and state is not updated.

      // Track call count so we can control sequencing.
      int callCount = 0;

      when(() => mockService.getVoucherBatches(
            'r-1',
            limit: any(named: 'limit'),
          )).thenAnswer((_) async {
        callCount++;
        if (callCount == 1) {
          // Slow first request — delay until we cancel it via a second load.
          await Future<void>.delayed(const Duration(milliseconds: 50));
          return [batch1];
        }
        // Fast second request wins.
        return [batch2];
      });

      // Start two loads: the second increments _requestSeq, so first result
      // should be dropped.
      final first = notifier.load('r-1');
      final second = notifier.load('r-1');
      await Future.wait([first, second]);

      // Only the second (fast) result should be visible.
      expect(notifier.state.batches, hasLength(1));
      expect(notifier.state.batches[0].batchKey,
          '2026-08-08T08:00:00.000000Z');
    });

    test('reset clears state', () async {
      when(() => mockService.getVoucherBatches(
            'r-1',
            limit: any(named: 'limit'),
          )).thenAnswer((_) async => [batch1]);

      await notifier.load('r-1');
      expect(notifier.state.batches, isNotEmpty);

      notifier.reset();

      expect(notifier.state.batches, isEmpty);
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });
  });
}
