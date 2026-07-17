import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/models/hotspot_template.dart';

void main() {
  // ---------------------------------------------------------------------------
  // AccentPreset
  // ---------------------------------------------------------------------------

  group('AccentPreset', () {
    test('fromJson parses all fields', () {
      final preset = AccentPreset.fromJson({
        'id': 'teal',
        'hex': '#0f766e',
        'nameEn': 'Teal',
        'nameAr': 'تركوازي',
      });
      expect(preset.id, 'teal');
      expect(preset.hex, '#0f766e');
      expect(preset.nameEn, 'Teal');
      expect(preset.nameAr, 'تركوازي');
    });

    test('toJson round-trips', () {
      const preset = AccentPreset(
        id: 'rose',
        hex: '#be123c',
        nameEn: 'Rose',
        nameAr: 'قرمزي',
      );
      final json = preset.toJson();
      final back = AccentPreset.fromJson(json);
      expect(back.id, preset.id);
      expect(back.hex, preset.hex);
      expect(back.nameEn, preset.nameEn);
      expect(back.nameAr, preset.nameAr);
    });
  });

  // ---------------------------------------------------------------------------
  // HotspotTemplate — new split-key fields
  // ---------------------------------------------------------------------------

  group('HotspotTemplate.fromJson', () {
    test('parses split nameEn/nameAr/descriptionEn/descriptionAr fields', () {
      final template = HotspotTemplate.fromJson({
        'id': 'clean',
        'nameEn': 'Daylight',
        'nameAr': 'نهار',
        'descriptionEn': 'A clean design.',
        'descriptionAr': 'تصميم نظيف.',
        'previewUrl': 'https://example.com/preview.png',
        'defaultAccent': '#4f46e5',
        'accentPresets': [
          {
            'id': 'teal',
            'hex': '#0f766e',
            'nameEn': 'Teal',
            'nameAr': 'تركوازي',
          },
          {
            'id': 'indigo',
            'hex': '#4f46e5',
            'nameEn': 'Indigo',
            'nameAr': 'نيلي',
          },
        ],
      });

      expect(template.id, 'clean');
      expect(template.nameEn, 'Daylight');
      expect(template.nameAr, 'نهار');
      expect(template.descriptionEn, 'A clean design.');
      expect(template.descriptionAr, 'تصميم نظيف.');
      expect(template.defaultAccent, '#4f46e5');
      expect(template.accentPresets, hasLength(2));
      expect(template.accentPresets.first.id, 'teal');
      expect(template.accentPresets.last.hex, '#4f46e5');
    });

    test(
        'falls back to combined name/description when split keys are absent (older backend)',
        () {
      final template = HotspotTemplate.fromJson({
        'id': 'dark',
        'name': 'Dark Mode',
        'description': 'A dark design',
        'previewUrl': 'https://example.com/dark/preview.png',
      });

      // Both nameEn and nameAr should fall back to the combined 'name' value.
      expect(template.nameEn, 'Dark Mode');
      expect(template.nameAr, 'Dark Mode');
      // Both descriptionEn and descriptionAr should fall back too.
      expect(template.descriptionEn, 'A dark design');
      expect(template.descriptionAr, 'A dark design');
      expect(template.defaultAccent, '#0f766e');
      expect(template.accentPresets, isEmpty);
    });

    test('toJson emits four split fields and round-trips', () {
      final original = HotspotTemplate.fromJson({
        'id': 'warm',
        'nameEn': 'Warm',
        'nameAr': 'دافئ',
        'descriptionEn': 'Warm tones',
        'descriptionAr': 'ألوان دافئة',
        'previewUrl': 'https://example.com/warm.png',
        'defaultAccent': '#c2410c',
        'accentPresets': [
          {
            'id': 'burnt-orange',
            'hex': '#c2410c',
            'nameEn': 'Burnt Orange',
            'nameAr': 'برتقالي داكن',
          },
        ],
      });

      final json = original.toJson();

      // Emits the four split keys, not the old combined keys.
      expect(json.containsKey('nameEn'), isTrue);
      expect(json.containsKey('nameAr'), isTrue);
      expect(json.containsKey('descriptionEn'), isTrue);
      expect(json.containsKey('descriptionAr'), isTrue);
      expect(json.containsKey('name'), isFalse);
      expect(json.containsKey('description'), isFalse);

      final restored = HotspotTemplate.fromJson(json);
      expect(restored.nameEn, 'Warm');
      expect(restored.nameAr, 'دافئ');
      expect(restored.descriptionEn, 'Warm tones');
      expect(restored.descriptionAr, 'ألوان دافئة');
      expect(restored.defaultAccent, '#c2410c');
      expect(restored.accentPresets, hasLength(1));
      expect(restored.accentPresets.first.nameAr, 'برتقالي داكن');
    });
  });
}
