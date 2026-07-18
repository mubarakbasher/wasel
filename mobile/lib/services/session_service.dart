import '../models/session.dart';
import 'api_client.dart';

class SessionService {
  final ApiClient _api = ApiClient();

  Future<List<ActiveSession>> getActiveSessions(String routerId) async {
    final response = await _api.dio.get('/routers/$routerId/sessions');
    final data = response.data['data'] as List;
    return data
        .map((e) => ActiveSession.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> disconnectSession(String routerId, String sessionId) async {
    await _api.dio.delete('/routers/$routerId/sessions/$sessionId');
  }

  Future<SessionHistoryResult> getSessionHistory(
    String routerId, {
    String? username,
    int page = 1,
    int limit = 20,
    String? startDate,
    String? endDate,
    String? terminateCause,
    String? cursor,
  }) async {
    final queryParams = <String, dynamic>{'limit': limit};
    // Keyset pagination when cursor is available; fall back to offset.
    if (cursor != null) {
      queryParams['cursor'] = cursor;
    } else {
      queryParams['page'] = page;
    }
    if (username != null && username.isNotEmpty) {
      queryParams['username'] = username;
    }
    if (startDate != null) queryParams['startDate'] = startDate;
    if (endDate != null) queryParams['endDate'] = endDate;
    if (terminateCause != null) queryParams['terminateCause'] = terminateCause;

    final response = await _api.dio.get(
      '/routers/$routerId/sessions/history',
      queryParameters: queryParams,
    );
    final data = response.data['data'] as List;
    final meta = response.data['meta'] as Map<String, dynamic>?;
    return SessionHistoryResult(
      sessions: data
          .map((e) => SessionHistory.fromJson(e as Map<String, dynamic>))
          .toList(),
      total: meta?['total'] != null ? int.parse(meta!['total'].toString()) : data.length,
      page: meta?['page'] != null ? int.parse(meta!['page'].toString()) : page,
      limit: meta?['limit'] != null ? int.parse(meta!['limit'].toString()) : limit,
      nextCursor: meta?['nextCursor'] as String?,
    );
  }
}

class SessionHistoryResult {
  final List<SessionHistory> sessions;
  final int total;
  final int page;
  final int limit;

  /// Opaque keyset cursor from the backend. `null` means no more pages.
  final String? nextCursor;

  const SessionHistoryResult({
    required this.sessions,
    required this.total,
    required this.page,
    required this.limit,
    this.nextCursor,
  });
}
