import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/router_health.dart';
import '../services/api_client.dart';

class RouterHealthNotifier
    extends FamilyAsyncNotifier<RouterHealthReport, String> {
  @override
  Future<RouterHealthReport> build(String arg) async {
    return _fetch(refresh: false);
  }

  Future<void> rerun() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() => _fetch(refresh: true));
  }

  Future<RouterHealthReport> _fetch({required bool refresh}) async {
    final routerId = arg;
    try {
      final response = await ApiClient().get<Map<String, dynamic>>(
        '/routers/$routerId/health',
        queryParameters: refresh ? {'refresh': 'true'} : null,
      );
      final data = response.data;
      if (data == null) {
        throw Exception('Empty response from health endpoint');
      }
      return RouterHealthReport.fromJson(data);
    } on DioException catch (e) {
      throw _extractError(e);
    }
  }

  String _extractError(DioException e) {
    final data = e.response?.data;
    if (data is Map<String, dynamic>) {
      final error = data['error'];
      if (error is Map<String, dynamic> && error.containsKey('message')) {
        return error['message'] as String;
      }
      if (data.containsKey('message')) {
        return data['message'] as String;
      }
    }
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout) {
      return 'Connection timed out. Please try again.';
    }
    if (e.type == DioExceptionType.connectionError) {
      return 'No internet connection.';
    }
    return e.message ?? e.toString();
  }
}

final routerHealthProvider =
    AsyncNotifierProvider.family<RouterHealthNotifier, RouterHealthReport, String>(
  RouterHealthNotifier.new,
);
