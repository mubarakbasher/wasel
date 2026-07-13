class AccentPreset {
  final String id;
  final String hex;
  final String nameEn;
  final String nameAr;

  const AccentPreset({
    required this.id,
    required this.hex,
    required this.nameEn,
    required this.nameAr,
  });

  factory AccentPreset.fromJson(Map<String, dynamic> json) {
    return AccentPreset(
      id: json['id'] as String,
      hex: json['hex'] as String,
      nameEn: json['nameEn'] as String,
      nameAr: json['nameAr'] as String,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'hex': hex,
      'nameEn': nameEn,
      'nameAr': nameAr,
    };
  }
}

class HotspotTemplate {
  final String id;
  final String name;
  final String description;
  final String previewUrl;
  final String defaultAccent;
  final List<AccentPreset> accentPresets;

  const HotspotTemplate({
    required this.id,
    required this.name,
    required this.description,
    required this.previewUrl,
    this.defaultAccent = '#0f766e',
    this.accentPresets = const [],
  });

  factory HotspotTemplate.fromJson(Map<String, dynamic> json) {
    final presetsJson = json['accentPresets'] as List<dynamic>?;
    return HotspotTemplate(
      id: json['id'] as String,
      name: json['name'] as String,
      description: json['description'] as String,
      previewUrl: json['previewUrl'] as String,
      defaultAccent: json['defaultAccent'] as String? ?? '#0f766e',
      accentPresets: presetsJson
              ?.map((e) => AccentPreset.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'description': description,
      'previewUrl': previewUrl,
      'defaultAccent': defaultAccent,
      'accentPresets': accentPresets.map((e) => e.toJson()).toList(),
    };
  }
}
