/// Wire-format model for the card speed-limit feature.
///
/// [fromJson] never throws — wrong or missing values fall back to defaults.
class CardSpeedSetting {
  final bool enabled;

  /// Wire value, e.g. '1M', '256k'.  Default '2M'.
  final String speed;

  /// Wire values from the server, in order.
  final List<String> options;

  const CardSpeedSetting({
    this.enabled = false,
    this.speed = '2M',
    this.options = const [],
  });

  factory CardSpeedSetting.fromJson(Map<String, dynamic> json) {
    final enabled = json['enabled'] is bool ? json['enabled'] as bool : false;
    final speed = json['speed'] is String ? json['speed'] as String : '2M';
    final rawOptions = json['options'];
    final options = rawOptions is List
        ? rawOptions.whereType<String>().toList()
        : <String>[];
    return CardSpeedSetting(enabled: enabled, speed: speed, options: options);
  }

  CardSpeedSetting copyWith({bool? enabled, String? speed}) {
    return CardSpeedSetting(
      enabled: enabled ?? this.enabled,
      speed: speed ?? this.speed,
      options: options,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is CardSpeedSetting &&
      other.enabled == enabled &&
      other.speed == speed &&
      _listEqual(other.options, options);

  @override
  int get hashCode => Object.hash(enabled, speed, Object.hashAll(options));

  bool _listEqual(List<String> a, List<String> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}
