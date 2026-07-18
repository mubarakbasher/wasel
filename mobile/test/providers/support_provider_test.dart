import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:wasel/models/support_message.dart';
import 'package:wasel/providers/support_provider.dart';
import 'package:wasel/services/support_service.dart';

class MockSupportService extends Mock implements SupportService {}

SupportMessage _mkMsg(String id, {String sender = 'admin'}) =>
    SupportMessage.fromJson({
      'id': id,
      'sender': sender,
      'body': 'Message $id',
      'readAt': null,
      'createdAt': '2026-01-01T00:00:00.000Z',
    });

void main() {
  late MockSupportService mockService;
  late SupportNotifier notifier;

  setUp(() {
    mockService = MockSupportService();
    notifier = SupportNotifier(service: mockService);
  });

  group('SupportNotifier', () {
    test('initial state is correct', () {
      expect(notifier.state.messages, isEmpty);
      expect(notifier.state.unreadAdminCount, 0);
      expect(notifier.state.nextCursor, isNull);
      expect(notifier.state.hasMore, true); // starts optimistic
      expect(notifier.state.isLoading, false);
      expect(notifier.state.isLoadingMore, false);
      expect(notifier.state.isSending, false);
      expect(notifier.state.error, isNull);
    });

    test('refresh sets messages and nextCursor on success', () async {
      when(() => mockService.list(limit: 30)).thenAnswer(
        (_) async => SupportMessagesPage(
          items: [_mkMsg('m-1'), _mkMsg('m-2', sender: 'user')],
          total: 2,
          unreadAdminCount: 1,
          page: 1,
          limit: 30,
          nextCursor: 'cursor-sup-1',
        ),
      );

      await notifier.refresh();

      expect(notifier.state.messages, hasLength(2));
      expect(notifier.state.unreadAdminCount, 1);
      expect(notifier.state.nextCursor, 'cursor-sup-1');
      expect(notifier.state.hasMore, true);
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });

    test('refresh stores null cursor when server has no more pages', () async {
      when(() => mockService.list(limit: 30)).thenAnswer(
        (_) async => SupportMessagesPage(
          items: [_mkMsg('m-1')],
          total: 1,
          unreadAdminCount: 0,
          page: 1,
          limit: 30,
          nextCursor: null,
        ),
      );

      await notifier.refresh();

      expect(notifier.state.nextCursor, isNull);
      expect(notifier.state.hasMore, false);
    });

    test('refresh sets error on failure', () async {
      when(() => mockService.list(limit: 30)).thenThrow(Exception('network'));

      await notifier.refresh();

      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNotNull);
    });

    test('loadMore sends cursor and appends results', () async {
      when(() => mockService.list(limit: 30)).thenAnswer(
        (_) async => SupportMessagesPage(
          items: [_mkMsg('m-1')],
          total: 2,
          unreadAdminCount: 1,
          page: 1,
          limit: 30,
          nextCursor: 'cursor-1',
        ),
      );
      await notifier.refresh();
      expect(notifier.state.hasMore, true);

      when(() => mockService.list(cursor: 'cursor-1', limit: 30)).thenAnswer(
        (_) async => SupportMessagesPage(
          items: [_mkMsg('m-2')],
          total: 2,
          unreadAdminCount: 0,
          page: 2,
          limit: 30,
          nextCursor: null,
        ),
      );
      await notifier.loadMore();

      expect(notifier.state.messages, hasLength(2));
      expect(notifier.state.messages[0].id, 'm-1');
      expect(notifier.state.messages[1].id, 'm-2');
      expect(notifier.state.nextCursor, isNull);
      expect(notifier.state.hasMore, false);
    });

    test('loadMore deduplicates items already held', () async {
      when(() => mockService.list(limit: 30)).thenAnswer(
        (_) async => SupportMessagesPage(
          items: [_mkMsg('m-1')],
          total: 2,
          unreadAdminCount: 1,
          page: 1,
          limit: 30,
          nextCursor: 'cursor-1',
        ),
      );
      await notifier.refresh();

      // Server returns m-1 again (cursor window overlap)
      when(() => mockService.list(cursor: 'cursor-1', limit: 30)).thenAnswer(
        (_) async => SupportMessagesPage(
          items: [_mkMsg('m-1'), _mkMsg('m-2')],
          total: 2,
          unreadAdminCount: 0,
          page: 2,
          limit: 30,
          nextCursor: null,
        ),
      );
      await notifier.loadMore();

      expect(notifier.state.messages, hasLength(2));
      expect(
        notifier.state.messages.map((m) => m.id).toSet(),
        {'m-1', 'm-2'},
      );
    });

    test('loadMore is a no-op when hasMore is false', () async {
      when(() => mockService.list(limit: 30)).thenAnswer(
        (_) async => SupportMessagesPage(
          items: [_mkMsg('m-1')],
          total: 1,
          unreadAdminCount: 0,
          page: 1,
          limit: 30,
          nextCursor: null, // terminal
        ),
      );
      await notifier.refresh();
      expect(notifier.state.hasMore, false);

      await notifier.loadMore();

      expect(notifier.state.messages, hasLength(1));
    });

    test('reset clears nextCursor and messages', () async {
      when(() => mockService.list(limit: 30)).thenAnswer(
        (_) async => SupportMessagesPage(
          items: [_mkMsg('m-1')],
          total: 1,
          unreadAdminCount: 1,
          page: 1,
          limit: 30,
          nextCursor: 'cursor-xyz',
        ),
      );
      await notifier.refresh();
      expect(notifier.state.nextCursor, 'cursor-xyz');

      notifier.reset();

      expect(notifier.state.nextCursor, isNull);
      expect(notifier.state.messages, isEmpty);
    });

    test('nextCursor threads through multiple loadMore calls', () async {
      when(() => mockService.list(limit: 30)).thenAnswer(
        (_) async => SupportMessagesPage(
          items: [_mkMsg('m-1')],
          total: 3,
          unreadAdminCount: 3,
          page: 1,
          limit: 30,
          nextCursor: 'cursor-p1',
        ),
      );
      await notifier.refresh();

      when(() => mockService.list(cursor: 'cursor-p1', limit: 30)).thenAnswer(
        (_) async => SupportMessagesPage(
          items: [_mkMsg('m-2')],
          total: 3,
          unreadAdminCount: 2,
          page: 2,
          limit: 30,
          nextCursor: 'cursor-p2',
        ),
      );
      await notifier.loadMore();
      expect(notifier.state.nextCursor, 'cursor-p2');
      expect(notifier.state.messages, hasLength(2));

      when(() => mockService.list(cursor: 'cursor-p2', limit: 30)).thenAnswer(
        (_) async => SupportMessagesPage(
          items: [_mkMsg('m-3')],
          total: 3,
          unreadAdminCount: 1,
          page: 3,
          limit: 30,
          nextCursor: null,
        ),
      );
      await notifier.loadMore();
      expect(notifier.state.nextCursor, isNull);
      expect(notifier.state.hasMore, false);
      expect(notifier.state.messages, hasLength(3));
    });

    test('send prepends new message and does not affect cursor', () async {
      when(() => mockService.list(limit: 30)).thenAnswer(
        (_) async => SupportMessagesPage(
          items: [_mkMsg('m-1')],
          total: 1,
          unreadAdminCount: 0,
          page: 1,
          limit: 30,
          nextCursor: 'cursor-1',
        ),
      );
      await notifier.refresh();
      expect(notifier.state.nextCursor, 'cursor-1');

      final newMsg = _mkMsg('m-new', sender: 'user');
      when(() => mockService.send('hello')).thenAnswer((_) async => newMsg);

      await notifier.send('hello');

      // Cursor unchanged, new message prepended
      expect(notifier.state.messages[0].id, 'm-new');
      expect(notifier.state.nextCursor, 'cursor-1');
    });
  });
}
