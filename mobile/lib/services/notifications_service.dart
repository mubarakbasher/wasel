import '../models/app_notification.dart';
import 'api_client.dart';

class NotificationsInboxPage {
  final List<AppNotification> items;
  final int total;
  final int unreadCount;
  final int page;
  final int limit;

  /// Opaque keyset cursor from the backend. `null` means no more pages.
  final String? nextCursor;

  const NotificationsInboxPage({
    required this.items,
    required this.total,
    required this.unreadCount,
    required this.page,
    required this.limit,
    this.nextCursor,
  });

  /// Prefer cursor signal when available; fall back to offset maths.
  bool get hasMore => nextCursor != null || page * limit < total;
}

class NotificationsService {
  final ApiClient _api = ApiClient();

  Future<NotificationsInboxPage> list({
    int page = 1,
    int limit = 20,
    String? cursor,
  }) async {
    final queryParams = <String, dynamic>{'limit': limit};
    // Keyset pagination when cursor is available; fall back to offset.
    if (cursor != null) {
      queryParams['cursor'] = cursor;
    } else {
      queryParams['page'] = page;
    }
    final response = await _api.get<Map<String, dynamic>>(
      '/notifications/',
      queryParameters: queryParams,
    );
    final body = response.data;
    if (body == null) {
      throw StateError('Empty notifications response');
    }
    final rawData = body['data'];
    if (rawData is! List) {
      throw StateError(
          'Unexpected notifications response shape (data is ${rawData.runtimeType}): $body');
    }
    final items = rawData
        .map((e) => AppNotification.fromJson(e as Map<String, dynamic>))
        .toList();
    final meta = (body['meta'] as Map<String, dynamic>?) ?? const {};
    return NotificationsInboxPage(
      items: items,
      total: (meta['total'] as num?)?.toInt() ?? items.length,
      unreadCount: (meta['unreadCount'] as num?)?.toInt() ?? 0,
      page: (meta['page'] as num?)?.toInt() ?? page,
      limit: (meta['limit'] as num?)?.toInt() ?? limit,
      nextCursor: meta['nextCursor'] as String?,
    );
  }

  Future<int> markRead(String id) async {
    final response = await _api.post('/notifications/$id/read');
    return (response.data['data']['unreadCount'] as num).toInt();
  }

  Future<int> markAllRead() async {
    final response = await _api.post('/notifications/read-all');
    return (response.data['data']['unreadCount'] as num).toInt();
  }

  Future<int> delete(String id) async {
    final response = await _api.delete('/notifications/$id');
    return (response.data['data']['unreadCount'] as num).toInt();
  }
}
