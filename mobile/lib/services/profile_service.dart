import '../models/radius_profile.dart';
import 'api_client.dart';

class ProfileService {
  final ApiClient _api = ApiClient();

  Future<List<RadiusProfile>> getProfiles() async {
    final response = await _api.dio.get('/profiles');
    final data = response.data['data'] as List;
    return data
        .map((e) => RadiusProfile.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<RadiusProfile> getProfile(String id) async {
    final response = await _api.dio.get('/profiles/$id');
    return RadiusProfile.fromJson(
        response.data['data'] as Map<String, dynamic>);
  }

  Future<RadiusProfile> createProfile({
    required String groupName,
    required String displayName,
    String? bandwidthUp,
    String? bandwidthDown,
    int? sessionTimeout,
    int? totalTime,
    int? totalData,
  }) async {
    final body = <String, dynamic>{
      'groupName': groupName,
      'displayName': displayName,
    };
    if (bandwidthUp != null && bandwidthUp.isNotEmpty) {
      body['bandwidthUp'] = bandwidthUp;
    }
    if (bandwidthDown != null && bandwidthDown.isNotEmpty) {
      body['bandwidthDown'] = bandwidthDown;
    }
    if (sessionTimeout != null && sessionTimeout > 0) {
      body['sessionTimeout'] = sessionTimeout;
    }
    if (totalTime != null && totalTime > 0) {
      body['totalTime'] = totalTime;
    }
    if (totalData != null && totalData > 0) {
      body['totalData'] = totalData;
    }

    final response = await _api.dio.post('/profiles', data: body);
    return RadiusProfile.fromJson(
        response.data['data'] as Map<String, dynamic>);
  }

  Future<RadiusProfile> updateProfile(
    String id, {
    String? displayName,
    String? bandwidthUp,
    String? bandwidthDown,
    int? sessionTimeout,
    int? totalTime,
    int? totalData,
  }) async {
    final body = <String, dynamic>{};
    if (displayName != null) body['displayName'] = displayName;
    if (bandwidthUp != null) body['bandwidthUp'] = bandwidthUp;
    if (bandwidthDown != null) body['bandwidthDown'] = bandwidthDown;
    if (sessionTimeout != null) body['sessionTimeout'] = sessionTimeout;
    if (totalTime != null) body['totalTime'] = totalTime;
    if (totalData != null) body['totalData'] = totalData;

    final response = await _api.dio.put('/profiles/$id', data: body);
    return RadiusProfile.fromJson(
        response.data['data'] as Map<String, dynamic>);
  }

  Future<void> deleteProfile(String id) async {
    await _api.dio.delete('/profiles/$id');
  }
}
