import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/secure_storage.dart';

class LocaleNotifier extends StateNotifier<Locale?> {
  final SecureStorageService _storage;

  LocaleNotifier({SecureStorageService? storage})
      : _storage = storage ?? SecureStorageService(),
        super(null);

  /// Load saved locale on app start
  Future<void> loadSavedLocale() async {
    final code = await _storage.getLocale();
    if (code != null) {
      state = Locale(code);
    }
  }

  /// Set locale and persist
  Future<void> setLocale(Locale locale) async {
    state = locale;
    await _storage.setLocale(locale.languageCode);
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
