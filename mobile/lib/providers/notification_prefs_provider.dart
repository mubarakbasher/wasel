import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/notification_preference.dart';
import '../services/notification_service.dart';
import '../utils/error_messages.dart';

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
    // Capture the pre-toggle list so a failed save reverts deterministically
    // without depending on a reload that may itself fail.
    final previous = state.preferences;
    final updated = state.preferences.map((p) {
      return p.category == category ? p.copyWith(enabled: enabled) : p;
    }).toList();
    state = state.copyWith(preferences: updated, clearError: true);
    try {
      await _service.updatePreferences([NotificationPreference(category: category, enabled: enabled)]);
    } catch (e) {
      // Revert to the captured state and surface the failure so the user knows
      // the change did not save.
      state = state.copyWith(preferences: previous, error: _extractError(e));
    }
  }

  void reset() {
    state = const NotificationPrefsState();
  }

  String _extractError(dynamic e) => errorToDisplay(e);
}

final notificationPrefsProvider = StateNotifierProvider<NotificationPrefsNotifier, NotificationPrefsState>(
  (ref) => NotificationPrefsNotifier(),
);
