import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/user.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/push_notification_service.dart';
import '../services/secure_storage.dart';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

class AuthState {
  final bool isAuthenticated;
  final String? accessToken;
  final String? refreshToken;
  final User? user;
  final bool isLoading;
  final String? error;

  const AuthState({
    this.isAuthenticated = false,
    this.accessToken,
    this.refreshToken,
    this.user,
    this.isLoading = false,
    this.error,
  });

  AuthState copyWith({
    bool? isAuthenticated,
    String? accessToken,
    String? refreshToken,
    User? user,
    bool? isLoading,
    String? error,
    bool clearError = false,
    bool clearUser = false,
    bool clearTokens = false,
  }) {
    return AuthState(
      isAuthenticated: isAuthenticated ?? this.isAuthenticated,
      accessToken: clearTokens ? null : (accessToken ?? this.accessToken),
      refreshToken: clearTokens ? null : (refreshToken ?? this.refreshToken),
      user: clearUser ? null : (user ?? this.user),
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

// ---------------------------------------------------------------------------
// Notifier
// ---------------------------------------------------------------------------

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier({
    AuthService? authService,
    SecureStorageService? storageService,
  })  : _authService = authService ?? AuthService(),
        _storage = storageService ?? SecureStorageService(),
        super(const AuthState()) {
    // Auto-logout when the API client detects an unrecoverable 401.
    ApiClient().onSessionExpired = _handleSessionExpired;
  }

  final AuthService _authService;
  final SecureStorageService _storage;

  // -------------------------------------------------------------------------
  // Session restore (call on app start)
  // -------------------------------------------------------------------------

  /// Attempts to restore a previous session from secure storage.
  /// If tokens exist, fetches the user profile to validate them.
  Future<void> tryRestoreSession() async {
    try {
      final hasTokens = await _storage.hasTokens();
      if (!hasTokens) return;

      state = state.copyWith(isLoading: true, clearError: true);

      // Try to load cached user data first for instant UI.
      final cachedJson = await _storage.getUserData();
      if (cachedJson != null) {
        try {
          final user = User.fromJson(
            json.decode(cachedJson) as Map<String, dynamic>,
          );
          state = state.copyWith(
            isAuthenticated: true,
            user: user,
          );
        } catch (_) {
          // Cached data is corrupt — continue to fetch from server.
        }
      }

      // Validate tokens by fetching the profile from the server.
      final user = await _authService.getProfile();
      await _storage.setUserData(json.encode(user.toJson()));

      state = state.copyWith(
        isAuthenticated: true,
        user: user,
        isLoading: false,
      );
    } catch (e) {
      // Tokens are invalid or network error — clear everything.
      await _storage.clearAll();
      state = const AuthState();
    }
  }

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  Future<void> login({
    required String email,
    required String password,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final result = await _authService.login(
        email: email,
        password: password,
      );

      await _storage.setTokens(result.accessToken, result.refreshToken);
      await _storage.setUserData(json.encode(result.user.toJson()));

      state = state.copyWith(
        isAuthenticated: true,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: _extractErrorMessage(e),
      );
      rethrow;
    }
  }

  // -------------------------------------------------------------------------
  // Register
  // -------------------------------------------------------------------------

  Future<void> register({
    required String name,
    required String email,
    required String phone,
    required String password,
    String? businessName,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      await _authService.register(
        name: name,
        email: email,
        phone: phone,
        password: password,
        businessName: businessName,
      );
      state = state.copyWith(isLoading: false);
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: _extractErrorMessage(e),
      );
      rethrow;
    }
  }

  // -------------------------------------------------------------------------
  // Verify email
  // -------------------------------------------------------------------------

  Future<void> verifyEmail({
    required String email,
    required String otp,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      await _authService.verifyEmail(email: email, otp: otp);
      // Update the local user if already authenticated.
      if (state.user != null) {
        final updatedUser = User(
          id: state.user!.id,
          name: state.user!.name,
          email: state.user!.email,
          phone: state.user!.phone,
          businessName: state.user!.businessName,
          isVerified: true,
        );
        await _storage.setUserData(json.encode(updatedUser.toJson()));
        state = state.copyWith(user: updatedUser, isLoading: false);
      } else {
        state = state.copyWith(isLoading: false);
      }
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: _extractErrorMessage(e),
      );
      rethrow;
    }
  }

  // -------------------------------------------------------------------------
  // Resend verification
  // -------------------------------------------------------------------------

  Future<void> resendVerification({required String email}) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      await _authService.resendVerification(email: email);
      state = state.copyWith(isLoading: false);
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: _extractErrorMessage(e),
      );
      rethrow;
    }
  }

  // -------------------------------------------------------------------------
  // Forgot password
  // -------------------------------------------------------------------------

  Future<void> forgotPassword({required String email}) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      await _authService.forgotPassword(email: email);
      state = state.copyWith(isLoading: false);
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: _extractErrorMessage(e),
      );
      rethrow;
    }
  }

  // -------------------------------------------------------------------------
  // Reset password
  // -------------------------------------------------------------------------

  Future<void> resetPassword({
    required String email,
    required String otp,
    required String newPassword,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      await _authService.resetPassword(
        email: email,
        otp: otp,
        newPassword: newPassword,
      );
      state = state.copyWith(isLoading: false);
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: _extractErrorMessage(e),
      );
      rethrow;
    }
  }

  // -------------------------------------------------------------------------
  // Logout
  // -------------------------------------------------------------------------

  Future<void> logout() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      await PushNotificationService().unregisterCurrentToken();
      await _authService.logout();
    } finally {
      await _storage.clearAll();
      state = const AuthState();
    }
  }

  // -------------------------------------------------------------------------
  // Update profile
  // -------------------------------------------------------------------------

  Future<void> updateProfile({
    required String name,
    String? phone,
    String? businessName,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final user = await _authService.updateProfile(
        name: name,
        phone: phone,
        businessName: businessName,
      );
      await _storage.setUserData(json.encode(user.toJson()));
      state = state.copyWith(user: user, isLoading: false);
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: _extractErrorMessage(e),
      );
      rethrow;
    }
  }

  // -------------------------------------------------------------------------
  // Change password
  // -------------------------------------------------------------------------

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      await _authService.changePassword(
        currentPassword: currentPassword,
        newPassword: newPassword,
      );
      state = state.copyWith(isLoading: false);
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: _extractErrorMessage(e),
      );
      rethrow;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /// Clear the current error (e.g. when the user dismisses an error dialog).
  void clearError() {
    state = state.copyWith(clearError: true);
  }

  /// Called by [ApiClient.onSessionExpired] when token refresh fails.
  void _handleSessionExpired() {
    _storage.clearAll();
    state = const AuthState(error: 'Session expired. Please log in again.');
  }

  /// Extracts a human-readable error message from a [DioException] response
  /// body, falling back to a generic message for other exception types.
  static String _extractErrorMessage(Object error) {
    if (error is DioException) {
      // Try to read the structured error from the API response body.
      final data = error.response?.data;
      if (data is Map<String, dynamic>) {
        // Backend shape: { "error": { "message": "..." } }
        final errorObj = data['error'];
        if (errorObj is Map<String, dynamic> && errorObj['message'] is String) {
          return errorObj['message'] as String;
        }
        // Alternative flat shape: { "message": "..." }
        if (data['message'] is String) {
          return data['message'] as String;
        }
      }
      // Dio-level message (e.g. timeout, connection refused)
      if (error.message != null && error.message!.isNotEmpty) {
        return error.message!;
      }
      return 'Network error. Please check your connection and try again.';
    }
    return error.toString();
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>(
  (ref) => AuthNotifier(),
);
