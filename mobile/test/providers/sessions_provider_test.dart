import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:wasel/models/session.dart';
import 'package:wasel/providers/sessions_provider.dart';
import 'package:wasel/services/session_service.dart';

class MockSessionService extends Mock implements SessionService {}

void main() {
  late MockSessionService mockService;
  late SessionsNotifier notifier;

  final mockSession = ActiveSession.fromJson({
    'id': '*1A',
    'username': 'voucher-user',
    'address': '192.168.1.100',
    'macAddress': 'AA:BB:CC:DD:EE:FF',
    'uptime': '01:30:00',
    'bytesIn': 10485760,
    'bytesOut': 52428800,
  });

  final mockSession2 = ActiveSession.fromJson({
    'id': '*2B',
    'username': 'voucher-user2',
    'address': '192.168.1.101',
    'bytesIn': 0,
    'bytesOut': 0,
  });

  setUp(() {
    mockService = MockSessionService();
    notifier = SessionsNotifier(sessionService: mockService);
  });

  group('SessionsNotifier', () {
    test('initial state is correct', () {
      expect(notifier.state.activeSessions, isEmpty);
      expect(notifier.state.historySessions, isEmpty);
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
      expect(notifier.state.historyTotal, 0);
      expect(notifier.state.hasMoreHistory, false);
    });

    test('loadActiveSessions sets sessions on success', () async {
      when(() => mockService.getActiveSessions('r-1'))
          .thenAnswer((_) async => [mockSession, mockSession2]);

      await notifier.loadActiveSessions('r-1');

      expect(notifier.state.activeSessions, hasLength(2));
      expect(notifier.state.activeSessions[0].username, 'voucher-user');
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });

    test('loadActiveSessions sets error on failure', () async {
      when(() => mockService.getActiveSessions('r-1'))
          .thenThrow(Exception('offline'));

      await notifier.loadActiveSessions('r-1');

      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNotNull);
    });

    test('disconnectSession removes from list', () async {
      when(() => mockService.getActiveSessions('r-1'))
          .thenAnswer((_) async => [mockSession, mockSession2]);
      await notifier.loadActiveSessions('r-1');

      when(() => mockService.disconnectSession('r-1', '*1A'))
          .thenAnswer((_) async {});

      final result = await notifier.disconnectSession('r-1', '*1A');

      expect(result, true);
      expect(notifier.state.activeSessions, hasLength(1));
      expect(notifier.state.activeSessions[0].id, '*2B');
    });

    test('disconnectSession returns false on failure', () async {
      when(() => mockService.disconnectSession('r-1', '*1A'))
          .thenThrow(Exception('fail'));

      final result = await notifier.disconnectSession('r-1', '*1A');

      expect(result, false);
      expect(notifier.state.error, isNotNull);
    });

    test('loadSessionHistory sets history on success', () async {
      final mockHistory = SessionHistory.fromJson({
        'id': 1,
        'username': 'user1',
        'startTime': '2026-03-01T10:00:00.000Z',
        'stopTime': '2026-03-01T11:00:00.000Z',
        'sessionTime': 3600,
      });
      when(() => mockService.getSessionHistory(
            'r-1',
            username: null,
            page: 1,
            limit: 20,
            terminateCause: null,
          )).thenAnswer((_) async => SessionHistoryResult(
            sessions: [mockHistory],
            total: 1,
            page: 1,
            limit: 20,
          ));

      await notifier.loadSessionHistory('r-1');

      expect(notifier.state.historySessions, hasLength(1));
      expect(notifier.state.historyTotal, 1);
      expect(notifier.state.isLoading, false);
    });

    test('setUsernameFilter and setTerminateCauseFilter update state', () {
      notifier.setUsernameFilter('test');
      expect(notifier.state.filterUsername, 'test');

      notifier.setTerminateCauseFilter('User-Request');
      expect(notifier.state.filterTerminateCause, 'User-Request');

      notifier.setUsernameFilter(null);
      expect(notifier.state.filterUsername, isNull);

      notifier.setTerminateCauseFilter(null);
      expect(notifier.state.filterTerminateCause, isNull);
    });

    test('loadMoreHistory appends to existing sessions', () async {
      final history1 = SessionHistory.fromJson({
        'id': 1,
        'username': 'user1',
        'startTime': '2026-03-01T10:00:00.000Z',
        'sessionTime': 3600,
      });
      final history2 = SessionHistory.fromJson({
        'id': 2,
        'username': 'user2',
        'startTime': '2026-03-01T12:00:00.000Z',
        'sessionTime': 1800,
      });

      // Initial load
      when(() => mockService.getSessionHistory(
            'r-1',
            username: null,
            page: 1,
            limit: 20,
            terminateCause: null,
          )).thenAnswer((_) async => SessionHistoryResult(
            sessions: [history1],
            total: 2,
            page: 1,
            limit: 20,
          ));
      await notifier.loadSessionHistory('r-1');
      expect(notifier.state.hasMoreHistory, true);

      // Load more
      when(() => mockService.getSessionHistory(
            'r-1',
            username: null,
            page: 2,
            limit: 20,
            terminateCause: null,
          )).thenAnswer((_) async => SessionHistoryResult(
            sessions: [history2],
            total: 2,
            page: 2,
            limit: 20,
          ));
      await notifier.loadMoreHistory('r-1');

      expect(notifier.state.historySessions, hasLength(2));
      expect(notifier.state.historyPage, 2);
    });
  });
}
