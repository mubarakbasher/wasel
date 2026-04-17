import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/notifications_provider.dart';
import 'api_client.dart';
import 'secure_storage.dart';

/// Top-level background handler. Flutter spawns a separate isolate for this,
/// so anything it touches must reinitialize Firebase. We only keep it alive
/// long enough for FCM to display the system notification — the inbox will
/// resync when the user next opens the app.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

class PushNotificationService {
  static final PushNotificationService _instance =
      PushNotificationService._internal();
  factory PushNotificationService() => _instance;
  PushNotificationService._internal();

  final ApiClient _api = ApiClient();
  final SecureStorageService _storage = SecureStorageService();
  bool _initialized = false;
  ProviderContainer? _container;

  /// Called from app.dart once the ProviderScope is built so the service can
  /// refresh the notifications provider when a foreground push arrives.
  void attachRiverpod(ProviderContainer container) {
    _container = container;
  }

  Future<void> initialize() async {
    if (_initialized) return;
    try {
      await Firebase.initializeApp();
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission(alert: true, badge: true, sound: true);

      final token = await messaging.getToken();
      if (token != null) await _registerToken(token);
      messaging.onTokenRefresh.listen(_registerToken);

      FirebaseMessaging.onMessage.listen(_handleForegroundMessage);

      _initialized = true;
    } catch (e) {
      debugPrint('PushNotificationService: Firebase init failed: $e');
    }
  }

  Future<void> _registerToken(String token) async {
    final cachedToken = await _storage.getFcmToken();
    if (cachedToken == token) return;
    try {
      final platform = Platform.isIOS ? 'ios' : 'android';
      await _api.dio.post('/notifications/device-token', data: {
        'token': token,
        'platform': platform,
      });
      await _storage.setFcmToken(token);
    } catch (e) {
      debugPrint('Failed to register device token: $e');
    }
  }

  Future<void> unregisterCurrentToken() async {
    try {
      final token = await _storage.getFcmToken();
      if (token != null) {
        await _api.dio
            .delete('/notifications/device-token', data: {'token': token});
        await _storage.deleteFcmToken();
      }
    } catch (_) {}
  }

  void _handleForegroundMessage(RemoteMessage message) {
    debugPrint('Foreground message: ${message.notification?.title}');
    // Pull fresh data into the inbox so the bell badge updates immediately.
    _container?.read(notificationsProvider.notifier).refresh();
  }
}
