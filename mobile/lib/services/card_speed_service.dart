import 'package:dio/dio.dart';

import 'api_client.dart';
import '../models/card_speed_setting.dart';

/// Remote API service for the card speed-limit feature.
///
/// GET /settings/card-speed → [CardSpeedSetting] or null when the backend
/// does not yet support the endpoint (HTTP 404).
class CardSpeedService {
  final ApiClient _api = ApiClient();

  /// Returns null when the server answers 404 (backend without the feature).
  Future<CardSpeedSetting?> fetch() async {
    try {
      final response = await _api.dio.get('/settings/card-speed');
      final raw = response.data['data'];
      if (raw is! Map<String, dynamic>) {
        throw FormatException(
            'card-speed GET: expected data object, got ${raw.runtimeType}');
      }
      return CardSpeedSetting.fromJson(raw);
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) return null;
      rethrow;
    }
  }

  /// PUT /settings/card-speed → confirmed [CardSpeedSetting] from the server.
  Future<CardSpeedSetting> update({
    required bool enabled,
    required String speed,
  }) async {
    final response = await _api.dio.put(
      '/settings/card-speed',
      data: {'enabled': enabled, 'speed': speed},
    );
    final raw = response.data['data'];
    if (raw is! Map<String, dynamic>) {
      throw FormatException(
          'card-speed PUT: expected data object, got ${raw.runtimeType}');
    }
    return CardSpeedSetting.fromJson(raw);
  }
}
