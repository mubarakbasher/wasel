import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/user.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/push_notification_service.dart';
import '../services/secure_storage.dart';
import '../utils/error_messages.dart';
import 'notifications_provider.dart';
import 'subscription_provider.dart';
import 'support_provider.dart';

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
  final String? errorCode;
  /// Email awaiting OTP verification. Set by register() / set by a login
  /// that failed with EMAIL_NOT_VERIFIED. Cleared on successful verify or
  /// successful login. VerifyEmailScreen falls back to this when the route
  /// arg is empty — makes the flow survive any URL / navigation quirk.
  final String? pendingVerificationEmail;

  /// True only during the initial session-restore pass on cold start.
  /// The router shows /splash while this is true and redirects to the correct
  /// destination once it flips false — prevents the login-flash on warm start.
  final bool isInitializing;

  const AuthState({
    this.isAuthenticated = false,
    this.accessToken,
    this.refreshToken,
    this.user,
    this.isLoading = false,
    this.error,
    this.errorCode,
    this.pendingVerificationEmail,
    this.isInitializing = false,
  });

  AuthState copyWith({
    bool? isAuthenticated,
    String? accessToken,
    String? refreshToken,
    User? user,
    bool? isLoading,
    String? error,
    String? errorCode,
    String? pendingVerificationEmail,
    bool? isInitializing,
    bool clearError = false,
    bool clearUser = false,
    bool clearTokens = false,
    bool clearPendingVerificationEmail = false,
  }) {
    return AuthState(
      isAuthenticated: isAuthenticated ?? this.isAuthenticated,
      accessToken: clearTokens ? null : (accessToken ?? this.accessToken),
      refreshToken: clearTokens ? null : (refreshToken ?? this.refreshToken),
      user: clearUser ? null : (user ?? this.user),
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
      pendingVerificationEmail: clearPendingVerificationEmail
          ? null
          : (pendingVerificationEmail ?? this.pendingVerificationEmail),
      isInitializing: isInitializing ?? this.isInitializing,
    );
  }
}

