import 'dart:io';

import 'package:flutter/services.dart';

class SecureWindow {
  static const _channel = MethodChannel('com.wasel.wasel/secure_window');

  static Future<void> enable() async {
    if (!Platform.isAndroid) return;
    await _channel.invokeMethod<void>('enable');
  }

  static Future<void> disable() async {
    if (!Platform.isAndroid) return;
    await _channel.invokeMethod<void>('disable');
  }
}
