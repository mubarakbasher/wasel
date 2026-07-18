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
      expect(notifier.state.historyNextCursor, isNull);
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

    test('loadSessionHistory sets history and nextCursor on success', () async {
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
            limit: 20,
            terminateCause: null,
          )).thenAnswer((_) async => SessionHistoryResult(
            sessions: [mockHistory],
            total: 1,
            page: 1,
            limit: 20,
            nextCursor: 'cursor-hist-1',
          ));

      await notifier.loadSessionHistory('r-1');

      expect(notifier.state.historySessions, hasLength(1));
      expect(notifier.state.historyTotal, 1);
      expect(notifier.state.historyNextCursor, 'cursor-hist-1');
      expect(notifier.state.hasMoreHistory, true);
      expect(notifier.state.isLoading, false);
    });

    test('loadSessionHistory stores null cursor when no more pages', () async {
      when(() => mockService.getSessionHistory(
            'r-1',
            username: null,
            limit: 20,
            terminateCause: null,
          )).thenAnswer((_) async => SessionHistoryResult(
            sessions: [],
            total: 0,
            page: 1,
            limit: 20,
            nextCursor: null,
          ));

      await notifier.loadSessionHistory('r-1');

      expect(notifier.state.historyNextCursor, isNull);
      expect(notifier.state.hasMoreHistory, false);
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

    test('loadMoreHistory sends cursor and appends results', () async {
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

      // Initial load returns cursor-1
      when(() => mockService.getSessionHistory(
            'r-1',
            username: null,
            limit: 20,
            terminateCause: null,
          )).thenAnswer((_) async => SessionHistoryResult(
            sessions: [history1],
            total: 2,
            page: 1,
            limit: 20,
            nextCursor: 'cursor-1',
          ));
      await notifier.loadSessionHistory('r-1');
      expect(notifier.state.hasMoreHistory, true);
      expect(notifier.state.historyNextCursor, 'cursor-1');

      // loadMoreHistory sends cursor-1, returns no cursor (last page)
      when(() => mockService.getSessionHistory(
            'r-1',
            username: null,
            cursor: 'cursor-1',
            limit: 20,
            terminateCause: null,
          )).thenAnswer((_) async => SessionHistoryResult(
            sessions: [history2],
            total: 2,
            page: 2,
            limit: 20,
            nextCursor: null,
          ));
      await notifier.loadMoreHistory('r-1');

      expect(notifier.state.historySessions, hasLength(2));
      expect(notifier.state.historyPage, 2);
      expect(notifier.state.historyNextCursor, isNull);
      expect(notifier.state.hasMoreHistory, false);
    });

    test('loadMoreHistory deduplicates items already held', () async {
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

      when(() => mockService.getSessionHistory(
            'r-1',
            username: null,
            limit: 20,
            terminateCause: null,
          )).thenAnswer((_) async => SessionHistoryResult(
            sessions: [history1],
            total: 2,
            page: 1,
            limit: 20,
            nextCursor: 'cursor-1',
          ));
      await notifier.loadSessionHistory('r-1');

      // Server returns history1 again in the cursor window (overlap)
      when(() => mockService.getSessionHistory(
            'r-1',
            username: null,
            cursor: 'cursor-1',
            limit: 20,
            terminateCause: null,
          )).thenAnswer((_) async => SessionHistoryResult(
            sessions: [history1, history2], // id=1 is a duplicate
            total: 2,
            page: 2,
            limit: 20,
            nextCursor: null,
          ));
      await notifier.loadMoreHistory('r-1');

      expect(notifier.state.historySessions, hasLength(2));
      expect(
        notifier.state.historySessions.map((s) => s.id).toSet(),
        {history1.id, history2.id},
      );
    });

    test('loadMoreHistory is a no-op when nextCursor is null', () async {
      when(() => mockService.getSessionHistory(
            'r-1',
            username: null,
            limit: 20,
            terminateCause: null,
          )).thenAnswer((_) async => SessionHistoryResult(
            sessions: [
              SessionHistory.fromJson({
                'id': 1,
                'username': 'u',
                'startTime': '2026-03-01T10:00:00.000Z',
                'sessionTime': 60,
              }),
            ],
            total: 1,
            page: 1,
            limit: 20,
            nextCursor: null, // terminal
          ));
      await notifier.loadSessionHistory('r-1');
      expect(notifier.state.hasMoreHistory, false);

      // Second call must not invoke service
      await notifier.loadMoreHistory('r-1');

      expect(notifier.state.historySessions, hasLength(1));
    });

    test('reset clears historyNextCursor', () async {
      when(() => mockService.getSessionHistory(
            'r-1',
            username: null,
            limit: 20,
            terminateCause: null,
          )).thenAnswer((_) async => SessionHistoryResult(
            sessions: [],
            total: 0,
            page: 1,
            limit: 20,
            nextCursor: 'cursor-xyz',
          ));
      await notifier.loadSessionHistory('r-1');
      expect(notifier.state.historyNextCursor, 'cursor-xyz');

      notifier.reset();

      expect(notifier.state.historyNextCursor, isNull);
      expect(notifier.state.historySessions, isEmpty);
    });
  });
}