// ---------------------------------------------------------------------------
// Notifier
// ---------------------------------------------------------------------------

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier({
    Ref? ref,
    AuthService? authService,
    SecureStorageService? storageService,
  })  : _ref = ref,
        _authService = authService ?? AuthService(),
        _storage = storageService ?? SecureStorageService(),
        super(const AuthState(isInitializing: true)) {
    // Auto-logout when the API client detects an unrecoverable 401.
    ApiClient().onSessionExpired = _handleSessionExpired;
  }

  final Ref? _ref;
  final AuthService _authService;
  final SecureStorageService _storage;

  /// Reset every user-scoped provider so stale data from the previous user
  /// can't leak into the next session. Called before tokens are cleared.
  void _resetUserScopedProviders() {
    final ref = _ref;
    if (ref == null) return;
    try {
      ref.read(notificationsProvider.notifier).reset();
    } catch (_) {
      // Provider may not be initialised yet — safe to ignore.
    }
    try {
      ref.read(supportProvider.notifier).reset();
    } catch (_) {
      // Same.
    }
    try {
      ref.read(subscriptionProvider.notifier).clearSubscription();
    } catch (_) {
      // Same.
    }
  }

  /// Kick off loads for user-scoped providers that screens read but don't
  /// load themselves (Dashboard, Routers, Vouchers all read subscription
  /// state without calling loadSubscription). Fire-and-forget so auth latency
  /// is unaffected.
  void _loadUserScopedProviders() {
    final ref = _ref;
    if (ref == null) return;
    try {
      ref
          .read(subscriptionProvider.notifier)
          .loadSubscription()
          .catchError((Object e, StackTrace st) {
        // loadSubscription catches internally and writes to state.error, so
        // rejection here is unexpected. Log it for diagnostics only.
        debugPrint('[AuthNotifier] loadSubscription unexpected error: $e\n$st');
      });
    } catch (_) {
      // Provider may not be initialised yet — safe to ignore.
    }
  }

  // -------------------------------------------------------------------------
  // Session restore (call on app start)
  // -------------------------------------------------------------------------

  /// Attempts to restore a previous session from secure storage.
  /// If tokens exist, fetches the user profile to validate them.
  Future<void> tryRestoreSession() async {
    try {
      final hasTokens = await _storage.hasTokens();
      if (!hasTokens) return; // finally clears isInitializing -> router shows /login

      // Local, offline-capable auth decision from the cached user.
      final cachedJson = await _storage.getUserData();
      var restoredFromCache = false;
      if (cachedJson != null) {
        try {
          final user = User.fromJson(json.decode(cachedJson) as Map<String, dynamic>);
          state = state.copyWith(isAuthenticated: true, user: user);
          restoredFromCache = true;
        } catch (_) {
          // Corrupt cache -> fall through to server validation.
        }
      }

      // With a local identity, leave the splash NOW — don't block on the
      // network (getProfile can hang up to the 15s timeout when offline).
      // Without one, hold the splash through getProfile so we never flash
      // /login before the server decides (the finally still clears it).
      state = restoredFromCache
          ? state.copyWith(isInitializing: false, isLoading: true, clearError: true)
          : state.copyWith(isLoading: true, clearError: true);

      // Background validation / refresh of the cached session.
      final user = await _authService.getProfile();
      await _storage.setUserData(json.encode(user.toJson()));
      state = state.copyWith(isAuthenticated: true, user: user, isLoading: false);
      _loadUserScopedProviders();
      _syncLocaleToBackend();
    } catch (_) {
      // Network/transient failure must NOT log out — keep the cached session.
      state = state.copyWith(isLoading: false);
    } finally {
      // Safety net for every exit path (no tokens, corrupt cache, network
      // error). Idempotent — skip the write if it's already cleared.
      if (state.isInitializing) {
        state = state.copyWith(isInitializing: false);
      }
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
        clearPendingVerificationEmail: true,
      );
      _loadUserScopedProviders();
      _syncLocaleToBackend();
    } catch (e) {
      final code = _extractErrorCode(e);
      state = state.copyWith(
        isLoading: false,
        error: _extractErrorMessage(e),
        errorCode: code,
        // If the login was blocked because the email isn't verified, remember
        // which email — the login screen will route to /verify-email and the
        // screen will pick it up from state.
        pendingVerificationEmail:
            code == 'EMAIL_NOT_VERIFIED' ? email : null,
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
      // Stash the email so the verify screen can pick it up even if the
      // route argument is lost in navigation (release-mode cast / go-router
      // reset). Belt-and-suspenders with the query parameter.
      state = state.copyWith(
        isLoading: false,
        pendingVerificationEmail: email,
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
        state = state.copyWith(
          user: updatedUser,
          isLoading: false,
          clearPendingVerificationEmail: true,
        );
      } else {
        state = state.copyWith(
          isLoading: false,
          clearPendingVerificationEmail: true,
        );
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
      _resetUserScopedProviders();
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

  /// Reads the locally persisted locale and pushes it to the backend so
  /// server-generated push notifications can be localized. Fire-and-forget —
  /// errors (offline, unauthenticated) are swallowed inside [AuthService.updateLanguage].
  void _syncLocaleToBackend() {
    _storage.getLocale().then((code) {
      if (code != null) {
        _authService.updateLanguage(code);
      }
    }).catchError((_) {
      // Swallow storage errors — sync is best-effort.
    });
  }

  /// Called by [ApiClient.onSessionExpired] when token refresh fails.
  void _handleSessionExpired() {
    _resetUserScopedProviders();
    _storage.clearAll();
    state = const AuthState(error: 'error.unauthorized');
  }

  /// Extracts the backend error code (e.g. 'EMAIL_NOT_VERIFIED') from a
  /// [DioException] response body. Returns null for non-Dio errors or when the
  /// response does not carry a structured error code.
  static String? _extractErrorCode(Object error) {
    if (error is DioException) {
      final data = error.response?.data;
      if (data is Map<String, dynamic>) {
        final errorObj = data['error'];
        if (errorObj is Map<String, dynamic> && errorObj['code'] is String) {
          return errorObj['code'] as String;
        }
      }
    }
    return null;
  }

  /// Extracts a human-readable error message or i18n key from the exception.
  /// Delegates to the centralised [errorToDisplay] mapper.
  static String _extractErrorMessage(Object error) => errorToDisplay(error);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>(
  (ref) => AuthNotifier(ref: ref),
);
