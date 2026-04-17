import '../models/support_message.dart';
import 'api_client.dart';

class SupportMessagesPage {
  final List<SupportMessage> items;
  final int total;
  final int unreadAdminCount;
  final int page;
  final int limit;

  const SupportMessagesPage({
    required this.items,
    required this.total,
    required this.unreadAdminCount,
    required this.page,
    required this.limit,
  });

  bool get hasMore => page * limit < total;
}

class SupportService {
  final ApiClient _api = ApiClient();

  Future<SupportMessagesPage> list({int page = 1, int limit = 30}) async {
    final response = await _api.get<Map<String, dynamic>>(
      '/support/messages',
      queryParameters: {'page': page, 'limit': limit},
    );
    final body = response.data!;
    final items = (body['data'] as List)
        .map((e) => SupportMessage.fromJson(e as Map<String, dynamic>))
        .toList();
    final meta = body['meta'] as Map<String, dynamic>;
    return SupportMessagesPage(
      items: items,
      total: (meta['total'] as num).toInt(),
      unreadAdminCount: (meta['unreadAdminCount'] as num).toInt(),
      page: (meta['page'] as num).toInt(),
      limit: (meta['limit'] as num).toInt(),
    );
  }

  Future<SupportMessage> send(String body) async {
    final response = await _api.post<Map<String, dynamic>>(
      '/support/messages',
      data: {'body': body},
    );
    return SupportMessage.fromJson(
      response.data!['data'] as Map<String, dynamic>,
    );
  }

  Future<void> markAllRead() async {
    await _api.post('/support/messages/read-all');
  }
}
