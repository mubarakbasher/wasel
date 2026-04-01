import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'api_client.dart';
import 'secure_storage.dart';

class PushNotificationService {
  static final PushNotificationService _instance = PushNotificationService._internal();
  factory PushNotificationService() => _instance;
  PushNotificationService._internal();

  final ApiClient _api = ApiClient();
  final SecureStorageService _storage = SecureStorageService();
  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized) return;
    try {
      await Firebase.initializeApp();
      final messaging = FirebaseMessaging.instance;

      // Request permission (iOS)
      await messaging.requestPermission(alert: true, badge: true, sound: true);

      // Get and register token
      final token = await messaging.getToken();
      if (token != null) await _registerToken(token);

      // Listen for token refresh
      messaging.onTokenRefresh.listen(_registerToken);

      // Foreground messages
      FirebaseMessaging.onMessage.listen(_handleForegroundMessage);

      _initialized = true;
    } catch (e) {
      debugPrint('PushNotificationService: Firebase init failed: $e');
    }
  }

  Future<void> _registerToken(String token) async {
    final cachedToken = await _storage.getFcmToken();
    if (cachedToken == token) return; // no change
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
        await _api.dio.delete('/notifications/device-token', data: {'token': token});
        await _storage.deleteFcmToken();
      }
    } catch (_) {}
  }

  void _handleForegroundMessage(RemoteMessage message) {
    debugPrint('Foreground message: ${message.notification?.title}');
  }
}
