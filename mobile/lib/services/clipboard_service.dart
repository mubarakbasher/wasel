import 'dart:async';

import 'package:flutter/services.dart';

/// App-scoped clipboard helper.
///
/// [copyWithAutoClear] copies a sensitive value and schedules a wipe that runs
/// **independently of any widget lifecycle** — navigating away from the screen
/// does not cancel the auto-clear (the whole point of the feature; the old
/// per-screen timers were cancelled in `dispose`, so the value lingered).
///
/// The wipe only fires if the clipboard still holds exactly what we wrote, so
/// it never clobbers something the user copied in the meantime.
class ClipboardService {
  ClipboardService._();
  static final ClipboardService instance = ClipboardService._();

  Timer? _timer;
  String? _pending;

  Future<void> copyWithAutoClear(
    String text, {
    Duration duration = const Duration(seconds: 30),
  }) async {
    await Clipboard.setData(ClipboardData(text: text));
    _pending = text;
    _timer?.cancel();
    _timer = Timer(duration, () async {
      final current = await Clipboard.getData(Clipboard.kTextPlain);
      if (current?.text == _pending) {
        await Clipboard.setData(const ClipboardData(text: ''));
      }
      _pending = null;
    });
  }

  /// Plain copy with no auto-clear, for non-sensitive values.
  Future<void> copy(String text) =>
      Clipboard.setData(ClipboardData(text: text));
}
