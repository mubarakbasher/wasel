import '../models/app_notification.dart';
import 'api_client.dart';

class NotificationsInboxPage {
  final List<AppNotification> items;
  final int total;
  final int unreadCount;
  final int page;
  final int limit;

  const NotificationsInboxPage({
    required this.items,
    required this.total,
    required this.unreadCount,
    required this.page,
    required this.limit,
  });

  bool get hasMore => page * limit < total;
}

class NotificationsService {
  final ApiClient _api = ApiClient();

  Future<NotificationsInboxPage> list({int page = 1, int limit = 20}) async {
    final response = await _api.get(
      '/notifications',
      queryParameters: {'page': page, 'limit': limit},
    );
    final data = response.data as Map<String, dynamic>;
    final items = (data['data'] as List<dynamic>)
        .map((e) => AppNotification.fromJson(e as Map<String, dynamic>))
        .toList();
    final meta = data['meta'] as Map<String, dynamic>;
    return NotificationsInboxPage(
      items: items,
      total: meta['total'] as int,
      unreadCount: meta['unreadCount'] as int,
      page: meta['page'] as int,
      limit: meta['limit'] as int,
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
