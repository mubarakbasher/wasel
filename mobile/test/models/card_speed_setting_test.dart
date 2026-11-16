import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/models/card_speed_setting.dart';

void main() {
  group('CardSpeedSetting.fromJson', () {
    test('reads enabled, speed and options', () {
      final s = CardSpeedSetting.fromJson({
        'enabled': true,
        'speed': '1M',
        'options': ['256k', '512k', '1M', '2M'],
      });
      expect(s.enabled, isTrue);
      expect(s.speed, '1M');
      expect(s.options, ['256k', '512k', '1M', '2M']);
    });

    test('falls back on wrong types', () {
      final s = CardSpeedSetting.fromJson(
          {'enabled': 'yes', 'speed': 5, 'options': 'x'});
      expect(s.enabled, false);
      expect(s.speed, '2M');
      expect(s.options, isEmpty);
    });

    test('keeps a speed that is not in options', () {
      final s = CardSpeedSetting.fromJson({
        'enabled': true,
        'speed': '8M',
        'options': ['1M', '2M'],
      });
      expect(s.speed, '8M');
    });
  });

  group('CardSpeedSetting.copyWith', () {
    test('copies individual fields', () {
      const base = CardSpeedSetting(enabled: false, speed: '2M');
      final updated = base.copyWith(enabled: true, speed: '5M');
      expect(updated.enabled, isTrue);
      expect(updated.speed, '5M');
      expect(updated.options, isEmpty);
    });
  });
}
