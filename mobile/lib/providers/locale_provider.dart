import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/auth_service.dart';
import '../services/secure_storage.dart';

class LocaleNotifier extends StateNotifier<Locale?> {
  final SecureStorageService _storage;
  final AuthService _authService;

  LocaleNotifier({
    SecureStorageService? storage,
    AuthService? authService,
  })  : _storage = storage ?? SecureStorageService(),
        _authService = authService ?? AuthService(),
        super(null);

  /// Load saved locale on app start
  Future<void> loadSavedLocale() async {
    final code = await _storage.getLocale();
    if (code != null) {
      state = Locale(code);
    }
  }

  /// Set locale, persist locally, and best-effort sync to the backend so
  /// server-generated push notifications are localized to the chosen language.
  Future<void> setLocale(Locale locale) async {
    state = locale;
    await _storage.setLocale(locale.languageCode);
    // Fire-and-forget: errors (offline, 401 unauthenticated) are swallowed
    // inside updateLanguage and must never block or surface to the caller.
    unawaited(_authService.updateLanguage(locale.languageCode));
  }

  /// Reset to system default
  Future<void> clearLocale() async {
    state = null;
    await _storage.deleteLocale();
  }
}

final localeProvider = StateNotifierProvider<LocaleNotifier, Locale?>(
  (ref) => LocaleNotifier(),
);
