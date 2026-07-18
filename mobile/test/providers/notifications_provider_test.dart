import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:wasel/models/app_notification.dart';
import 'package:wasel/providers/notifications_provider.dart';
import 'package:wasel/services/notifications_service.dart';

class MockNotificationsService extends Mock implements NotificationsService {}

AppNotification _mkNotif(String id) => AppNotification.fromJson({
      'id': id,
      'category': 'system',
      'title': 'Test $id',
      'body': 'Body $id',
      'data': null,
      'readAt': null,
      'createdAt': '2026-01-01T00:00:00.000Z',
    });

void main() {
  late MockNotificationsService mockService;
  late NotificationsNotifier notifier;

  setUp(() {
    mockService = MockNotificationsService();
    notifier = NotificationsNotifier(service: mockService);
  });

  group('NotificationsNotifier', () {
    test('initial state is correct', () {
      expect(notifier.state.items, isEmpty);
      expect(notifier.state.unreadCount, 0);
      expect(notifier.state.nextCursor, isNull);
      expect(notifier.state.hasMore, true); // starts optimistic
      expect(notifier.state.isLoading, false);
      expect(notifier.state.isLoadingMore, false);
      expect(notifier.state.error, isNull);
    });

    test('refresh sets items and nextCursor on success', () async {
      when(() => mockService.list(limit: 20)).thenAnswer(
        (_) async => NotificationsInboxPage(
          items: [_mkNotif('n-1'), _mkNotif('n-2')],
          total: 2,
          unreadCount: 1,
          page: 1,
          limit: 20,
          nextCursor: 'cursor-notif-1',
        ),
      );

      await notifier.refresh();

      expect(notifier.state.items, hasLength(2));
      expect(notifier.state.unreadCount, 1);
      expect(notifier.state.nextCursor, 'cursor-notif-1');
      expect(notifier.state.hasMore, true);
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });

    test('refresh stores null cursor when server has no more pages', () async {
      when(() => mockService.list(limit: 20)).thenAnswer(
        (_) async => NotificationsInboxPage(
          items: [_mkNotif('n-1')],
          total: 1,
          unreadCount: 0,
          page: 1,
          limit: 20,
          nextCursor: null,
        ),
      );

      await notifier.refresh();

      expect(notifier.state.nextCursor, isNull);
      expect(notifier.state.hasMore, false);
    });

    test('refresh sets error on failure', () async {
      when(() => mockService.list(limit: 20)).thenThrow(Exception('network'));

      await notifier.refresh();

      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNotNull);
    });

    test('loadMore sends cursor and appends results', () async {
      when(() => mockService.list(limit: 20)).thenAnswer(
        (_) async => NotificationsInboxPage(
          items: [_mkNotif('n-1')],
          total: 2,
          unreadCount: 1,
          page: 1,
          limit: 20,
          nextCursor: 'cursor-1',
        ),
      );
      await notifier.refresh();
      expect(notifier.state.hasMore, true);

      when(() => mockService.list(cursor: 'cursor-1', limit: 20)).thenAnswer(
        (_) async => NotificationsInboxPage(
          items: [_mkNotif('n-2')],
          total: 2,
          unreadCount: 0,
          page: 2,
          limit: 20,
          nextCursor: null,
        ),
      );
      await notifier.loadMore();

      expect(notifier.state.items, hasLength(2));
      expect(notifier.state.items[0].id, 'n-1');
      expect(notifier.state.items[1].id, 'n-2');
      expect(notifier.state.nextCursor, isNull);
      expect(notifier.state.hasMore, false);
    });

    test('loadMore deduplicates items already held', () async {
      when(() => mockService.list(limit: 20)).thenAnswer(
        (_) async => NotificationsInboxPage(
          items: [_mkNotif('n-1')],
          total: 2,
          unreadCount: 1,
          page: 1,
          limit: 20,
          nextCursor: 'cursor-1',
        ),
      );
      await notifier.refresh();

      // Server returns n-1 again in the cursor window
      when(() => mockService.list(cursor: 'cursor-1', limit: 20)).thenAnswer(
        (_) async => NotificationsInboxPage(
          items: [_mkNotif('n-1'), _mkNotif('n-2')],
          total: 2,
          unreadCount: 0,
          page: 2,
          limit: 20,
          nextCursor: null,
        ),
      );
      await notifier.loadMore();

      expect(notifier.state.items, hasLength(2));
      expect(
        notifier.state.items.map((n) => n.id).toSet(),
        {'n-1', 'n-2'},
      );
    });

    test('loadMore is a no-op when hasMore is false', () async {
      when(() => mockService.list(limit: 20)).thenAnswer(
        (_) async => NotificationsInboxPage(
          items: [_mkNotif('n-1')],
          total: 1,
          unreadCount: 0,
          page: 1,
          limit: 20,
          nextCursor: null, // terminal
        ),
      );
      await notifier.refresh();
      expect(notifier.state.hasMore, false);

      // Should not call service again
      await notifier.loadMore();

      expect(notifier.state.items, hasLength(1));
    });

    test('reset clears nextCursor and items', () async {
      when(() => mockService.list(limit: 20)).thenAnswer(
        (_) async => NotificationsInboxPage(
          items: [_mkNotif('n-1')],
          total: 1,
          unreadCount: 1,
          page: 1,
          limit: 20,
          nextCursor: 'cursor-xyz',
        ),
      );
      await notifier.refresh();
      expect(notifier.state.nextCursor, 'cursor-xyz');

      notifier.reset();

      expect(notifier.state.nextCursor, isNull);
      expect(notifier.state.items, isEmpty);
      expect(notifier.state.unreadCount, 0);
    });

    test('nextCursor threads through multiple loadMore calls', () async {
      when(() => mockService.list(limit: 20)).thenAnswer(
        (_) async => NotificationsInboxPage(
          items: [_mkNotif('n-1')],
          total: 3,
          unreadCount: 3,
          page: 1,
          limit: 20,
          nextCursor: 'cursor-p1',
        ),
      );
      await notifier.refresh();

      when(() => mockService.list(cursor: 'cursor-p1', limit: 20)).thenAnswer(
        (_) async => NotificationsInboxPage(
          items: [_mkNotif('n-2')],
          total: 3,
          unreadCount: 2,
          page: 2,
          limit: 20,
          nextCursor: 'cursor-p2',
        ),
      );
      await notifier.loadMore();
      expect(notifier.state.nextCursor, 'cursor-p2');
      expect(notifier.state.items, hasLength(2));

      when(() => mockService.list(cursor: 'cursor-p2', limit: 20)).thenAnswer(
        (_) async => NotificationsInboxPage(
          items: [_mkNotif('n-3')],
          total: 3,
          unreadCount: 1,
          page: 3,
          limit: 20,
          nextCursor: null,
        ),
      );
      await notifier.loadMore();
      expect(notifier.state.nextCursor, isNull);
      expect(notifier.state.hasMore, false);
      expect(notifier.state.items, hasLength(3));
    });
  });
}
