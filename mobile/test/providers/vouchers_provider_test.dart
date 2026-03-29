import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:wasel/models/voucher.dart';
import 'package:wasel/providers/vouchers_provider.dart';
import 'package:wasel/services/voucher_service.dart';

class MockVoucherService extends Mock implements VoucherService {}

void main() {
  late MockVoucherService mockService;
  late VouchersNotifier notifier;

  final mockVoucher = Voucher.fromJson({
    'id': 'v-1',
    'userId': 'u-1',
    'routerId': 'r-1',
    'username': 'voucher-abc',
    'password': 'pass123',
    'profileName': 'Basic Plan',
    'groupProfile': 'basic-plan',
    'status': 'active',
    'createdAt': '2026-01-01T00:00:00.000Z',
    'updatedAt': '2026-01-01T00:00:00.000Z',
  });

  final mockVoucher2 = Voucher.fromJson({
    'id': 'v-2',
    'userId': 'u-1',
    'routerId': 'r-1',
    'username': 'voucher-def',
    'profileName': 'Basic Plan',
    'groupProfile': 'basic-plan',
    'status': 'disabled',
    'createdAt': '2026-01-01T00:00:00.000Z',
    'updatedAt': '2026-01-01T00:00:00.000Z',
  });

  setUp(() {
    mockService = MockVoucherService();
    notifier = VouchersNotifier(voucherService: mockService);
  });

  group('VouchersNotifier', () {
    test('initial state is correct', () {
      expect(notifier.state.vouchers, isEmpty);
      expect(notifier.state.selectedVoucher, isNull);
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
      expect(notifier.state.total, 0);
      expect(notifier.state.hasMore, false);
    });

    test('loadVouchers sets vouchers on success', () async {
      when(() => mockService.getVouchers(
            'r-1',
            status: null,
            profileId: null,
            search: null,
            page: 1,
            limit: 20,
          )).thenAnswer((_) async => VoucherListResult(
            vouchers: [mockVoucher, mockVoucher2],
            total: 2,
            page: 1,
            limit: 20,
          ));

      await notifier.loadVouchers('r-1');

      expect(notifier.state.vouchers, hasLength(2));
      expect(notifier.state.total, 2);
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });

    test('loadVouchers sets error on failure', () async {
      when(() => mockService.getVouchers(
            'r-1',
            status: any(named: 'status'),
            profileId: any(named: 'profileId'),
            search: any(named: 'search'),
            page: any(named: 'page'),
            limit: any(named: 'limit'),
          )).thenThrow(Exception('fail'));

      await notifier.loadVouchers('r-1');

      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNotNull);
    });

    test('createVoucher adds to list and returns true', () async {
      when(() => mockService.createVoucher(
            routerId: 'r-1',
            profileId: 'p-1',
          )).thenAnswer((_) async => mockVoucher);

      final result = await notifier.createVoucher(
        routerId: 'r-1',
        profileId: 'p-1',
      );

      expect(result, true);
      expect(notifier.state.vouchers, hasLength(1));
      expect(notifier.state.selectedVoucher?.id, 'v-1');
      expect(notifier.state.total, 1);
    });

    test('createVoucher returns false on failure', () async {
      when(() => mockService.createVoucher(
            routerId: 'r-1',
            profileId: 'p-1',
          )).thenThrow(Exception('quota'));

      final result = await notifier.createVoucher(
        routerId: 'r-1',
        profileId: 'p-1',
      );

      expect(result, false);
      expect(notifier.state.error, isNotNull);
    });

    test('createVouchersBulk adds to list', () async {
      when(() => mockService.createVouchersBulk(
            routerId: 'r-1',
            profileId: 'p-1',
            count: 2,
          )).thenAnswer((_) async => [mockVoucher, mockVoucher2]);

      final result = await notifier.createVouchersBulk(
        routerId: 'r-1',
        profileId: 'p-1',
        count: 2,
      );

      expect(result, true);
      expect(notifier.state.vouchers, hasLength(2));
      expect(notifier.state.total, 2);
    });

    test('deleteVoucher removes from list', () async {
      // First load vouchers
      when(() => mockService.getVouchers(
            'r-1',
            status: null,
            profileId: null,
            search: null,
            page: 1,
            limit: 20,
          )).thenAnswer((_) async => VoucherListResult(
            vouchers: [mockVoucher, mockVoucher2],
            total: 2,
            page: 1,
            limit: 20,
          ));
      await notifier.loadVouchers('r-1');

      when(() => mockService.deleteVoucher('r-1', 'v-1'))
          .thenAnswer((_) async {});

      final result = await notifier.deleteVoucher('r-1', 'v-1');

      expect(result, true);
      expect(notifier.state.vouchers, hasLength(1));
      expect(notifier.state.vouchers[0].id, 'v-2');
      expect(notifier.state.total, 1);
    });

    test('toggleVoucherStatus updates voucher in list', () async {
      // Load initial voucher
      when(() => mockService.getVouchers(
            'r-1',
            status: null,
            profileId: null,
            search: null,
            page: 1,
            limit: 20,
          )).thenAnswer((_) async => VoucherListResult(
            vouchers: [mockVoucher],
            total: 1,
            page: 1,
            limit: 20,
          ));
      await notifier.loadVouchers('r-1');

      final disabledVoucher = Voucher.fromJson({
        ...mockVoucher.toJson(),
        'status': 'disabled',
      });
      when(() => mockService.updateVoucher('r-1', 'v-1', status: 'disabled'))
          .thenAnswer((_) async => disabledVoucher);

      final result = await notifier.toggleVoucherStatus('r-1', mockVoucher);

      expect(result, true);
      expect(notifier.state.vouchers[0].status, 'disabled');
    });

    test('setFilter and setSearch update state', () {
      notifier.setFilter(status: 'active');
      expect(notifier.state.filterStatus, 'active');

      notifier.setSearch('test');
      expect(notifier.state.searchQuery, 'test');

      notifier.setSearch(null);
      expect(notifier.state.searchQuery, isNull);
    });

    test('clearSelection clears selected voucher', () async {
      when(() => mockService.createVoucher(
            routerId: 'r-1',
            profileId: 'p-1',
          )).thenAnswer((_) async => mockVoucher);
      await notifier.createVoucher(routerId: 'r-1', profileId: 'p-1');

      notifier.clearSelection();
      expect(notifier.state.selectedVoucher, isNull);
    });
  });
}
