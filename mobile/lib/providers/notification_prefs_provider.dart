import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/notification_preference.dart';
import '../services/notification_service.dart';

class NotificationPrefsState {
  final List<NotificationPreference> preferences;
  final bool isLoading;
  final String? error;

  const NotificationPrefsState({
    this.preferences = const [],
    this.isLoading = false,
    this.error,
  });

  NotificationPrefsState copyWith({
    List<NotificationPreference>? preferences,
    bool? isLoading,
    String? error,
    bool clearError = false,
  }) {
    return NotificationPrefsState(
      preferences: preferences ?? this.preferences,
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class NotificationPrefsNotifier extends StateNotifier<NotificationPrefsState> {
  final NotificationApiService _service;

  NotificationPrefsNotifier({NotificationApiService? service})
      : _service = service ?? NotificationApiService(),
        super(const NotificationPrefsState());

  Future<void> loadPreferences() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final prefs = await _service.getPreferences();
      state = state.copyWith(preferences: prefs, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<void> togglePreference(String category, bool enabled) async {
    final updated = state.preferences.map((p) {
      return p.category == category ? p.copyWith(enabled: enabled) : p;
    }).toList();
    state = state.copyWith(preferences: updated);
    try {
      await _service.updatePreferences([NotificationPreference(category: category, enabled: enabled)]);
    } catch (e) {
      // Revert on failure
      await loadPreferences();
    }
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
      if (e.type == DioExceptionType.connectionTimeout || e.type == DioExceptionType.receiveTimeout) {
        return 'Connection timed out. Please try again.';
      }
      return 'Network error. Please check your connection.';
    }
    return e.toString();
  }
}

final notificationPrefsProvider = StateNotifierProvider<NotificationPrefsNotifier, NotificationPrefsState>(
  (ref) => NotificationPrefsNotifier(),
);
