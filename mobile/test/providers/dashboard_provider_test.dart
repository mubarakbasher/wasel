import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:wasel/providers/dashboard_provider.dart';
import 'package:wasel/services/dashboard_service.dart';

class MockDashboardService extends Mock implements DashboardService {}

void main() {
  late MockDashboardService mockService;
  late DashboardNotifier notifier;

  setUp(() {
    mockService = MockDashboardService();
    notifier = DashboardNotifier(dashboardService: mockService);
  });

  group('DashboardNotifier', () {
    test('initial state is correct', () {
      expect(notifier.state.data, isNull);
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });

    test('loadDashboard sets data on success', () async {
      final mockData = {
        'routers': [{'id': 'r1', 'name': 'Router 1', 'status': 'online'}],
        'subscription': {'planTier': 'starter', 'status': 'active'},
        'vouchersCreatedToday': 5,
        'totalVouchers': 42,
        'dataUsage24h': {'totalInput': 1000, 'totalOutput': 2000},
        'activeSessionsByRouter': [{'routerId': 'r1', 'routerName': 'Router 1', 'activeSessions': 3}],
      };
      when(() => mockService.getDashboard()).thenAnswer((_) async => mockData);

      await notifier.loadDashboard();

      expect(notifier.state.data, isNotNull);
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
      expect(notifier.state.vouchersCreatedToday, 5);
      expect(notifier.state.totalVouchers, 42);
      expect(notifier.state.totalActiveSessions, 3);
    });

    test('loadDashboard sets error on failure', () async {
      when(() => mockService.getDashboard()).thenThrow(Exception('Network error'));

      await notifier.loadDashboard();

      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNotNull);
    });

    test('convenience getters work on empty state', () {
      expect(notifier.state.routers, isEmpty);
      expect(notifier.state.subscription, isNull);
      expect(notifier.state.vouchersCreatedToday, 0);
      expect(notifier.state.totalVouchers, 0);
      expect(notifier.state.totalActiveSessions, 0);
    });
  });
}
