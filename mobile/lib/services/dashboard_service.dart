import 'api_client.dart';

class DashboardService {
  final ApiClient _api = ApiClient();

  Future<Map<String, dynamic>> getDashboard() async {
    final response = await _api.dio.get('/dashboard');
    return response.data['data'] as Map<String, dynamic>;
  }
}
