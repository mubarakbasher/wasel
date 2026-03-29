import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/radius_profile.dart';
import '../services/profile_service.dart';

class ProfilesState {
  final List<RadiusProfile> profiles;
  final RadiusProfile? selectedProfile;
  final bool isLoading;
  final String? error;

  const ProfilesState({
    this.profiles = const [],
    this.selectedProfile,
    this.isLoading = false,
    this.error,
  });

  ProfilesState copyWith({
    List<RadiusProfile>? profiles,
    RadiusProfile? selectedProfile,
    bool? isLoading,
    String? error,
    bool clearError = false,
    bool clearSelected = false,
  }) {
    return ProfilesState(
      profiles: profiles ?? this.profiles,
      selectedProfile:
          clearSelected ? null : (selectedProfile ?? this.selectedProfile),
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class ProfilesNotifier extends StateNotifier<ProfilesState> {
  final ProfileService _service;

  ProfilesNotifier({ProfileService? profileService})
      : _service = profileService ?? ProfileService(),
        super(const ProfilesState());

  void clearError() {
    state = state.copyWith(clearError: true);
  }

  Future<void> loadProfiles() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final profiles = await _service.getProfiles();
      state = state.copyWith(profiles: profiles, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<void> loadProfile(String id) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final profile = await _service.getProfile(id);
      state = state.copyWith(selectedProfile: profile, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<bool> createProfile({
    required String groupName,
    required String displayName,
    String? bandwidthUp,
    String? bandwidthDown,
    int? sessionTimeout,
    int? totalTime,
    int? totalData,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final profile = await _service.createProfile(
        groupName: groupName,
        displayName: displayName,
        bandwidthUp: bandwidthUp,
        bandwidthDown: bandwidthDown,
        sessionTimeout: sessionTimeout,
        totalTime: totalTime,
        totalData: totalData,
      );
      state = state.copyWith(
        profiles: [profile, ...state.profiles],
        selectedProfile: profile,
        isLoading: false,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  Future<bool> updateProfile(
    String id, {
    String? displayName,
    String? bandwidthUp,
    String? bandwidthDown,
    int? sessionTimeout,
    int? totalTime,
    int? totalData,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final updated = await _service.updateProfile(
        id,
        displayName: displayName,
        bandwidthUp: bandwidthUp,
        bandwidthDown: bandwidthDown,
        sessionTimeout: sessionTimeout,
        totalTime: totalTime,
        totalData: totalData,
      );
      final updatedList = state.profiles.map((p) {
        return p.id == id ? updated : p;
      }).toList();
      state = state.copyWith(
        profiles: updatedList,
        selectedProfile: updated,
        isLoading: false,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  Future<bool> deleteProfile(String id) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      await _service.deleteProfile(id);
      final updatedList = state.profiles.where((p) => p.id != id).toList();
      state = state.copyWith(
        profiles: updatedList,
        isLoading: false,
        clearSelected: state.selectedProfile?.id == id,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  void clearSelection() {
    state = state.copyWith(clearSelected: true);
  }

  String _extractError(dynamic e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map<String, dynamic> && data.containsKey('error')) {
        final error = data['error'];
        if (error is Map<String, dynamic> && error.containsKey('message')) {
          return error['message'] as String;
        }
      }
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.receiveTimeout) {
        return 'Connection timed out. Please try again.';
      }
      return 'Network error. Please check your connection.';
    }
    return e.toString();
  }
}

final profilesProvider =
    StateNotifierProvider<ProfilesNotifier, ProfilesState>(
  (ref) => ProfilesNotifier(),
);
