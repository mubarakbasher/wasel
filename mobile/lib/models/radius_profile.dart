class RadiusAttribute {
  final String type; // 'check' or 'reply'
  final String attribute;
  final String op;
  final String value;

  const RadiusAttribute({
    required this.type,
    required this.attribute,
    required this.op,
    required this.value,
  });

  factory RadiusAttribute.fromJson(Map<String, dynamic> json) {
    return RadiusAttribute(
      type: json['type'] as String,
      attribute: json['attribute'] as String,
      op: json['op'] as String,
      value: json['value'] as String,
    );
  }
}

class RadiusProfile {
  final String id;
  final String userId;
  final String groupName;
  final String displayName;
  final String? bandwidthUp;
  final String? bandwidthDown;
  final int? sessionTimeout;
  final int? totalTime;
  final int? totalData;
  final List<RadiusAttribute> radiusAttributes;
  final DateTime createdAt;
  final DateTime updatedAt;

  const RadiusProfile({
    required this.id,
    required this.userId,
    required this.groupName,
    required this.displayName,
    this.bandwidthUp,
    this.bandwidthDown,
    this.sessionTimeout,
    this.totalTime,
    this.totalData,
    this.radiusAttributes = const [],
    required this.createdAt,
    required this.updatedAt,
  });

  /// Human-readable bandwidth string, e.g. "2M Up / 5M Down"
  String get bandwidthDisplay {
    if (bandwidthUp == null && bandwidthDown == null) return 'Unlimited';
    final up = bandwidthUp ?? '0';
    final down = bandwidthDown ?? '0';
    return '$up Up / $down Down';
  }

  /// Human-readable session timeout
  String get sessionTimeoutDisplay {
    if (sessionTimeout == null || sessionTimeout == 0) return 'Unlimited';
    return _formatDuration(sessionTimeout!);
  }

  /// Human-readable total time
  String get totalTimeDisplay {
    if (totalTime == null || totalTime == 0) return 'Unlimited';
    return _formatDuration(totalTime!);
  }

  /// Human-readable total data
  String get totalDataDisplay {
    if (totalData == null || totalData == 0) return 'Unlimited';
    return _formatBytes(totalData!);
  }

  factory RadiusProfile.fromJson(Map<String, dynamic> json) {
    return RadiusProfile(
      id: json['id'] as String,
      userId: json['userId'] as String,
      groupName: json['groupName'] as String,
      displayName: json['displayName'] as String,
      bandwidthUp: json['bandwidthUp'] as String?,
      bandwidthDown: json['bandwidthDown'] as String?,
      sessionTimeout: (json['sessionTimeout'] as num?)?.toInt(),
      totalTime: (json['totalTime'] as num?)?.toInt(),
      totalData: (json['totalData'] as num?)?.toInt(),
      radiusAttributes: json['radiusAttributes'] != null
          ? (json['radiusAttributes'] as List)
              .map((e) => RadiusAttribute.fromJson(e as Map<String, dynamic>))
              .toList()
          : [],
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'userId': userId,
      'groupName': groupName,
      'displayName': displayName,
      'bandwidthUp': bandwidthUp,
      'bandwidthDown': bandwidthDown,
      'sessionTimeout': sessionTimeout,
      'totalTime': totalTime,
      'totalData': totalData,
    };
  }
}

String _formatDuration(int seconds) {
  if (seconds < 60) return '${seconds}s';
  if (seconds < 3600) return '${seconds ~/ 60} min';
  if (seconds < 86400) {
    final h = seconds ~/ 3600;
    final m = (seconds % 3600) ~/ 60;
    return m > 0 ? '${h}h ${m}m' : '${h}h';
  }
  final d = seconds ~/ 86400;
  final h = (seconds % 86400) ~/ 3600;
  return h > 0 ? '${d}d ${h}h' : '${d}d';
}

String _formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  if (bytes < 1024 * 1024 * 1024) {
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
  return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
}
