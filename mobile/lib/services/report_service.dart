import 'api_client.dart';

class ReportService {
  final ApiClient _api = ApiClient();

  Future<Map<String, dynamic>> getReport({
    required String type,
    required String startDate,
    required String endDate,
    String? routerId,
  }) async {
    final queryParams = <String, String>{
      'type': type,
      'startDate': startDate,
      'endDate': endDate,
      if (routerId != null) 'routerId': routerId,
    };
    final response =
        await _api.dio.get('/reports', queryParameters: queryParams);
    return response.data['data'] as Map<String, dynamic>;
  }

  Future<String> exportReport({
    required String type,
    required String startDate,
    required String endDate,
    String? routerId,
    String format = 'csv',
  }) async {
    final queryParams = <String, String>{
      'type': type,
      'startDate': startDate,
      'endDate': endDate,
      'format': format,
      if (routerId != null) 'routerId': routerId,
    };
    final response =
        await _api.dio.get('/reports/export', queryParameters: queryParams);
    if (format == 'csv') {
      return response.data as String;
    }
    return response.data['data']['url'] as String;
  }
}
