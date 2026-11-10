import 'api_client.dart';
import '../models/print_settings.dart';

/// Remote API service for operator print settings.
///
/// Mirrors [NotificationApiService]: uses the shared [ApiClient] Dio instance
/// (which already holds the JWT and handles 401 → refresh).
class PrintSettingsService {
  final ApiClient _api = ApiClient();

  /// GET /settings/print → [PrintSettings] (or defaults if the row is absent).
  Future<PrintSettings> fetch() async {
    final response = await _api.dio.get('/settings/print');
    final data = response.data['data'] as Map<String, dynamic>;
    return PrintSettings.fromJson(data);
  }

  /// PUT /settings/print → normalized [PrintSettings] from the server.
  Future<PrintSettings> update(PrintSettings settings) async {
    final response = await _api.dio.put(
      '/settings/print',
      data: settings.toJson(),
    );
    final data = response.data['data'] as Map<String, dynamic>;
    return PrintSettings.fromJson(data);
  }
}
