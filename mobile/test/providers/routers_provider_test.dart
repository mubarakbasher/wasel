import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:wasel/models/router_model.dart';
import 'package:wasel/providers/routers_provider.dart';
import 'package:wasel/services/router_service.dart';

class MockRouterService extends Mock implements RouterService {}

void main() {
  late MockRouterService mockService;
  late RoutersNotifier notifier;

  final mockRouter = RouterModel.fromJson({
    'id': 'r-1',
    'userId': 'u-1',
    'name': 'Router 1',
    'model': 'RB750Gr3',
    'rosVersion': '7.10',
    'status': 'online',
    'createdAt': '2026-01-01T00:00:00.000Z',
    'updatedAt': '2026-01-01T00:00:00.000Z',
  });

  final mockRouter2 = RouterModel.fromJson({
    'id': 'r-2',
    'userId': 'u-1',
    'name': 'Router 2',
    'status': 'offline',
    'createdAt': '2026-01-01T00:00:00.000Z',
    'updatedAt': '2026-01-01T00:00:00.000Z',
  });

  final mockCreateResult = CreateRouterResult(
    router: mockRouter,
    setupGuide: RouterSetupGuide(
      routerName: 'Router 1',
      setupGuide: '/interface wireguard add ...',
      tunnelIp: '10.10.0.2',
      steps: const [
        SetupStep(
          step: 1,
          title: 'Create WireGuard interface',
          description: 'Adds the WG interface.',
          command: '/interface wireguard add name=wasel-wg',
        ),
      ],
    ),
  );

  setUp(() {
    mockService = MockRouterService();
    notifier = RoutersNotifier(routerService: mockService);
  });

  group('RoutersNotifier', () {
    test('initial state is correct', () {
      expect(notifier.state.routers, isEmpty);
      expect(notifier.state.selectedRouter, isNull);
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });

    test('loadRouters sets routers on success', () async {
      when(() => mockService.getRouters())
          .thenAnswer((_) async => [mockRouter, mockRouter2]);

      await notifier.loadRouters();

      expect(notifier.state.routers, hasLength(2));
      expect(notifier.state.routers[0].name, 'Router 1');
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });

    test('loadRouters sets error on failure', () async {
      when(() => mockService.getRouters()).thenThrow(Exception('fail'));

      await notifier.loadRouters();

      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNotNull);
    });

    test('createRouter adds to list, stores guide, and returns true', () async {
      when(() => mockService.createRouter(name: 'New Router'))
          .thenAnswer((_) async => mockCreateResult);

      final result = await notifier.createRouter(name: 'New Router');

      expect(result, true);
      expect(notifier.state.routers, hasLength(1));
      expect(notifier.state.selectedRouter, isNotNull);
      expect(notifier.state.setupGuide, isNotNull);
      expect(notifier.state.setupGuide?.tunnelIp, '10.10.0.2');
      expect(notifier.state.setupGuide?.steps, hasLength(1));
      expect(notifier.state.isLoading, false);
    });

    test('createRouter returns false on failure', () async {
      when(() => mockService.createRouter(name: 'New Router'))
          .thenThrow(Exception('limit'));

      final result = await notifier.createRouter(name: 'New Router');

      expect(result, false);
      expect(notifier.state.error, isNotNull);
    });

    test('deleteRouter removes from list', () async {
      when(() => mockService.getRouters())
          .thenAnswer((_) async => [mockRouter, mockRouter2]);
      await notifier.loadRouters();

      when(() => mockService.deleteRouter('r-1'))
          .thenAnswer((_) async {});

      final result = await notifier.deleteRouter('r-1');

      expect(result, true);
      expect(notifier.state.routers, hasLength(1));
      expect(notifier.state.routers[0].id, 'r-2');
    });

    test('deleteRouter returns false on failure', () async {
      when(() => mockService.deleteRouter('r-1'))
          .thenThrow(Exception('not found'));

      final result = await notifier.deleteRouter('r-1');

      expect(result, false);
      expect(notifier.state.error, isNotNull);
    });

    test('loadRouter sets selectedRouter', () async {
      when(() => mockService.getRouter('r-1'))
          .thenAnswer((_) async => mockRouter);

      await notifier.loadRouter('r-1');

      expect(notifier.state.selectedRouter?.id, 'r-1');
      expect(notifier.state.isLoading, false);
    });

    test('clearSelection clears selected router and related state', () async {
      when(() => mockService.getRouter('r-1'))
          .thenAnswer((_) async => mockRouter);
      await notifier.loadRouter('r-1');

      notifier.clearSelection();

      expect(notifier.state.selectedRouter, isNull);
      expect(notifier.state.selectedRouterStatus, isNull);
      expect(notifier.state.setupGuide, isNull);
    });

    test('loadSetupGuide sets guide on success', () async {
      final guide = RouterSetupGuide(
        routerName: 'Router 1',
        setupGuide: '/interface wireguard add ...',
        tunnelIp: '10.10.0.2',
      );
      when(() => mockService.getSetupGuide('r-1'))
          .thenAnswer((_) async => guide);

      await notifier.loadSetupGuide('r-1');

      expect(notifier.state.setupGuide, isNotNull);
      expect(notifier.state.setupGuide?.routerName, 'Router 1');
      expect(notifier.state.isLoading, false);
    });
  });
}
