class HotspotTemplate {
  final String id;
  final String name;
  final String description;
  final String previewUrl;

  const HotspotTemplate({
    required this.id,
    required this.name,
    required this.description,
    required this.previewUrl,
  });

  factory HotspotTemplate.fromJson(Map<String, dynamic> json) {
    return HotspotTemplate(
      id: json['id'] as String,
      name: json['name'] as String,
      description: json['description'] as String,
      previewUrl: json['previewUrl'] as String,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'description': description,
      'previewUrl': previewUrl,
    };
  }
}
