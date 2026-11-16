// test/models/print_settings_test.dart
//
// Unit tests for PrintKnobs.qrEnabled and PrintSettings.howToKey.

import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/models/print_settings.dart';

void main() {
  // ---------------------------------------------------------------------------
  // PrintKnobs.qrEnabled
  // ---------------------------------------------------------------------------

  group('PrintKnobs.qrEnabled', () {
    test('true when showQr=true and hotspotAddress non-empty', () {
      const k = PrintKnobs(showQr: true, hotspotAddress: 'wifi.shop.net');
      expect(k.qrEnabled, isTrue);
    });

    test('false when showQr=false regardless of address', () {
      const k = PrintKnobs(showQr: false, hotspotAddress: 'wifi.shop.net');
      expect(k.qrEnabled, isFalse);
    });

    test('false when hotspotAddress is empty regardless of showQr', () {
      const k = PrintKnobs(showQr: true, hotspotAddress: '');
      expect(k.qrEnabled, isFalse);
    });

    test('false when both showQr=false and address empty', () {
      const k = PrintKnobs();
      expect(k.qrEnabled, isFalse);
    });
  });

  // ---------------------------------------------------------------------------
  // PrintSettings.howToKey
  // ---------------------------------------------------------------------------

  group('PrintSettings.howToKey', () {
    test('returns howToQr for Detailed + showQr + non-empty address', () {
      const s = PrintSettings(
        templateId: VoucherTemplateId.detailed,
        knobs: PrintKnobs(showQr: true, hotspotAddress: 'wifi.shop.net'),
      );
      expect(s.howToKey, equals('print.howToQr'));
    });

    test('returns howToDefault for Detailed + showQr=false', () {
      const s = PrintSettings(
        templateId: VoucherTemplateId.detailed,
        knobs: PrintKnobs(showQr: false, hotspotAddress: 'wifi.shop.net'),
      );
      expect(s.howToKey, equals('print.howToDefault'));
    });

    test('returns howToDefault for Detailed + showQr=true + empty address', () {
      const s = PrintSettings(
        templateId: VoucherTemplateId.detailed,
        knobs: PrintKnobs(showQr: true, hotspotAddress: ''),
      );
      expect(s.howToKey, equals('print.howToDefault'));
    });

    test('returns howToDefault for Classic + showQr=true + non-empty address',
        () {
      const s = PrintSettings(
        templateId: VoucherTemplateId.classic,
        knobs: PrintKnobs(showQr: true, hotspotAddress: 'wifi.shop.net'),
      );
      expect(s.howToKey, equals('print.howToDefault'));
    });

    test('returns howToDefault for Strips + showQr=true + non-empty address',
        () {
      const s = PrintSettings(
        templateId: VoucherTemplateId.strips,
        knobs: PrintKnobs(showQr: true, hotspotAddress: 'wifi.shop.net'),
      );
      expect(s.howToKey, equals('print.howToDefault'));
    });

    test('returns howToDefault when no knobs set (all defaults)', () {
      const s = PrintSettings();
      expect(s.howToKey, equals('print.howToDefault'));
    });
  });
}
