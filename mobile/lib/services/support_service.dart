import '../models/support_message.dart';
import 'api_client.dart';

class SupportMessagesPage {
  final List<SupportMessage> items;
  final int total;
  final int unreadAdminCount;
  final int page;
  final int limit;

  /// Opaque keyset cursor from the backend. `null` means no more pages.
  final String? nextCursor;

  const SupportMessagesPage({
    required this.items,
    required this.total,
    required this.unreadAdminCount,
    required this.page,
    required this.limit,
    this.nextCursor,
  });

  /// Prefer cursor signal when available; fall back to offset maths.
  bool get hasMore => nextCursor != null || page * limit < total;
}

class SupportService {
  final ApiClient _api = ApiClient();

  Future<SupportMessagesPage> list({
    int page = 1,
    int limit = 30,
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
      '/support/messages',
      queryParameters: queryParams,
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
      nextCursor: meta['nextCursor'] as String?,
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
