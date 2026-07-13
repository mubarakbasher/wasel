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
  // HotspotTemplate with new fields
  // ---------------------------------------------------------------------------

  group('HotspotTemplate.fromJson', () {
    test('parses all fields including defaultAccent and accentPresets', () {
      final template = HotspotTemplate.fromJson({
        'id': 'clean',
        'name': 'Daylight · نهار',
        'description': 'A clean design',
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
      expect(template.name, 'Daylight · نهار');
      expect(template.defaultAccent, '#4f46e5');
      expect(template.accentPresets, hasLength(2));
      expect(template.accentPresets.first.id, 'teal');
      expect(template.accentPresets.last.hex, '#4f46e5');
    });

    test('falls back to defaults when new fields are absent (older backend)',
        () {
      final template = HotspotTemplate.fromJson({
        'id': 'dark',
        'name': 'Dark Mode',
        'description': 'A dark design',
        'previewUrl': 'https://example.com/dark/preview.png',
      });

      expect(template.defaultAccent, '#0f766e');
      expect(template.accentPresets, isEmpty);
    });

    test('toJson round-trips with new fields', () {
      final original = HotspotTemplate.fromJson({
        'id': 'warm',
        'name': 'Warm · دافئ',
        'description': 'Warm tones',
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
      final restored = HotspotTemplate.fromJson(json);
      expect(restored.defaultAccent, '#c2410c');
      expect(restored.accentPresets, hasLength(1));
      expect(restored.accentPresets.first.nameAr, 'برتقالي داكن');
    });
  });
}
