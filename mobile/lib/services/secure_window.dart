import 'dart:io';

import 'package:flutter/services.dart';

/// Toggles Android's FLAG_SECURE (blocks screenshots / screen recording /
/// thumbnail capture) on sensitive screens.
///
/// FLAG_SECURE is a single Activity-level flag, so multiple simultaneously
/// mounted secure screens must be **reference counted**: calling [disable] when
/// popping one secure screen must NOT unprotect another that is still mounted
/// beneath it. The flag is only cleared once the count returns to zero.
class SecureWindow {
  static const _channel = MethodChannel('com.wasel.wasel/secure_window');

  static int _count = 0;

  static Future<void> enable() async {
    if (!Platform.isAndroid) return;
    _count++;
    if (_count == 1) {
      await _channel.invokeMethod<void>('enable');
    }
  }

  static Future<void> disable() async {
    if (!Platform.isAndroid) return;
    if (_count == 0) return;
    _count--;
    if (_count == 0) {
      await _channel.invokeMethod<void>('disable');
    }
  }
}
