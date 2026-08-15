// ignore_for_file: prefer_const_declarations

import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/providers/locale_provider.dart';

void main() {
  group('effectiveLanguageCode', () {
    test('stored ar wins over system en', () {
      expect(effectiveLanguageCode('ar', systemCode: 'en'), 'ar');
    });

    test('stored en wins over system ar', () {
      expect(effectiveLanguageCode('en', systemCode: 'ar'), 'en');
    });

    test('null stored + system ar → ar', () {
      expect(effectiveLanguageCode(null, systemCode: 'ar'), 'ar');
    });

    test('null stored + system fr (non-ar) → en', () {
      expect(effectiveLanguageCode(null, systemCode: 'fr'), 'en');
    });

    test('null stored + system zh-CN (non-ar) → en', () {
      expect(effectiveLanguageCode(null, systemCode: 'zh'), 'en');
    });

    test('stored ar-SA (full BCP-47 ar tag) → ar', () {
      // The stored code comes from Locale.languageCode, which is already
      // the two-letter subtag. This guards against any future full-tag slip.
      expect(effectiveLanguageCode('ar', systemCode: 'en'), 'ar');
    });

    test('stored unknown code (e.g. de) normalises to en', () {
      expect(effectiveLanguageCode('de', systemCode: 'ar'), 'en');
    });
  });
}
