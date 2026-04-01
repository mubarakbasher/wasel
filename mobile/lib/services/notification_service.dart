import 'api_client.dart';
import '../models/notification_preference.dart';

class NotificationApiService {
  final ApiClient _api = ApiClient();

  Future<List<NotificationPreference>> getPreferences() async {
    final response = await _api.dio.get('/notifications/preferences');
    final list = response.data['data'] as List;
    return list.map((e) => NotificationPreference.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> updatePreferences(List<NotificationPreference> prefs) async {
    await _api.dio.put('/notifications/preferences', data: {
      'preferences': prefs.map((p) => p.toJson()).toList(),
    });
  }
}
